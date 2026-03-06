import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExportService } from '../../core/export/export.service';
import type { ColumnDef } from '../../core/export/export.service';
import type { TenantInfo } from '../../tenant/tenant.interface';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface WorkScheduleInfo {
  name: string;
  startTime: string;
  endTime: string;
  workingDays: string[];
  gracePeriodMinutes: number;
}

export interface MySummaryDay {
  date: string;
  dayOfWeek: string;
  status: string;
  firstPunchIn: string | null;
  lastPunchOut: string | null;
  totalHours: number;
  effectiveHours: number;
  overtimeHours: number;
  isLate: boolean;
  isEarlyDeparture: boolean;
  earlyByMinutes: number | null;
  lateByMinutes: number | null;
  holiday: { name: string; isOptional: boolean } | null;
  leave: { typeName: string; typeColor: string | null; durationType: string } | null;
  regularization: { punchIn: string | null; punchOut: string | null; status: string } | null;
  punchEvents: Array<{ type: string; time: string }>;
}

export interface MySummaryAggregates {
  totalWorkingDays: number;
  daysPresent: number;
  daysAbsent: number;
  daysOnLeave: number;
  totalHoursWorked: number;
  totalOvertimeHours: number;
  lateCount: number;
  earlyDepartureCount: number;
}

export interface MySummaryResponse {
  workSchedule: WorkScheduleInfo | null;
  dateRange: { from: string; to: string };
  aggregates: MySummaryAggregates;
  days: MySummaryDay[];
}

export interface TeamMemberDay {
  date: string;
  status: string;
  totalHours: number;
  isLate: boolean;
  isEarlyDeparture: boolean;
}

export interface TeamMemberAggregates {
  daysPresent: number;
  daysAbsent: number;
  daysOnLeave: number;
  totalHoursWorked: number;
  lateCount: number;
  earlyDepartureCount: number;
}

export interface TeamMemberRow {
  employee: {
    id: string;
    employeeId: string | null;
    firstName: string;
    lastName: string;
    photoUrl: string | null;
    department: string | null;
    designation: string | null;
  };
  aggregates: TeamMemberAggregates;
  days: TeamMemberDay[];
}

