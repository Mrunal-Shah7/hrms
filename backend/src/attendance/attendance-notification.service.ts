import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../core/notification/notification.service';
import type { DailySummaryRow } from '../time-tracker/summary/summary.service';

@Injectable()
export class AttendanceNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Called after SummaryService.computeDailySummary(). Sends anomaly and overtime notifications.
   */
  async onDailySummaryComputed(
    schemaName: string,
    userId: string,
    date: Date,
    result: DailySummaryRow,
  ): Promise<void> {
    const dateStr = date.toISOString().slice(0, 10);
    const dayOfWeek = date.getDay();
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dayName = dayNames[dayOfWeek];

    // We need work schedule to know working days and min hours - query once
    const ws = await this.getDefaultWorkSchedule(schemaName);
    if (!ws) return;

    const workingDays = new Set(ws.workingDays);
    const isWorkingDay = workingDays.has(dayName);
    const minHoursHalfDay = ws.minHoursHalfDay ?? 4;

    // 1. Anomalies (in-app only)
    if (result.firstPunchIn && !result.lastPunchOut && isWorkingDay) {
      await this.notificationService.create(
        userId,
        'attendance_anomaly',
        'Missing punch-out',
        `Missing punch-out detected for ${dateStr}. Please submit a regularization if needed.`,
        schemaName,
        { date: dateStr },
      );
    }
    if (
      isWorkingDay &&
      result.status !== 'weekend' &&
      result.status !== 'holiday' &&
      result.status !== 'on_leave' &&
      result.totalHours > 0 &&
      result.totalHours < minHoursHalfDay
    ) {
      await this.notificationService.create(
        userId,
        'attendance_anomaly',
        'Low work hours',
        `Low work hours (${result.totalHours}h) detected for ${dateStr}.`,
        schemaName,
        { date: dateStr, totalHours: result.totalHours },
      );
    }
    if (
      isWorkingDay &&
      result.status === 'absent' &&
      !result.firstPunchIn &&
      !result.lastPunchOut
    ) {
      await this.notificationService.create(
        userId,
        'attendance_anomaly',
        'No attendance recorded',
        `No attendance recorded for ${dateStr}.`,
        schemaName,
        { date: dateStr },
      );
    }

    // 2. Overtime (in-app only): notify employee + all with approve regularizations
    if (result.overtimeHours > 0) {
      const employeeName = await this.getEmployeeName(schemaName, userId);
      const title = 'Overtime logged';
      const message = `${employeeName} worked ${result.overtimeHours}h overtime on ${dateStr}`;
      await this.notificationService.create(
        userId,
        'overtime_logged',
        title,
        message,
        schemaName,
        { date: dateStr, overtimeHours: result.overtimeHours },
      );
      const approverIds = await this.getUsersWithApprovePermission(schemaName);
      for (const approverId of approverIds) {
        if (approverId === userId) continue;
        await this.notificationService.create(
          approverId,
          'overtime_logged',
          title,
          message,
          schemaName,
          { date: dateStr, overtimeHours: result.overtimeHours, userId },
        );
      }
    }
  }

  private async getDefaultWorkSchedule(schemaName: string): Promise<{
    workingDays: string[];
    minHoursHalfDay: number;
  } | null> {
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{ working_days: unknown; min_hours_half_day: number }>
      >(
        `SELECT working_days, min_hours_half_day FROM work_schedule WHERE is_default = true LIMIT 1`,
      );
    });
    if (rows.length === 0) return null;
    const r = rows[0];
    const workingDays = Array.isArray(r.working_days)
      ? (r.working_days as string[])
      : (typeof r.working_days === 'string' ? JSON.parse(r.working_days) : []) as string[];
    return { workingDays, minHoursHalfDay: r.min_hours_half_day };
  }

  private async getEmployeeName(schemaName: string, userId: string): Promise<string> {
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<Array<{ first_name: string; last_name: string }>>(
        `SELECT first_name, last_name FROM users WHERE id = $1::uuid`,
        userId,
      );
    });
    if (rows.length === 0) return 'Employee';
    return `${rows[0].first_name} ${rows[0].last_name}`.trim();
  }

  private async getUsersWithApprovePermission(schemaName: string): Promise<string[]> {
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<Array<{ user_id: string }>>(
        `SELECT DISTINCT ur.user_id FROM user_roles ur
         JOIN role_permissions rp ON ur.role_id = rp.role_id
         JOIN permissions p ON rp.permission_id = p.id
         JOIN users u ON ur.user_id = u.id
         WHERE p.module = 'attendance' AND p.action = 'approve' AND p.resource = 'regularizations' AND u.status = 'active'`,
      );
    });
    return rows.map((r) => r.user_id);
  }
}
