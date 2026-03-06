import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantInfo } from '../../tenant/tenant.interface';

const ADMIN_HR_ROLES = ['Admin', 'HR Admin', 'HR Manager'];

function canViewAnyUser(roles: string[]): boolean {
  return roles.some((r) => ADMIN_HR_ROLES.includes(r));
}

export interface TimeLogRow {
  id: string;
  employee: { id: string; employeeId: string | null; firstName: string; lastName: string };
  punchType: 'in' | 'out';
  punchTime: string;
  source: string;
  createdAt: string;
}

export interface DailySummaryRow {
  id: string;
  date: string;
  employee: { id: string; employeeId: string | null; firstName: string; lastName: string };
  firstPunchIn: string | null;
  lastPunchOut: string | null;
  totalHours: number;
  effectiveHours: number;
  overtimeHours: number;
  status: string;
  isLate: boolean;
  isEarlyDeparture: boolean;
}

@Injectable()
export class LogsService {
  constructor(private readonly prisma: PrismaService) {}

  async getLogs(
    tenant: TenantInfo,
    currentUserId: string,
    roles: string[],
    options: {
      userId?: string;
      from: string;
      to: string;
      page: number;
      limit: number;
    },
  ): Promise<{ data: TimeLogRow[]; meta: { page: number; limit: number; total: number; totalPages: number } }> {
    const userId = options.userId ?? currentUserId;
    await this.assertCanViewUser(tenant, currentUserId, roles, userId);

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const from = options.from;
      const to = options.to;
      const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
      const page = Math.max(options.page ?? 1, 1);
      const offset = (page - 1) * limit;

      const countRows = await tx.$queryRawUnsafe<Array<{ total: string }>>(
        `SELECT COUNT(*)::text AS total FROM time_logs tl
         WHERE tl.user_id = $1::uuid AND DATE(tl.punch_time) BETWEEN $2::date AND $3::date`,
        userId,
        from,
        to,
      );
      const total = Number(countRows[0]?.total ?? 0);

      const rows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          user_id: string;
          punch_type: string;
          punch_time: Date;
          source: string;
          created_at: Date;
          employee_id: string | null;
          first_name: string;
          last_name: string;
        }>
      >(
        `SELECT tl.id, tl.user_id, tl.punch_type, tl.punch_time, tl.source, tl.created_at,
                u.employee_id, u.first_name, u.last_name
         FROM time_logs tl
         JOIN users u ON tl.user_id = u.id
         WHERE tl.user_id = $1::uuid AND DATE(tl.punch_time) BETWEEN $2::date AND $3::date
         ORDER BY tl.punch_time DESC
         LIMIT $4 OFFSET $5`,
        userId,
        from,
        to,
        limit,
        offset,
      );

      const data: TimeLogRow[] = rows.map((r) => ({
        id: r.id,
        employee: {
          id: r.user_id,
          employeeId: r.employee_id,
          firstName: r.first_name,
          lastName: r.last_name,
        },
        punchType: r.punch_type as 'in' | 'out',
        punchTime: r.punch_time.toISOString(),
        source: r.source,
        createdAt: r.created_at.toISOString(),
      }));

      return {
        data,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      };
    });
  }

  async getDailySummaries(
    tenant: TenantInfo,
    currentUserId: string,
    roles: string[],
    options: {
      userId?: string;
      from: string;
      to: string;
      page: number;
      limit: number;
    },
  ): Promise<{ data: DailySummaryRow[]; meta: { page: number; limit: number; total: number; totalPages: number } }> {
    const userId = options.userId ?? currentUserId;
    await this.assertCanViewUser(tenant, currentUserId, roles, userId);

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const from = options.from;
      const to = options.to;
      const limit = Math.min(Math.max(options.limit ?? 31, 1), 100);
      const page = Math.max(options.page ?? 1, 1);
      const offset = (page - 1) * limit;

      const countRows = await tx.$queryRawUnsafe<Array<{ total: string }>>(
        `SELECT COUNT(*)::text AS total FROM daily_time_summary dts
         WHERE dts.user_id = $1::uuid AND dts.date BETWEEN $2::date AND $3::date`,
        userId,
        from,
        to,
      );
      const total = Number(countRows[0]?.total ?? 0);

      const rows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          user_id: string;
          date: Date;
          first_punch_in: Date | null;
          last_punch_out: Date | null;
          total_hours: number;
          effective_hours: number;
          overtime_hours: number;
          status: string;
          is_late: boolean;
          is_early_departure: boolean;
          employee_id: string | null;
          first_name: string;
          last_name: string;
        }>
      >(
        `SELECT dts.id, dts.user_id, dts.date, dts.first_punch_in, dts.last_punch_out,
                dts.total_hours, dts.effective_hours, dts.overtime_hours, dts.status,
                dts.is_late, dts.is_early_departure,
                u.employee_id, u.first_name, u.last_name
         FROM daily_time_summary dts
         JOIN users u ON dts.user_id = u.id
         WHERE dts.user_id = $1::uuid AND dts.date BETWEEN $2::date AND $3::date
         ORDER BY dts.date DESC
         LIMIT $4 OFFSET $5`,
        userId,
        from,
        to,
        limit,
        offset,
      );

      const data: DailySummaryRow[] = rows.map((r) => ({
        id: r.id,
        date: (r.date as Date).toISOString().slice(0, 10),
        employee: {
          id: r.user_id,
          employeeId: r.employee_id,
          firstName: r.first_name,
          lastName: r.last_name,
        },
        firstPunchIn: r.first_punch_in ? (r.first_punch_in as Date).toISOString() : null,
        lastPunchOut: r.last_punch_out ? (r.last_punch_out as Date).toISOString() : null,
        totalHours: r.total_hours,
        effectiveHours: r.effective_hours,
        overtimeHours: r.overtime_hours,
        status: r.status,
        isLate: r.is_late,
        isEarlyDeparture: r.is_early_departure,
      }));

      return {
        data,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      };
    });
  }

  private async assertCanViewUser(
    tenant: TenantInfo,
    currentUserId: string,
    roles: string[],
    requestedUserId: string,
  ): Promise<void> {
    if (requestedUserId === currentUserId) return;
    if (canViewAnyUser(roles)) return;
    const reportee = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT 1 AS n FROM employee_profiles WHERE user_id = $1::uuid AND reports_to = $2::uuid`,
        requestedUserId,
        currentUserId,
      );
    });
    if (reportee.length === 0) {
      throw new ForbiddenException('You can only view your own or your reportees\' time data');
    }
  }
}