export interface TeamResponse {
  data: TeamMemberRow[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

function getWeekBounds(from?: string, to?: string): { from: string; to: string } {
  const now = new Date();
  if (from && to) return { from, to };
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    from: monday.toISOString().slice(0, 10),
    to: sunday.toISOString().slice(0, 10),
  };
}

function parseTimeHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

@Injectable()
export class AttendanceSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exportService: ExportService,
  ) {}

  async getMySummary(
    tenant: TenantInfo,
    userId: string,
    from?: string,
    to?: string,
  ): Promise<MySummaryResponse> {
    const { from: fromDate, to: toDate } = getWeekBounds(from, to);
    const schemaName = tenant.schemaName;

    const [workSchedule, summaries, holidays, leaves, regularizations, timeLogs] =
      await Promise.all([
        this.getDefaultWorkSchedule(schemaName),
        this.getDailySummaries(schemaName, userId, fromDate, toDate),
        this.getHolidays(schemaName, fromDate, toDate),
        this.getApprovedLeaves(schemaName, userId, fromDate, toDate),
        this.getApprovedRegularizations(schemaName, userId, fromDate, toDate),
        this.getTimeLogs(schemaName, userId, fromDate, toDate),
      ]);

    const summaryByDate = new Map(
      summaries.map((s) => [s.date, s]),
    );
    const holidayByDate = new Map(holidays.map((h) => [h.date, h]));
    const leaveByDate = new Map<string, { typeName: string; typeColor: string | null; durationType: string }>();
    for (const l of leaves) {
      for (const d of l.dates) {
        leaveByDate.set(d, { typeName: l.leaveTypeName, typeColor: l.leaveTypeColor, durationType: l.durationType });
      }
    }
    const regByDate = new Map(regularizations.map((r) => [r.date, r]));
    const logsByDate = new Map<string, Array<{ type: string; time: string }>>();
    for (const log of timeLogs) {
      const d = log.date;
      if (!logsByDate.has(d)) logsByDate.set(d, []);
      logsByDate.get(d)!.push({ type: log.punch_type, time: log.punch_time });
    }

    const workingDaysSet = new Set(workSchedule?.workingDays ?? []);
    const days: MySummaryDay[] = [];
    const start = new Date(fromDate);
    const end = new Date(toDate);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const dayOfWeekNum = d.getDay();
      const dayOfWeek = DAY_NAMES[dayOfWeekNum];
      const dayShort = DAY_SHORT[dayOfWeekNum];
      const summary = summaryByDate.get(dateStr);
      const holiday = holidayByDate.get(dateStr);
      const leave = leaveByDate.get(dateStr);
      const reg = regByDate.get(dateStr);
      const punchEvents = logsByDate.get(dateStr) ?? [];

      let status: string;
      let firstPunchIn: string | null = null;
      let lastPunchOut: string | null = null;
      let totalHours = 0;
      let effectiveHours = 0;
      let overtimeHours = 0;
      let isLate = false;
      let isEarlyDeparture = false;

      if (summary) {
        status = summary.status;
        firstPunchIn = summary.first_punch_in ? new Date(summary.first_punch_in).toISOString() : null;
        lastPunchOut = summary.last_punch_out ? new Date(summary.last_punch_out).toISOString() : null;
        totalHours = summary.total_hours;
        effectiveHours = summary.effective_hours;
        overtimeHours = summary.overtime_hours;
        isLate = summary.is_late;
        isEarlyDeparture = summary.is_early_departure;
      } else {
        const isWeekend = !workingDaysSet.has(dayShort);
        if (isWeekend) status = 'weekend';
        else if (holiday) status = 'holiday';
        else if (leave) status = 'on_leave';
        else status = 'no_data';
      }

      let earlyByMinutes: number | null = null;
      let lateByMinutes: number | null = null;
      if (workSchedule && status !== 'weekend' && status !== 'holiday') {
        if (isEarlyDeparture && lastPunchOut) {
          const [eh, em] = workSchedule.endTime.split(':').map(Number);
          const endMs = (eh ?? 0) * 60 + (em ?? 0);
          const outDate = new Date(lastPunchOut);
          const outMs = outDate.getHours() * 60 + outDate.getMinutes();
          earlyByMinutes = endMs - outMs;
        }
        if (isLate && firstPunchIn) {
          const startM = parseTimeHHMM(workSchedule.startTime) + (workSchedule.gracePeriodMinutes ?? 0);
          const inDate = new Date(firstPunchIn);
          const inM = inDate.getHours() * 60 + inDate.getMinutes();
          lateByMinutes = inM - startM;
        }
      }

      days.push({
        date: dateStr,
        dayOfWeek,
        status,
        firstPunchIn,
        lastPunchOut,
        totalHours,
        effectiveHours,
        overtimeHours,
        isLate,
        isEarlyDeparture,
        earlyByMinutes,
        lateByMinutes,
        holiday: holiday ? { name: holiday.name, isOptional: holiday.is_optional } : null,
        leave: leave ?? null,
        regularization: reg ? { punchIn: reg.punch_in, punchOut: reg.punch_out, status: reg.status } : null,
        punchEvents: punchEvents.sort(
          (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
        ),
      });
    }

    const totalWorkingDays = days.filter(
      (d) => workingDaysSet.has(DAY_SHORT[new Date(d.date).getDay()]) && !holidayByDate.has(d.date),
    ).length;
    const aggregates: MySummaryAggregates = {
      totalWorkingDays,
      daysPresent: days.filter((d) => d.status === 'present' || d.status === 'half_day').length,
      daysAbsent: days.filter((d) => d.status === 'absent').length,
      daysOnLeave: days.filter((d) => d.status === 'on_leave').length,
      totalHoursWorked: days.reduce((s, d) => s + d.totalHours, 0),
      totalOvertimeHours: days.reduce((s, d) => s + d.overtimeHours, 0),
      lateCount: days.filter((d) => d.isLate).length,
      earlyDepartureCount: days.filter((d) => d.isEarlyDeparture).length,
    };

    return {
      workSchedule: workSchedule ?? null,
      dateRange: { from: fromDate, to: toDate },
      aggregates,
      days,
    };
  }

  async getTeam(
    tenant: TenantInfo,
    currentUserId: string,
    permissions: string[],
    from: string | undefined,
    to: string | undefined,
    departmentId: string | undefined,
    page: number,
    limit: number,
  ): Promise<TeamResponse> {
    const { from: fromDate, to: toDate } = getWeekBounds(from, to);
    const seeAll = permissions.includes('attendance:approve:regularizations');
    const schemaName = tenant.schemaName;

    const { employeeIds, total } = await this.getTeamEmployeeIds(
      schemaName,
      currentUserId,
      seeAll,
      departmentId,
      page,
      limit,
    );
    if (employeeIds.length === 0) {
      return {
        data: [],
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
      };
    }

    const employees = await this.getEmployeeDetails(schemaName, employeeIds);
    const summariesByUser = await this.getDailySummariesForUsers(schemaName, employeeIds, fromDate, toDate);
    const workingDaysSet = await this.getWorkingDaysSet(schemaName);

    const data: TeamMemberRow[] = employeeIds.map((id) => {
      const emp = employees.get(id);
      const summaries = summariesByUser.get(id) ?? [];
      const summaryByDate = new Map(summaries.map((s) => [s.date, s]));
      const days: TeamMemberDay[] = [];
      const start = new Date(fromDate);
      const end = new Date(toDate);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        const s = summaryByDate.get(dateStr);
        let status = s?.status ?? 'no_data';
        const dayShort = DAY_SHORT[d.getDay()];
        if (!s && !workingDaysSet.has(dayShort)) status = 'weekend';
        days.push({
          date: dateStr,
          status,
          totalHours: s?.total_hours ?? 0,
          isLate: s?.is_late ?? false,
          isEarlyDeparture: s?.is_early_departure ?? false,
        });
      }
      const aggregates: TeamMemberAggregates = {
        daysPresent: days.filter((d) => d.status === 'present' || d.status === 'half_day').length,
        daysAbsent: days.filter((d) => d.status === 'absent').length,
        daysOnLeave: days.filter((d) => d.status === 'on_leave').length,
        totalHoursWorked: days.reduce((s, d) => s + d.totalHours, 0),
        lateCount: days.filter((d) => d.isLate).length,
        earlyDepartureCount: days.filter((d) => d.isEarlyDeparture).length,
      };
      return {
        employee: emp ?? {
          id,
          employeeId: null,
          firstName: '',
          lastName: '',
          photoUrl: null,
          department: null,
          designation: null,
        },
        aggregates,
        days,
      };
    });

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async getReportees(
    tenant: TenantInfo,
    currentUserId: string,
    from: string | undefined,
    to: string | undefined,
    page: number,
    limit: number,
  ): Promise<TeamResponse> {
    const { from: fromDate, to: toDate } = getWeekBounds(from, to);
    const schemaName = tenant.schemaName;
    const { employeeIds, total } = await this.getReporteeIds(schemaName, currentUserId, page, limit);
    if (employeeIds.length === 0) {
      return {
        data: [],
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
      };
    }
    const employees = await this.getEmployeeDetails(schemaName, employeeIds);
    const summariesByUser = await this.getDailySummariesForUsers(schemaName, employeeIds, fromDate, toDate);
    const workingDaysSet = await this.getWorkingDaysSet(schemaName);

    const data: TeamMemberRow[] = employeeIds.map((id) => {
      const emp = employees.get(id);
      const summaries = summariesByUser.get(id) ?? [];
      const summaryByDate = new Map(summaries.map((s) => [s.date, s]));
      const days: TeamMemberDay[] = [];
      const start = new Date(fromDate);
      const end = new Date(toDate);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        const s = summaryByDate.get(dateStr);
        let status = s?.status ?? 'no_data';
        const dayShort = DAY_SHORT[d.getDay()];
        if (!s && !workingDaysSet.has(dayShort)) status = 'weekend';
        days.push({
          date: dateStr,
          status,
          totalHours: s?.total_hours ?? 0,
          isLate: s?.is_late ?? false,
          isEarlyDeparture: s?.is_early_departure ?? false,
        });
      }
      const aggregates: TeamMemberAggregates = {
        daysPresent: days.filter((d) => d.status === 'present' || d.status === 'half_day').length,
        daysAbsent: days.filter((d) => d.status === 'absent').length,
        daysOnLeave: days.filter((d) => d.status === 'on_leave').length,
        totalHoursWorked: days.reduce((s, d) => s + d.totalHours, 0),
        lateCount: days.filter((d) => d.isLate).length,
        earlyDepartureCount: days.filter((d) => d.isEarlyDeparture).length,
      };
      return {
        employee: emp ?? {
          id,
          employeeId: null,
          firstName: '',
          lastName: '',
          photoUrl: null,
          department: null,
          designation: null,
        },
        aggregates,
        days,
      };
    });

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  private async getDefaultWorkSchedule(schemaName: string): Promise<WorkScheduleInfo | null> {
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{
          name: string;
          start_time: string;
          end_time: string;
          working_days: unknown;
          grace_period_minutes: number;
        }>
      >(
        `SELECT name, start_time, end_time, working_days, grace_period_minutes
         FROM work_schedule WHERE is_default = true LIMIT 1`,
      );
    });
    if (rows.length === 0) return null;
    const r = rows[0];
    const workingDays = Array.isArray(r.working_days)
      ? (r.working_days as string[])
      : (typeof r.working_days === 'string' ? JSON.parse(r.working_days) : []) as string[];
    return {
      name: r.name,
      startTime: r.start_time,
      endTime: r.end_time,
      workingDays,
      gracePeriodMinutes: r.grace_period_minutes,
    };
  }

  private async getDailySummaries(
    schemaName: string,
    userId: string,
    from: string,
    to: string,
  ) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{
          date: string;
          first_punch_in: Date | null;
          last_punch_out: Date | null;
          total_hours: number;
          effective_hours: number;
          overtime_hours: number;
          status: string;
          is_late: boolean;
          is_early_departure: boolean;
        }>
      >(
        `SELECT date::text, first_punch_in, last_punch_out, total_hours, effective_hours, overtime_hours, status, is_late, is_early_departure
         FROM daily_time_summary WHERE user_id = $1::uuid AND date BETWEEN $2::date AND $3::date ORDER BY date`,
        userId,
        from,
        to,
      );
    });
  }

  private async getHolidays(schemaName: string, from: string, to: string) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{ date: string; name: string; is_optional: boolean }>
      >(
        `SELECT date::text, name, is_optional FROM holidays WHERE date BETWEEN $1::date AND $2::date`,
        from,
        to,
      );
    });
  }

  private async getApprovedLeaves(
    schemaName: string,
    userId: string,
    from: string,
    to: string,
  ) {
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{
          start_date: Date;
          end_date: Date;
          duration_type: string;
          leave_type_name: string;
          leave_type_color: string | null;
        }>
      >(
        `SELECT lr.start_date, lr.end_date, lr.duration_type, lt.name AS leave_type_name, lt.color AS leave_type_color
         FROM leave_requests lr
         JOIN leave_types lt ON lr.leave_type_id = lt.id
         WHERE lr.user_id = $1::uuid AND lr.status = 'approved'
           AND lr.start_date <= $2::date AND lr.end_date >= $3::date`,
        userId,
        to,
        from,
      );
    });
    const result: Array<{
      dates: string[];
      durationType: string;
      leaveTypeName: string;
      leaveTypeColor: string | null;
    }> = [];
    for (const r of rows) {
      const dates: string[] = [];
      const start = new Date(r.start_date);
      const end = new Date(r.end_date);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        if (dateStr >= from && dateStr <= to) dates.push(dateStr);
      }
      result.push({
        dates,
        durationType: r.duration_type,
        leaveTypeName: r.leave_type_name,
        leaveTypeColor: r.leave_type_color,
      });
    }
    return result;
  }

  private async getApprovedRegularizations(
    schemaName: string,
    userId: string,
    from: string,
    to: string,
  ) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{ date: string; punch_in: string | null; punch_out: string | null; status: string }>
      >(
        `SELECT date::text, punch_in, punch_out, status FROM attendance_regularizations
         WHERE user_id = $1::uuid AND status = 'approved' AND date BETWEEN $2::date AND $3::date`,
        userId,
        from,
        to,
      );
    });
  }

  private async getTimeLogs(
    schemaName: string,
    userId: string,
    from: string,
    to: string,
  ) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{ date: string; punch_type: string; punch_time: string }>
      >(
        `SELECT DATE(punch_time)::text AS date, punch_type, punch_time::text AS punch_time
         FROM time_logs WHERE user_id = $1::uuid AND DATE(punch_time) BETWEEN $2::date AND $3::date ORDER BY punch_time`,
        userId,
        from,
        to,
      );
    });
  }

  private async getTeamEmployeeIds(
    schemaName: string,
    currentUserId: string,
    seeAll: boolean,
    departmentId: string | undefined,
    page: number,
    limit: number,
  ): Promise<{ employeeIds: string[]; total: number }> {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const offset = (page - 1) * limit;
      if (seeAll) {
        let sql = `SELECT u.id FROM users u LEFT JOIN employee_profiles ep ON u.id = ep.user_id WHERE u.status = 'active'`;
        const params: unknown[] = [];
        let p = 1;
        if (departmentId) {
          sql += ` AND ep.department_id = $${p++}::uuid`;
          params.push(departmentId);
        }
        const countSql = `SELECT COUNT(*)::text AS count FROM users u LEFT JOIN employee_profiles ep ON u.id = ep.user_id WHERE u.status = 'active'${departmentId ? ' AND ep.department_id = $1::uuid' : ''}`;
        const countRows = await tx.$queryRawUnsafe<Array<{ count: string }>>(
          countSql,
          ...(departmentId ? [departmentId] : []),
        );
        const total = Number(countRows[0]?.count ?? 0);
        sql += ` ORDER BY u.first_name, u.last_name LIMIT $${p++} OFFSET $${p++}`;
        params.push(limit, offset);
        const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(sql, ...params);
        return { employeeIds: rows.map((r) => r.id), total };
      } else {
        const countRows = await tx.$queryRawUnsafe<Array<{ count: string }>>(
          `SELECT COUNT(*)::text AS count FROM users u JOIN employee_profiles ep ON u.id = ep.user_id WHERE u.status = 'active' AND ep.reports_to = $1::uuid`,
          currentUserId,
        );
        const total = Number(countRows[0]?.count ?? 0);
        const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT u.id FROM users u JOIN employee_profiles ep ON u.id = ep.user_id WHERE u.status = 'active' AND ep.reports_to = $1::uuid ORDER BY u.first_name, u.last_name LIMIT $2 OFFSET $3`,
          currentUserId,
          limit,
          offset,
        );
        return { employeeIds: rows.map((r) => r.id), total };
      }
    });
  }

  private async getReporteeIds(
    schemaName: string,
    currentUserId: string,
    page: number,
    limit: number,
  ): Promise<{ employeeIds: string[]; total: number }> {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const offset = (page - 1) * limit;
      const countRows = await tx.$queryRawUnsafe<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS count FROM users u JOIN employee_profiles ep ON u.id = ep.user_id WHERE u.status = 'active' AND ep.reports_to = $1::uuid`,
        currentUserId,
      );
      const total = Number(countRows[0]?.count ?? 0);
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT u.id FROM users u JOIN employee_profiles ep ON u.id = ep.user_id WHERE u.status = 'active' AND ep.reports_to = $1::uuid ORDER BY u.first_name, u.last_name LIMIT $2 OFFSET $3`,
        currentUserId,
        limit,
        offset,
      );
      return { employeeIds: rows.map((r) => r.id), total };
    });
  }

  private async getEmployeeDetails(
    schemaName: string,
    userIds: string[],
  ): Promise<Map<string, { id: string; employeeId: string | null; firstName: string; lastName: string; photoUrl: string | null; department: string | null; designation: string | null }>> {
    if (userIds.length === 0) return new Map();
    const placeholders = userIds.map((_, i) => `$${i + 1}::uuid`).join(', ');
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{
          id: string;
          employee_id: string | null;
          first_name: string;
          last_name: string;
          photo_url: string | null;
          department_name: string | null;
          designation_name: string | null;
        }>
      >(
        `SELECT u.id, u.employee_id, u.first_name, u.last_name, u.photo_url, d.name AS department_name, des.name AS designation_name
         FROM users u
         LEFT JOIN employee_profiles ep ON u.id = ep.user_id
         LEFT JOIN departments d ON ep.department_id = d.id
         LEFT JOIN designations des ON ep.designation_id = des.id
         WHERE u.id IN (${placeholders})`,
        ...userIds,
      );
    });
    const map = new Map();
    for (const r of rows) {
      map.set(r.id, {
        id: r.id,
        employeeId: r.employee_id,
        firstName: r.first_name,
        lastName: r.last_name,
        photoUrl: r.photo_url,
        department: r.department_name,
        designation: r.designation_name,
      });
    }
    return map;
  }

  private async getDailySummariesForUsers(
    schemaName: string,
    userIds: string[],
    from: string,
    to: string,
  ): Promise<Map<string, Array<{ date: string; total_hours: number; status: string; is_late: boolean; is_early_departure: boolean }>>> {
    if (userIds.length === 0) return new Map();
    const placeholders = userIds.map((_, i) => `$${i + 1}::uuid`).join(', ');
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{
          user_id: string;
          date: string;
          total_hours: number;
          status: string;
          is_late: boolean;
          is_early_departure: boolean;
        }>
      >(
        `SELECT user_id::text, date::text, total_hours, status, is_late, is_early_departure
         FROM daily_time_summary WHERE user_id IN (${placeholders}) AND date BETWEEN $${userIds.length + 1}::date AND $${userIds.length + 2}::date ORDER BY user_id, date`,
        ...userIds,
        from,
        to,
      );
    });
    const map = new Map<string, Array<{ date: string; total_hours: number; status: string; is_late: boolean; is_early_departure: boolean }>>();
    for (const r of rows) {
      if (!map.has(r.user_id)) map.set(r.user_id, []);
      map.get(r.user_id)!.push({
        date: r.date,
        total_hours: r.total_hours,
        status: r.status,
        is_late: r.is_late,
        is_early_departure: r.is_early_departure,
      });
    }
    return map;
  }

  private async getWorkingDaysSet(schemaName: string): Promise<Set<string>> {
    const ws = await this.getDefaultWorkSchedule(schemaName);
    return new Set(ws?.workingDays ?? []);
  }

  async export(
    tenant: TenantInfo,
    currentUserId: string,
    permissions: string[],
    from: string | undefined,
    to: string | undefined,
    departmentId: string | undefined,
    format: 'csv' | 'xlsx' | 'pdf',
  ): Promise<{ buffer: Buffer; fromDate: string; toDate: string }> {
    const { from: fromDate, to: toDate } = getWeekBounds(from, to);
    const seeAll = permissions.includes('attendance:approve:regularizations');
    const schemaName = tenant.schemaName;
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      let sql = `
        SELECT u.employee_id, u.first_name, u.last_name, d.name AS department_name,
               dts.date::text, dts.first_punch_in, dts.last_punch_out, dts.total_hours, dts.overtime_hours,
               dts.status, dts.is_late, dts.is_early_departure
        FROM daily_time_summary dts
        JOIN users u ON dts.user_id = u.id
        LEFT JOIN employee_profiles ep ON u.id = ep.user_id
        LEFT JOIN departments d ON ep.department_id = d.id
        WHERE u.status = 'active' AND dts.date BETWEEN $1::date AND $2::date
      `;
      const params: unknown[] = [fromDate, toDate];
      if (seeAll && departmentId) {
        sql += ` AND ep.department_id = $3::uuid`;
        params.push(departmentId);
      }
      if (!seeAll) {
        sql += ` AND ep.reports_to = $${params.length + 1}::uuid`;
        params.push(currentUserId);
      }
      sql += ` ORDER BY u.first_name, u.last_name, dts.date`;
      return tx.$queryRawUnsafe<
        Array<{
          employee_id: string | null;
          first_name: string;
          last_name: string;
          department_name: string | null;
          date: string;
          first_punch_in: Date | null;
          last_punch_out: Date | null;
          total_hours: number;
          overtime_hours: number;
          status: string;
          is_late: boolean;
          is_early_departure: boolean;
        }>
      >(sql, ...params);
    });
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const exportData: Record<string, unknown>[] = rows.map((r) => ({
      employeeId: r.employee_id ?? '',
      employeeName: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(),
      department: r.department_name ?? '',
      date: r.date,
      day: dayNames[new Date(r.date).getDay()],
      firstIn: r.first_punch_in ? new Date(r.first_punch_in).toISOString().slice(11, 16) : '',
      lastOut: r.last_punch_out ? new Date(r.last_punch_out).toISOString().slice(11, 16) : '',
      totalHours: r.total_hours,
      overtimeHours: r.overtime_hours,
      status: r.status,
      late: r.is_late ? 'Yes' : 'No',
      earlyDeparture: r.is_early_departure ? 'Yes' : 'No',
    }));
    const columns: ColumnDef[] = [
      { key: 'employeeId', header: 'Employee ID' },
      { key: 'employeeName', header: 'Employee Name' },
      { key: 'department', header: 'Department' },
      { key: 'date', header: 'Date' },
      { key: 'day', header: 'Day' },
      { key: 'firstIn', header: 'First In' },
      { key: 'lastOut', header: 'Last Out' },
      { key: 'totalHours', header: 'Total Hours' },
      { key: 'overtimeHours', header: 'Overtime Hours' },
      { key: 'status', header: 'Status' },
      { key: 'late', header: 'Late' },
      { key: 'earlyDeparture', header: 'Early Departure' },
    ];
    const buffer =
      format === 'csv'
        ? await this.exportService.toCsv(exportData, columns)
        : format === 'xlsx'
          ? await this.exportService.toXlsx(exportData, columns, { sheetName: 'Attendance' })
          : await this.exportService.toPdf(exportData, columns, { title: 'Attendance' });
    return { buffer, fromDate, toDate };
  }
}
