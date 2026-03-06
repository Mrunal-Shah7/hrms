import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { AttendanceNotificationService } from '../../attendance/attendance-notification.service';

export interface DailySummaryRow {
  userId: string;
  date: Date;
  firstPunchIn: Date | null;
  lastPunchOut: Date | null;
  totalHours: number;
  effectiveHours: number;
  overtimeHours: number;
  status: string;
  isLate: boolean;
  isEarlyDeparture: boolean;
}

const DATE_ONLY = (d: Date) => d.toISOString().slice(0, 10);

function parseTimeHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Build a Date for the given calendar date and minutes-since-midnight. */
function dateAtMinutes(date: Date, minutesSinceMidnight: number): Date {
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  out.setMinutes(out.getMinutes() + minutesSinceMidnight);
  return out;
}

@Injectable()
export class SummaryService {
  constructor(
    @Optional()
    @Inject(forwardRef(() => AttendanceNotificationService))
    private readonly attendanceNotificationService?: AttendanceNotificationService,
  ) {}

  /**
   * Compute daily_time_summary for one user on one date and upsert it.
   * Must be called within a tenant schema transaction (search_path set).
   * If schemaName is provided and AttendanceNotificationService is available, anomaly/overtime notifications are sent.
   */
  async computeDailySummary(
    tx: PrismaClient,
    userId: string,
    date: Date,
    schemaName?: string,
  ): Promise<DailySummaryRow> {
    const dateStr = DATE_ONLY(date);
    const dayOfWeek = date.getDay();
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dayName = dayNames[dayOfWeek];

    const logs = await tx.$queryRawUnsafe<
      Array<{ punch_type: string; punch_time: Date }>
    >(
      `SELECT punch_type, punch_time FROM time_logs
       WHERE user_id = $1 AND DATE(punch_time) = $2::date
       ORDER BY punch_time ASC`,
      userId,
      dateStr,
    );

    const scheduleRows = await tx.$queryRawUnsafe<
      Array<{
        start_time: string;
        end_time: string;
        working_days: unknown;
        grace_period_minutes: number;
        min_hours_full_day: number;
        min_hours_half_day: number;
        overtime_threshold_hours: number;
      }>
    >(`SELECT start_time, end_time, working_days, grace_period_minutes,
       min_hours_full_day, min_hours_half_day, overtime_threshold_hours
       FROM work_schedule WHERE is_default = true LIMIT 1`);

    const ws = scheduleRows[0];
    if (!ws) {
      await this.upsertSummary(tx, userId, dateStr, {
        firstPunchIn: null,
        lastPunchOut: null,
        totalHours: 0,
        effectiveHours: 0,
        overtimeHours: 0,
        status: 'absent',
        isLate: false,
        isEarlyDeparture: false,
      });
      return {
        userId,
        date: new Date(dateStr),
        firstPunchIn: null,
        lastPunchOut: null,
        totalHours: 0,
        effectiveHours: 0,
        overtimeHours: 0,
        status: 'absent',
        isLate: false,
        isEarlyDeparture: false,
      };
    }

    const workingDays = Array.isArray(ws.working_days)
      ? (ws.working_days as string[])
      : (typeof ws.working_days === 'string' ? JSON.parse(ws.working_days) : []) as string[];
    const isWorkingDay = workingDays.includes(dayName);

    const holidayRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM holidays WHERE date = $1::date LIMIT 1`,
      dateStr,
    );
    const isHoliday = holidayRows.length > 0;

    const leaveRows = await tx.$queryRawUnsafe<
      Array<{ id: string; duration_type: string }>
    >(
      `SELECT id, duration_type FROM leave_requests
       WHERE user_id = $1 AND status = 'approved'
         AND $2::date BETWEEN start_date AND end_date`,
      userId,
      dateStr,
    );
    const onLeave = leaveRows.length > 0;
    const halfDayLeave = onLeave && leaveRows.some((r) => r.duration_type === 'half_day');

    let status = 'present';
    if (!isWorkingDay) {
      status = 'weekend';
    } else if (isHoliday) {
      status = 'holiday';
    } else if (onLeave && !halfDayLeave) {
      status = 'on_leave';
    }

    let firstPunchIn: Date | null = null;
    let lastPunchOut: Date | null = null;
    for (const log of logs) {
      if (log.punch_type === 'in') {
        if (!firstPunchIn) firstPunchIn = new Date(log.punch_time);
      } else if (log.punch_type === 'out') {
        lastPunchOut = new Date(log.punch_time);
      }
    }

    if (status === 'present' || status === 'absent' || (halfDayLeave && (firstPunchIn || lastPunchOut))) {
      if (logs.length === 0 && isWorkingDay && !isHoliday && !onLeave) {
        status = 'absent';
      }
    }

    let totalHours = 0;
    let effectiveHours = 0;
    let overtimeHours = 0;
    let isLate = false;
    let isEarlyDeparture = false;

    if (firstPunchIn && lastPunchOut && (status === 'present' || halfDayLeave)) {
      totalHours = (lastPunchOut.getTime() - firstPunchIn.getTime()) / (1000 * 60 * 60);
      effectiveHours = totalHours;
      overtimeHours = Math.max(0, totalHours - ws.overtime_threshold_hours);

      const startMinutes = parseTimeHHMM(ws.start_time);
      const endMinutes = parseTimeHHMM(ws.end_time);
      const graceMinutes = ws.grace_period_minutes ?? 0;
      const thresholdIn = dateAtMinutes(date, startMinutes + graceMinutes);
      const endTimeDate = dateAtMinutes(date, endMinutes);
      isLate = firstPunchIn > thresholdIn;
      isEarlyDeparture = lastPunchOut < endTimeDate;
    } else if (firstPunchIn && !lastPunchOut && isWorkingDay && !isHoliday && !onLeave) {
      totalHours = 0;
      effectiveHours = 0;
      if (logs.length > 0) status = 'absent';
    }

    if (status === 'present' && isWorkingDay && !isHoliday && !onLeave) {
      if (totalHours >= ws.min_hours_full_day) {
        status = 'present';
      } else if (totalHours >= ws.min_hours_half_day) {
        status = 'half_day';
      } else if (logs.length === 0) {
        status = 'absent';
      } else {
        status = 'absent';
      }
    }

    if (halfDayLeave && status === 'present') {
      status = 'half_day';
    }

    await this.upsertSummary(tx, userId, dateStr, {
      firstPunchIn,
      lastPunchOut,
      totalHours,
      effectiveHours,
      overtimeHours,
      status,
      isLate,
      isEarlyDeparture,
    });

    const result: DailySummaryRow = {
      userId,
      date: new Date(dateStr),
      firstPunchIn,
      lastPunchOut,
      totalHours,
      effectiveHours,
      overtimeHours,
      status,
      isLate,
      isEarlyDeparture,
    };

    if (schemaName && this.attendanceNotificationService) {
      await this.attendanceNotificationService.onDailySummaryComputed(
        schemaName,
        userId,
        new Date(dateStr),
        result,
      );
    }

    return result;
  }

  private async upsertSummary(
    tx: PrismaClient,
    userId: string,
    dateStr: string,
    row: {
      firstPunchIn: Date | null;
      lastPunchOut: Date | null;
      totalHours: number;
      effectiveHours: number;
      overtimeHours: number;
      status: string;
      isLate: boolean;
      isEarlyDeparture: boolean;
    },
  ): Promise<void> {
    await tx.$executeRawUnsafe(
      `INSERT INTO daily_time_summary (user_id, date, first_punch_in, last_punch_out, total_hours, effective_hours, overtime_hours, status, is_late, is_early_departure)
       VALUES ($1::uuid, $2::date, $3::timestamp, $4::timestamp, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (user_id, date)
       DO UPDATE SET first_punch_in = EXCLUDED.first_punch_in, last_punch_out = EXCLUDED.last_punch_out,
         total_hours = EXCLUDED.total_hours, effective_hours = EXCLUDED.effective_hours,
         overtime_hours = EXCLUDED.overtime_hours, status = EXCLUDED.status,
         is_late = EXCLUDED.is_late, is_early_departure = EXCLUDED.is_early_departure, updated_at = NOW()`,
      userId,
      dateStr,
      row.firstPunchIn,
      row.lastPunchOut,
      row.totalHours,
      row.effectiveHours,
      row.overtimeHours,
      row.status,
      row.isLate,
      row.isEarlyDeparture,
    );
  }
}
