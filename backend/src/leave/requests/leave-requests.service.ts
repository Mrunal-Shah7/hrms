import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExportService } from '../../core/export/export.service';
import { NotificationService } from '../../core/notification/notification.service';
import { EmailService } from '../../core/email/email.service';
import { TenantInfo } from '../../tenant/tenant.interface';
import { getLeaveYear, getLeaveYearRange } from '../utils/leave-year.util';
import { calculateLeaveDays, type HolidayInRange, type WorkSchedule } from '../utils/day-calculator.util';
import type { ApplyLeaveDto } from './dto/apply-leave.dto';
import type { ReviewLeaveDto } from './dto/review-leave.dto';
import type { ListLeaveRequestsQueryDto } from './dto/list-leave-requests-query.dto';
import type { ColumnDef } from '../../core/export/export.service';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

@Injectable()
export class LeaveRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exportService: ExportService,
    private readonly notificationService: NotificationService,
    private readonly emailService: EmailService,
  ) {}

  private async getFinancialYearStartMonth(schemaName: string): Promise<number> {
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<Array<{ financial_year_start_month: number }>>(
        `SELECT financial_year_start_month FROM organization_settings LIMIT 1`,
      );
    });
    return rows[0]?.financial_year_start_month ?? 1;
  }

  private async getDefaultWorkSchedule(schemaName: string): Promise<WorkSchedule> {
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<Array<{ working_days: unknown }>>(
        `SELECT working_days FROM work_schedule WHERE is_default = true LIMIT 1`,
      );
    });
    const wd = rows[0]?.working_days;
    if (Array.isArray(wd)) return { workingDays: wd as number[] | string[] };
    return { workingDays: [1, 2, 3, 4, 5] };
  }

  private async getHolidaysInRange(
    schemaName: string,
    startDate: string,
    endDate: string,
  ): Promise<HolidayInRange[]> {
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<Array<{ date: Date; name: string; is_optional: boolean }>>(
        `SELECT date, name, is_optional FROM holidays WHERE date >= $1::date AND date <= $2::date ORDER BY date`,
        startDate,
        endDate,
      );
    });
    return rows.map((r) => ({
      date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
      name: r.name,
      isOptional: r.is_optional,
    }));
  }

  private async getUsersWithApprovePermission(schemaName: string): Promise<string[]> {
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<Array<{ user_id: string }>>(
        `SELECT DISTINCT ur.user_id
         FROM user_roles ur
         JOIN role_permissions rp ON ur.role_id = rp.role_id
         JOIN permissions p ON rp.permission_id = p.id
         JOIN users u ON ur.user_id = u.id
         WHERE p.module = 'leave' AND p.action = 'approve' AND p.resource = 'leave_requests'
           AND u.status = 'active'`,
      );
    });
    return rows.map((r) => r.user_id);
  }

  private async insertAuditLog(
    schemaName: string,
    userId: string | null,
    action: string,
    module: string,
    entityType: string,
    entityId: string,
    oldValue: object | null,
    newValue: object | null,
  ) {
    await this.prisma.withTenantSchema(schemaName, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO audit_logs (id, user_id, action, module, entity_type, entity_id, old_value, new_value, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, NOW())`,
        userId ?? null,
        action,
        module,
        entityType,
        entityId,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
      );
    });
  }

  async preview(
    tenant: TenantInfo,
    startDate: string,
    endDate: string,
    durationType: 'full_day' | 'first_half' | 'second_half' = 'full_day',
  ) {
    const schemaName = tenant.schemaName;
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) {
      throw new BadRequestException('End date must be on or after start date');
    }
    if ((durationType === 'first_half' || durationType === 'second_half') && startDate !== endDate) {
      return { totalDays: 0, breakdown: [], holidaysInRange: [], message: 'Half-day is only valid for a single day' };
    }
    const workSchedule = await this.getDefaultWorkSchedule(schemaName);
    const holidays = await this.getHolidaysInRange(schemaName, startDate, endDate);
    const result = calculateLeaveDays(start, end, durationType, holidays, workSchedule);
    return {
      totalDays: result.totalDays,
      breakdown: result.breakdown,
      holidaysInRange: result.holidaysInRange,
    };
  }

  async apply(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    dto: ApplyLeaveDto,
  ) {
    const schemaName = tenant.schemaName;
    const fyMonth = await this.getFinancialYearStartMonth(schemaName);
    const canBackdate = roles.includes('Admin') || roles.includes('HR Admin') || roles.includes('HR Manager');
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);

    if (end < start) {
      throw new BadRequestException('End date must be on or after start date');
    }
    if ((dto.durationType === 'first_half' || dto.durationType === 'second_half') && dto.startDate !== dto.endDate) {
      throw new BadRequestException('Half-day leave can only be applied for a single day');
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!canBackdate && start < today) {
      throw new BadRequestException('Cannot apply leave for past dates');
    }

    const workSchedule = await this.getDefaultWorkSchedule(schemaName);
    const holidays = await this.getHolidaysInRange(schemaName, dto.startDate, dto.endDate);
    const { totalDays, breakdown, holidaysInRange } = calculateLeaveDays(
      start,
      end,
      dto.durationType ?? 'full_day',
      holidays,
      workSchedule,
    );
    if (totalDays === 0) {
      throw new BadRequestException('No working days in the selected date range');
    }

    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const ltRows = await tx.$queryRawUnsafe<Array<{ id: string; name: string; code: string; color: string | null; is_paid: boolean; max_consecutive_days: number | null }>>(
        `SELECT id, name, code, color, is_paid, max_consecutive_days FROM leave_types WHERE id = $1`,
        dto.leaveTypeId,
      );
      if (ltRows.length === 0) throw new NotFoundException('Leave type not found');
      const leaveType = ltRows[0];
      if (leaveType.max_consecutive_days != null && totalDays > leaveType.max_consecutive_days) {
        throw new BadRequestException(
          `Maximum consecutive days for ${leaveType.name} is ${leaveType.max_consecutive_days}. You requested ${totalDays} days.`,
        );
      }

      const overlap = await tx.$queryRawUnsafe<Array<{ id: string; status: string; start_date: Date; end_date: Date }>>(
        `SELECT id, status, start_date, end_date FROM leave_requests
         WHERE user_id = $1 AND status IN ('pending', 'approved')
           AND start_date <= $2::date AND end_date >= $3::date`,
        userId,
        dto.endDate,
        dto.startDate,
      );
      if (overlap.length > 0) {
        const o = overlap[0];
        throw new ConflictException(
          `You already have a ${o.status} leave request (${(o.start_date as Date).toISOString().slice(0, 10)} to ${(o.end_date as Date).toISOString().slice(0, 10)}) overlapping with this period`,
        );
      }

      const leaveYear = getLeaveYear(start, fyMonth);
      const { startDate: yearStart, endDate: yearEnd } = getLeaveYearRange(leaveYear, fyMonth);
      const yearStartStr = yearStart.toISOString().slice(0, 10);
      const yearEndStr = yearEnd.toISOString().slice(0, 10);

      let available = 0;
      let pendingDays = 0;
      if (leaveType.code !== 'LWP' && leaveType.is_paid !== false) {
        const balRows = await tx.$queryRawUnsafe<Array<{ total_allocated: number; carried_forward: number; used: number }>>(
          `SELECT total_allocated, carried_forward, used FROM leave_balances
           WHERE user_id = $1 AND leave_type_id = $2 AND year = $3`,
          userId,
          dto.leaveTypeId,
          leaveYear,
        );
        if (balRows.length > 0) {
          const b = balRows[0];
          available = b.total_allocated + b.carried_forward - b.used;
        }
        const pendRows = await tx.$queryRawUnsafe<Array<{ sum: string }>>(
          `SELECT COALESCE(SUM(total_days), 0)::text AS sum FROM leave_requests
           WHERE user_id = $1 AND leave_type_id = $2 AND status = 'pending'
             AND start_date >= $3::date AND end_date <= $4::date`,
          userId,
          dto.leaveTypeId,
          yearStartStr,
          yearEndStr,
        );
        pendingDays = parseFloat(pendRows[0]?.sum ?? '0');
        const effectiveAvailable = available - pendingDays;
        if (totalDays > effectiveAvailable) {
          throw new BadRequestException(
            `Insufficient leave balance. Available: ${effectiveAvailable} days, Requested: ${totalDays} days`,
          );
        }
      }

      const warnings: string[] = [];
      if (holidaysInRange.length > 0) {
        const names = holidaysInRange.map((h) => h.name).join(', ');
        warnings.push(`Your leave period includes ${holidaysInRange.length} holiday(s): ${names}. These days are not deducted from your balance.`);
      }

      const id = crypto.randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO leave_requests (id, user_id, leave_type_id, start_date, end_date, duration_type, total_days, reason, team_email, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, 'pending', NOW(), NOW())`,
        id,
        userId,
        dto.leaveTypeId,
        dto.startDate,
        dto.endDate,
        dto.durationType ?? 'full_day',
        totalDays,
        dto.reason ?? null,
        dto.teamEmail ?? null,
      );
      await this.insertAuditLog(schemaName, userId, 'create', 'leave', 'leave_requests', id, null, {
        leaveTypeId: dto.leaveTypeId,
        startDate: dto.startDate,
        endDate: dto.endDate,
        totalDays,
      });

      const approverIds = await this.getUsersWithApprovePermission(schemaName);
      const empRows = await tx.$queryRawUnsafe<Array<{ first_name: string; last_name: string }>>(
        `SELECT first_name, last_name FROM users WHERE id = $1`,
        userId,
      );
      const empName = empRows[0] ? `${empRows[0].first_name} ${empRows[0].last_name}` : 'Employee';
      const notifTitle = 'Leave request submitted';
      const notifMessage = `${empName} has applied for ${totalDays} day(s) of ${leaveType.name} from ${dto.startDate} to ${dto.endDate}`;
      const notifData = { requestId: id, userId, leaveTypeId: dto.leaveTypeId, startDate: dto.startDate, endDate: dto.endDate, totalDays };
      for (const aid of approverIds) {
        if (aid !== userId) {
          this.notificationService.create(aid, 'leave_request_submitted', notifTitle, notifMessage, schemaName, notifData).catch(() => {});
        }
      }

      const currentAvailable = leaveType.code === 'LWP' || !leaveType.is_paid ? null : available;
      const afterApproval = currentAvailable != null ? currentAvailable - totalDays : null;
      return {
        id,
        leaveType: { id: leaveType.id, name: leaveType.name, code: leaveType.code, color: leaveType.color },
        startDate: dto.startDate,
        endDate: dto.endDate,
        durationType: dto.durationType ?? 'full_day',
        totalDays,
        reason: dto.reason,
        status: 'pending',
        createdAt: new Date(),
        breakdown,
        balanceImpact: currentAvailable != null ? {
          currentAvailable,
          afterApproval: afterApproval ?? 0,
          estimatedYearEnd: afterApproval,
        } : undefined,
        warnings,
      };
    });
  }

  async list(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    query: ListLeaveRequestsQueryDto,
  ) {
    const schemaName = tenant.schemaName;
    const fyMonth = await this.getFinancialYearStartMonth(schemaName);
    const year = query.year ?? getLeaveYear(new Date(), fyMonth);
    const { startDate: yearStart, endDate: yearEnd } = getLeaveYearRange(year, fyMonth);
    const yearStartStr = yearStart.toISOString().slice(0, 10);
    const yearEndStr = yearEnd.toISOString().slice(0, 10);
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const offset = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';
    const sortColMap: Record<string, string> = {
      createdAt: 'lr.created_at',
      startDate: 'lr.start_date',
      endDate: 'lr.end_date',
      status: 'lr.status',
    };
    const orderCol = sortColMap[sortBy] ?? 'lr.created_at';

    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const conditions: string[] = [`lr.start_date >= $1::date`, `lr.start_date <= $2::date`];
      const params: unknown[] = [yearStartStr, yearEndStr];
      let p = 3;
      if (query.status) {
        conditions.push(`lr.status = $${p++}`);
        params.push(query.status);
      }
      if (query.leaveTypeId) {
        conditions.push(`lr.leave_type_id = $${p++}`);
        params.push(query.leaveTypeId);
      }
      const isAdminOrHr = roles.includes('Admin') || roles.includes('HR Admin') || roles.includes('HR Manager');
      if (query.userId && isAdminOrHr) {
        conditions.push(`lr.user_id = $${p++}`);
        params.push(query.userId);
      } else if (!isAdminOrHr) {
        if (roles.includes('Manager / Team Lead')) {
          conditions.push(`(lr.user_id = $${p} OR ep.reports_to = $${p})`);
          params.push(userId);
          p++;
        } else {
          conditions.push(`lr.user_id = $${p++}`);
          params.push(userId);
        }
      }
      const whereClause = conditions.join(' AND ');
      const fromClause = `leave_requests lr
        JOIN leave_types lt ON lr.leave_type_id = lt.id
        JOIN users u ON lr.user_id = u.id
        LEFT JOIN employee_profiles ep ON u.id = ep.user_id
        LEFT JOIN departments d ON ep.department_id = d.id
        LEFT JOIN designations des ON ep.designation_id = des.id
        LEFT JOIN users rv ON lr.reviewed_by = rv.id`;
      const countResult = await tx.$queryRawUnsafe<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS count FROM ${fromClause} WHERE ${whereClause}`,
        ...params,
      );
      const total = parseInt(countResult[0]?.count ?? '0', 10);
      const rows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          user_id: string;
          employee_id: string | null;
          first_name: string;
          last_name: string;
          photo_url: string | null;
          department_name: string | null;
          designation_name: string | null;
          type_id: string;
          type_name: string;
          type_code: string;
          type_color: string | null;
          start_date: Date;
          end_date: Date;
          duration_type: string;
          total_days: number;
          reason: string | null;
          status: string;
          reviewer_first: string | null;
          reviewer_last: string | null;
          review_comment: string | null;
          reviewed_at: Date | null;
          created_at: Date;
        }>
      >(
        `SELECT lr.id, lr.user_id, u.employee_id, u.first_name, u.last_name, u.photo_url,
                d.name AS department_name, des.name AS designation_name,
                lt.id AS type_id, lt.name AS type_name, lt.code AS type_code, lt.color AS type_color,
                lr.start_date, lr.end_date, lr.duration_type, lr.total_days, lr.reason, lr.status,
                rv.first_name AS reviewer_first, rv.last_name AS reviewer_last, lr.review_comment, lr.reviewed_at, lr.created_at
         FROM ${fromClause}
         WHERE ${whereClause}
         ORDER BY ${orderCol} ${sortOrder === 'DESC' ? 'DESC' : 'ASC'}
         LIMIT $${p} OFFSET $${p + 1}`,
        ...params,
        limit,
        offset,
      );
      const data = rows.map((r) => ({
        id: r.id,
        employee: {
          id: r.user_id,
          employeeId: r.employee_id,
          firstName: r.first_name,
          lastName: r.last_name,
          photoUrl: r.photo_url,
          department: r.department_name,
          designation: r.designation_name,
        },
        leaveType: { id: r.type_id, name: r.type_name, code: r.type_code, color: r.type_color },
        startDate: r.start_date,
        endDate: r.end_date,
        durationType: r.duration_type,
        totalDays: r.total_days,
        reason: r.reason,
        status: r.status,
        reviewer: r.reviewer_first ? { firstName: r.reviewer_first, lastName: r.reviewer_last } : null,
        createdAt: r.created_at,
      }));
      return {
        data,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  async findOne(tenant: TenantInfo, userId: string, roles: string[], id: string) {
    const schemaName = tenant.schemaName;
    const isAdminOrHr = roles.includes('Admin') || roles.includes('HR Admin') || roles.includes('HR Manager');
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          user_id: string;
          leave_type_id: string;
          start_date: Date;
          end_date: Date;
          duration_type: string;
          total_days: number;
          reason: string | null;
          team_email: string | null;
          status: string;
          reviewed_by: string | null;
          review_comment: string | null;
          reviewed_at: Date | null;
          created_at: Date;
          type_name: string;
          type_code: string;
          type_color: string | null;
          emp_id: string | null;
          first_name: string;
          last_name: string;
          photo_url: string | null;
          dept_name: string | null;
          desig_name: string | null;
          rv_first: string | null;
          rv_last: string | null;
        }>
      >(
        `SELECT lr.id, lr.user_id, lr.leave_type_id, lr.start_date, lr.end_date, lr.duration_type,
                lr.total_days, lr.reason, lr.team_email, lr.status, lr.reviewed_by, lr.review_comment, lr.reviewed_at, lr.created_at,
                lt.name AS type_name, lt.code AS type_code, lt.color AS type_color,
                u.employee_id AS emp_id, u.first_name, u.last_name, u.photo_url,
                d.name AS dept_name, des.name AS desig_name,
                rv.first_name AS rv_first, rv.last_name AS rv_last
         FROM leave_requests lr
         JOIN leave_types lt ON lr.leave_type_id = lt.id
         JOIN users u ON lr.user_id = u.id
         LEFT JOIN employee_profiles ep ON u.id = ep.user_id
         LEFT JOIN departments d ON ep.department_id = d.id
         LEFT JOIN designations des ON ep.designation_id = des.id
         LEFT JOIN users rv ON lr.reviewed_by = rv.id
         WHERE lr.id = $1`,
        id,
      );
      if (rows.length === 0) throw new NotFoundException('Leave request not found');
      const r = rows[0];
      if (!isAdminOrHr && r.user_id !== userId) {
        const reporteeCheck = await tx.$queryRawUnsafe<Array<{ n: number }>>(
          `SELECT 1 AS n FROM employee_profiles WHERE user_id = $1 AND reports_to = $2`,
          r.user_id,
          userId,
        );
        if (reporteeCheck.length === 0) throw new ForbiddenException('You can only view your own or your reportees\' requests');
      }
      const fyMonth = await this.getFinancialYearStartMonth(schemaName);
      const leaveYear = getLeaveYear(new Date(r.start_date), fyMonth);
      const { endDate: yearEnd } = getLeaveYearRange(leaveYear, fyMonth);
      const holidays = await this.getHolidaysInRange(
        schemaName,
        (r.start_date as Date).toISOString().slice(0, 10),
        (r.end_date as Date).toISOString().slice(0, 10),
      );
      const workSchedule = await this.getDefaultWorkSchedule(schemaName);
      const { breakdown } = calculateLeaveDays(
        new Date(r.start_date),
        new Date(r.end_date),
        r.duration_type as 'full_day' | 'first_half' | 'second_half',
        holidays,
        workSchedule,
      );
      const balRows = await tx.$queryRawUnsafe<Array<{ total_allocated: number; carried_forward: number; used: number }>>(
        `SELECT total_allocated, carried_forward, used FROM leave_balances
         WHERE user_id = $1 AND leave_type_id = $2 AND year = $3`,
        r.user_id,
        r.leave_type_id,
        leaveYear,
      );
      const pendingRows = await tx.$queryRawUnsafe<Array<{ sum: string }>>(
        `SELECT COALESCE(SUM(total_days), 0)::text AS sum FROM leave_requests
         WHERE user_id = $1 AND leave_type_id = $2 AND status = 'pending' AND id != $3`,
        r.user_id,
        r.leave_type_id,
        id,
      );
      const b = balRows[0];
      const allocated = b ? b.total_allocated + b.carried_forward : 0;
      const used = b?.used ?? 0;
      const pending = parseFloat(pendingRows[0]?.sum ?? '0');
      const available = allocated - used;
      const currentBooking = r.status === 'approved' ? r.total_days : 0;
      const balanceAfterBooking = available - (r.status === 'pending' ? r.total_days : 0);
      return {
        id: r.id,
        employee: {
          id: r.user_id,
          employeeId: r.emp_id,
          firstName: r.first_name,
          lastName: r.last_name,
          photoUrl: r.photo_url,
          department: r.dept_name,
          designation: r.desig_name,
        },
        leaveType: { id: r.leave_type_id, name: r.type_name, code: r.type_code, color: r.type_color },
        startDate: r.start_date,
        endDate: r.end_date,
        durationType: r.duration_type,
        totalDays: r.total_days,
        reason: r.reason,
        teamEmail: r.team_email,
        status: r.status,
        reviewer: r.reviewed_by ? { firstName: r.rv_first, lastName: r.rv_last } : null,
        reviewComment: r.review_comment,
        reviewedAt: r.reviewed_at,
        createdAt: r.created_at,
        dateOfRequest: r.created_at,
        breakdown,
        balanceImpact: {
          asOnDate: (r.start_date as Date).toISOString().slice(0, 10),
          availableBalance: available,
          currentBooking,
          balanceAfterBooking,
          asOnYearEnd: yearEnd.toISOString().slice(0, 10),
          estimatedBalance: balanceAfterBooking - pending,
        },
      };
    });
  }

  async review(tenant: TenantInfo, userId: string, id: string, dto: ReviewLeaveDto) {
    const schemaName = tenant.schemaName;
    const fyMonth = await this.getFinancialYearStartMonth(schemaName);
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const reqRows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          user_id: string;
          leave_type_id: string;
          total_days: number;
          status: string;
          start_date: Date;
          end_date: Date;
          type_name: string;
          type_code: string;
          is_paid: boolean;
        }>
      >(
        `SELECT lr.id, lr.user_id, lr.leave_type_id, lr.total_days, lr.status, lr.start_date, lr.end_date,
                lt.name AS type_name, lt.code AS type_code, lt.is_paid
         FROM leave_requests lr JOIN leave_types lt ON lr.leave_type_id = lt.id WHERE lr.id = $1`,
        id,
      );
      if (reqRows.length === 0) throw new NotFoundException('Leave request not found');
      const req = reqRows[0];
      if (req.status !== 'pending') {
        throw new BadRequestException('Can only review pending requests');
      }
      if (req.user_id === userId) {
        throw new BadRequestException('Cannot approve your own leave request');
      }
      const leaveYear = getLeaveYear(new Date(req.start_date), fyMonth);
      if (dto.action === 'approve') {
        if (req.type_code !== 'LWP' && req.is_paid) {
          const balRows = await tx.$queryRawUnsafe<Array<{ total_allocated: number; carried_forward: number; used: number }>>(
            `SELECT total_allocated, carried_forward, used FROM leave_balances
             WHERE user_id = $1 AND leave_type_id = $2 AND year = $3`,
            req.user_id,
            req.leave_type_id,
            leaveYear,
          );
          let available = 0;
          if (balRows.length > 0) {
            available = balRows[0].total_allocated + balRows[0].carried_forward - balRows[0].used;
          }
          if (req.total_days > available) {
            throw new BadRequestException(
              `Insufficient balance to approve. Employee has ${available} days available but this request requires ${req.total_days} days.`,
            );
          }
        }
        const overlap = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM leave_requests
           WHERE user_id = $1 AND status = 'approved'
             AND start_date <= $2::date AND end_date >= $3::date AND id != $4`,
          req.user_id,
          (req.end_date as Date).toISOString().slice(0, 10),
          (req.start_date as Date).toISOString().slice(0, 10),
          id,
        );
        if (overlap.length > 0) {
          throw new BadRequestException('Another approved leave overlaps with this period');
        }
        await tx.$executeRawUnsafe(
          `UPDATE leave_requests SET status = 'approved', reviewed_by = $1, review_comment = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $3`,
          userId,
          dto.comment ?? null,
          id,
        );
        const balExists = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM leave_balances WHERE user_id = $1 AND leave_type_id = $2 AND year = $3`,
          req.user_id,
          req.leave_type_id,
          leaveYear,
        );
        if (balExists.length > 0) {
          await tx.$executeRawUnsafe(
            `UPDATE leave_balances SET used = used + $1 WHERE user_id = $2 AND leave_type_id = $3 AND year = $4`,
            req.total_days,
            req.user_id,
            req.leave_type_id,
            leaveYear,
          );
        } else {
          await tx.$executeRawUnsafe(
            `INSERT INTO leave_balances (id, user_id, leave_type_id, year, total_allocated, carried_forward, used)
             VALUES (gen_random_uuid(), $1, $2, $3, 0, 0, $4)
             ON CONFLICT (user_id, leave_type_id, year) DO UPDATE SET used = leave_balances.used + $4`,
            req.user_id,
            req.leave_type_id,
            leaveYear,
            req.total_days,
          );
        }
        const reviewerRows = await tx.$queryRawUnsafe<Array<{ first_name: string; last_name: string }>>(
          `SELECT first_name, last_name FROM users WHERE id = $1`,
          userId,
        );
        const reviewerName = reviewerRows[0] ? `${reviewerRows[0].first_name} ${reviewerRows[0].last_name}` : '';
        this.notificationService.create(
          req.user_id,
          'leave_request_approved',
          'Leave request approved',
          `Your ${req.type_name} request for ${(req.start_date as Date).toISOString().slice(0, 10)} to ${(req.end_date as Date).toISOString().slice(0, 10)} (${req.total_days} day(s)) has been approved`,
          schemaName,
          { requestId: id, leaveTypeId: req.leave_type_id, startDate: req.start_date, endDate: req.end_date, totalDays: req.total_days, reviewerName },
        ).catch(() => {});
      } else {
        await tx.$executeRawUnsafe(
          `UPDATE leave_requests SET status = 'rejected', reviewed_by = $1, review_comment = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $3`,
          userId,
          dto.comment ?? null,
          id,
        );
        const commentSuffix = dto.comment ? `. Reason: ${dto.comment}` : '';
        this.notificationService.create(
          req.user_id,
          'leave_request_rejected',
          'Leave request rejected',
          `Your ${req.type_name} request for ${(req.start_date as Date).toISOString().slice(0, 10)} to ${(req.end_date as Date).toISOString().slice(0, 10)} has been rejected${commentSuffix}`,
          schemaName,
          { requestId: id },
        ).catch(() => {});
      }
      await this.insertAuditLog(schemaName, userId, 'update', 'leave', 'leave_requests', id, { status: 'pending' }, { action: dto.action, status: dto.action === 'approve' ? 'approved' : 'rejected' });
      return this.findOne(tenant, userId, ['Admin', 'HR Admin', 'HR Manager'], id);
    });
  }

  async cancel(tenant: TenantInfo, userId: string, roles: string[], id: string) {
    const schemaName = tenant.schemaName;
    const isAdmin = roles.includes('Admin') || roles.includes('HR Admin') || roles.includes('HR Manager');
    const fyMonth = await this.getFinancialYearStartMonth(schemaName);
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const reqRows = await tx.$queryRawUnsafe<
        Array<{ id: string; user_id: string; leave_type_id: string; total_days: number; status: string; start_date: Date; end_date: Date; type_name: string }>
      >(
        `SELECT lr.id, lr.user_id, lr.leave_type_id, lr.total_days, lr.status, lr.start_date, lr.end_date, lt.name AS type_name
         FROM leave_requests lr JOIN leave_types lt ON lr.leave_type_id = lt.id WHERE lr.id = $1`,
        id,
      );
      if (reqRows.length === 0) throw new NotFoundException('Leave request not found');
      const req = reqRows[0];
      const isOwner = req.user_id === userId;
      if (!isOwner && !isAdmin) {
        throw new ForbiddenException('You can only cancel your own leave requests');
      }
      if (req.status === 'rejected' || req.status === 'cancelled') {
        throw new BadRequestException(`Cannot cancel a ${req.status} request`);
      }
      if (req.status === 'approved' && isOwner && !isAdmin) {
        throw new BadRequestException('Approved leave can only be cancelled by HR or an administrator');
      }
      if (req.status === 'approved') {
        const leaveYear = getLeaveYear(new Date(req.start_date), fyMonth);
        const balRows = await tx.$queryRawUnsafe<Array<{ used: number }>>(
          `SELECT used FROM leave_balances WHERE user_id = $1 AND leave_type_id = $2 AND year = $3`,
          req.user_id,
          req.leave_type_id,
          leaveYear,
        );
        if (balRows.length > 0) {
          const newUsed = Math.max(0, balRows[0].used - req.total_days);
          await tx.$executeRawUnsafe(
            `UPDATE leave_balances SET used = $1 WHERE user_id = $2 AND leave_type_id = $3 AND year = $4`,
            newUsed,
            req.user_id,
            req.leave_type_id,
            leaveYear,
          );
        }
      }
      await tx.$executeRawUnsafe(
        `UPDATE leave_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        id,
      );
      const empRows = await tx.$queryRawUnsafe<Array<{ first_name: string; last_name: string }>>(
        `SELECT first_name, last_name FROM users WHERE id = $1`,
        req.user_id,
      );
      const empName = empRows[0] ? `${empRows[0].first_name} ${empRows[0].last_name}` : 'Employee';
      const approverIds = await this.getUsersWithApprovePermission(schemaName);
      const msg = `${empName} has cancelled their ${req.type_name} request for ${(req.start_date as Date).toISOString().slice(0, 10)} to ${(req.end_date as Date).toISOString().slice(0, 10)}`;
      for (const aid of approverIds) {
        this.notificationService.create(aid, 'leave_request_cancelled', 'Leave request cancelled', msg, schemaName, { requestId: id }).catch(() => {});
      }
      await this.insertAuditLog(schemaName, userId, 'update', 'leave', 'leave_requests', id, { status: req.status }, { status: 'cancelled' });
      return this.findOne(tenant, userId, roles, id);
    });
  }

  async export(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    query: ListLeaveRequestsQueryDto,
    format: 'csv' | 'xlsx' | 'pdf',
  ) {
    const { data } = await this.list(tenant, userId, roles, { ...query, page: 1, limit: 10000 });
    const exportData: Record<string, unknown>[] = data.map((row: Record<string, unknown>) => {
      const emp = row.employee as { employeeId?: string; firstName?: string; lastName?: string; department?: string } | undefined;
      const lt = row.leaveType as { name?: string } | undefined;
      const rv = row.reviewer as { firstName?: string; lastName?: string } | undefined;
      return {
        employeeId: emp?.employeeId ?? '',
        employeeName: emp ? `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim() : '',
        department: emp?.department ?? '',
        leaveTypeName: lt?.name ?? '',
        startDate: row.startDate,
        endDate: row.endDate,
        durationType: row.durationType,
        totalDays: row.totalDays,
        status: row.status,
        reason: row.reason ?? '',
        reviewerName: rv ? `${rv.firstName ?? ''} ${rv.lastName ?? ''}`.trim() : '',
        reviewComment: row.reviewComment ?? '',
        reviewedAt: row.reviewedAt,
        createdAt: row.createdAt,
      };
    });
    const columns: ColumnDef[] = [
      { key: 'employeeId', header: 'Employee ID' },
      { key: 'employeeName', header: 'Employee Name' },
      { key: 'department', header: 'Department' },
      { key: 'leaveTypeName', header: 'Leave Type' },
      { key: 'startDate', header: 'Start Date', format: (v: unknown) => v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '') },
      { key: 'endDate', header: 'End Date', format: (v: unknown) => v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '') },
      { key: 'durationType', header: 'Duration Type', format: (v: unknown) => String(v ?? '') },
      { key: 'totalDays', header: 'Total Days' },
      { key: 'status', header: 'Status' },
      { key: 'reason', header: 'Reason' },
      { key: 'reviewerName', header: 'Reviewer' },
      { key: 'reviewComment', header: 'Review Comment' },
      { key: 'reviewedAt', header: 'Reviewed At', format: (v: unknown) => v ? new Date(v as string).toISOString() : '' },
      { key: 'createdAt', header: 'Applied On', format: (v: unknown) => v ? new Date(v as string).toISOString() : '' },
    ];
    if (format === 'csv') return this.exportService.toCsv(exportData, columns);
    if (format === 'xlsx') return this.exportService.toXlsx(exportData, columns, { sheetName: 'Leave Requests' });
    return this.exportService.toPdf(exportData, columns, { title: 'Leave Requests' });
  }
}
