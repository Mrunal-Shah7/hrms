import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantInfo } from '../../tenant/tenant.interface';
import { getLeaveYear, getLeaveYearRange, getLeaveYearLabel } from '../utils/leave-year.util';

@Injectable()
export class LeaveSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  private async getFinancialYearStartMonth(schemaName: string): Promise<number> {
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<Array<{ financial_year_start_month: number }>>(
        `SELECT financial_year_start_month FROM organization_settings LIMIT 1`,
      );
    });
    return rows[0]?.financial_year_start_month ?? 1;
  }

  async getSummary(
    tenant: TenantInfo,
    userId: string,
    _roles: string[],
    year?: number,
    targetUserId?: string,
  ) {
    const schemaName = tenant.schemaName;
    const fyMonth = await this.getFinancialYearStartMonth(schemaName);
    const y = year ?? getLeaveYear(new Date(), fyMonth);
    const effectiveUserId = targetUserId ?? userId;
    const { startDate: yearStart, endDate: yearEnd } = getLeaveYearRange(y, fyMonth);
    const yearStartStr = yearStart.toISOString().slice(0, 10);
    const yearEndStr = yearEnd.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);

    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const balRows = await tx.$queryRawUnsafe<
        Array<{ leave_type_id: string; type_name: string; type_code: string; type_color: string | null; type_icon: string | null; type_paid: boolean; total_allocated: number; carried_forward: number; used: number }>
      >(
        `SELECT lb.leave_type_id, lt.name AS type_name, lt.code AS type_code, lt.color AS type_color, lt.icon AS type_icon, lt.is_paid AS type_paid,
                lb.total_allocated, lb.carried_forward, lb.used
         FROM leave_balances lb
         JOIN leave_types lt ON lb.leave_type_id = lt.id
         WHERE lb.user_id = $1 AND lb.year = $2`,
        effectiveUserId,
        y,
      );
      const allTypes = await tx.$queryRawUnsafe<
        Array<{ id: string; name: string; code: string; color: string | null; icon: string | null; is_paid: boolean }>
      >(`SELECT id, name, code, color, icon, is_paid FROM leave_types`);
      const byType = new Map(balRows.map((r) => [r.leave_type_id, r]));
      const balances = allTypes.map((lt) => {
        const b = byType.get(lt.id);
        const totalAllocated = b?.total_allocated ?? 0;
        const carriedForward = b?.carried_forward ?? 0;
        const used = b?.used ?? 0;
        const available = totalAllocated + carriedForward - used;
        const booked = used;
        return {
          leaveType: { id: lt.id, name: lt.name, code: lt.code, color: lt.color, icon: lt.icon, isPaid: lt.is_paid },
          available,
          booked,
          totalAllocated,
          carriedForward,
        };
      });
      const bookedRows = await tx.$queryRawUnsafe<Array<{ sum: string }>>(
        `SELECT COALESCE(SUM(total_days), 0)::text AS sum FROM leave_requests
         WHERE user_id = $1 AND status = 'approved' AND start_date >= $2::date AND end_date <= $3::date`,
        effectiveUserId,
        yearStartStr,
        yearEndStr,
      );
      const totalBooked = parseFloat(bookedRows[0]?.sum ?? '0');
      const upcomingRows = await tx.$queryRawUnsafe<
        Array<{ id: string; type_name: string; type_color: string | null; start_date: Date; end_date: Date; total_days: number; status: string }>
      >(
        `SELECT lr.id, lt.name AS type_name, lt.color AS type_color, lr.start_date, lr.end_date, lr.total_days, lr.status
         FROM leave_requests lr JOIN leave_types lt ON lr.leave_type_id = lt.id
         WHERE lr.user_id = $1 AND lr.status IN ('pending', 'approved') AND lr.start_date >= $2::date
         ORDER BY lr.start_date ASC LIMIT 20`,
        effectiveUserId,
        todayStr,
      );
      const pastRows = await tx.$queryRawUnsafe<
        Array<{ id: string; type_name: string; type_color: string | null; start_date: Date; end_date: Date; total_days: number; status: string; reason: string | null }>
      >(
        `SELECT lr.id, lt.name AS type_name, lt.color AS type_color, lr.start_date, lr.end_date, lr.total_days, lr.status, lr.reason
         FROM leave_requests lr JOIN leave_types lt ON lr.leave_type_id = lt.id
         WHERE lr.user_id = $1 AND lr.status IN ('approved', 'cancelled', 'rejected')
           AND (lr.end_date < $2::date OR lr.status = 'rejected')
         ORDER BY lr.start_date DESC LIMIT 20`,
        effectiveUserId,
        todayStr,
      );
      const upcomingHolidayRows = await tx.$queryRawUnsafe<
        Array<{ name: string; date: Date; is_optional: boolean }>
      >(
        `SELECT name, date, is_optional FROM holidays WHERE date >= $1::date AND year = $2 ORDER BY date ASC LIMIT 10`,
        todayStr,
        y,
      );
      const pastHolidayRows = await tx.$queryRawUnsafe<
        Array<{ name: string; date: Date; is_optional: boolean }>
      >(
        `SELECT name, date, is_optional FROM holidays WHERE date < $1::date AND year = $2 ORDER BY date DESC LIMIT 10`,
        todayStr,
        y,
      );
      const dateFormat = 'yyyy-MM-dd';
      const leaveYearLabel = getLeaveYearLabel(y, fyMonth);
      return {
        year: y,
        leaveYearLabel,
        yearStats: { totalBooked, totalAbsent: 0 },
        balances,
        upcomingLeaves: upcomingRows.map((r) => ({
          id: r.id,
          leaveType: { name: r.type_name, color: r.type_color },
          startDate: r.start_date,
          endDate: r.end_date,
          totalDays: r.total_days,
          status: r.status,
        })),
        pastLeaves: pastRows.map((r) => ({
          id: r.id,
          leaveType: { name: r.type_name, color: r.type_color },
          startDate: r.start_date,
          endDate: r.end_date,
          totalDays: r.total_days,
          status: r.status,
          reason: r.reason,
        })),
        upcomingHolidays: upcomingHolidayRows.map((h) => ({
          name: h.name,
          date: h.date,
          isOptional: h.is_optional,
        })),
        pastHolidays: pastHolidayRows.map((h) => ({
          name: h.name,
          date: h.date,
          isOptional: h.is_optional,
        })),
      };
    });
  }

  async getBalance(
    tenant: TenantInfo,
    userId: string,
    year?: number,
    targetUserId?: string,
  ) {
    const schemaName = tenant.schemaName;
    const fyMonth = await this.getFinancialYearStartMonth(schemaName);
    const y = year ?? getLeaveYear(new Date(), fyMonth);
    const effectiveUserId = targetUserId ?? userId;
    const { startDate: yearStart, endDate: yearEnd } = getLeaveYearRange(y, fyMonth);
    const yearStartStr = yearStart.toISOString().slice(0, 10);
    const yearEndStr = yearEnd.toISOString().slice(0, 10);

    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const types = await tx.$queryRawUnsafe<
        Array<{ id: string; name: string; code: string; color: string | null; icon: string | null; is_paid: boolean; max_consecutive_days: number | null }>
      >(`SELECT id, name, code, color, icon, is_paid, max_consecutive_days FROM leave_types`);
      const balRows = await tx.$queryRawUnsafe<
        Array<{ leave_type_id: string; total_allocated: number; carried_forward: number; used: number }>
      >(
        `SELECT leave_type_id, total_allocated, carried_forward, used FROM leave_balances
         WHERE user_id = $1 AND year = $2`,
        effectiveUserId,
        y,
      );
      const byType = new Map(balRows.map((r) => [r.leave_type_id, r]));
      const pendingRows = await tx.$queryRawUnsafe<Array<{ leave_type_id: string; sum: string }>>(
        `SELECT leave_type_id, COALESCE(SUM(total_days), 0)::text AS sum FROM leave_requests
         WHERE user_id = $1 AND status = 'pending' AND start_date >= $2::date AND end_date <= $3::date
         GROUP BY leave_type_id`,
        effectiveUserId,
        yearStartStr,
        yearEndStr,
      );
      const pendingByType = new Map(pendingRows.map((r) => [r.leave_type_id, parseFloat(r.sum)]));
      const data = types.map((lt) => {
        const b = byType.get(lt.id);
        const totalAllocated = b?.total_allocated ?? 0;
        const carriedForward = b?.carried_forward ?? 0;
        const used = b?.used ?? 0;
        const pending = pendingByType.get(lt.id) ?? 0;
        const available = totalAllocated + carriedForward - used;
        return {
          leaveType: {
            id: lt.id,
            name: lt.name,
            code: lt.code,
            color: lt.color,
            icon: lt.icon,
            isPaid: lt.is_paid,
            maxConsecutiveDays: lt.max_consecutive_days,
          },
          totalAllocated,
          carriedForward,
          used,
          pending,
          available,
        };
      });
      return data;
    });
  }
}
