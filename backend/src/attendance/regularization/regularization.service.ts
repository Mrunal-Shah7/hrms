import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../../core/notification/notification.service';
import type { TenantInfo } from '../../tenant/tenant.interface';
import { SummaryService } from '../../time-tracker/summary/summary.service';
import type { CreateRegularizationDto } from './dto/create-regularization.dto';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class RegularizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    @Inject(forwardRef(() => SummaryService))
    private readonly summaryService: SummaryService,
  ) {}

  async request(
    tenant: TenantInfo,
    userId: string,
    dto: CreateRegularizationDto,
  ): Promise<{ id: string; status: string }> {
    if (!dto.punchIn && !dto.punchOut) {
      throw new BadRequestException('At least one punch time (in or out) is required');
    }
    if (dto.punchIn && dto.punchOut && dto.punchOut <= dto.punchIn) {
      throw new BadRequestException('Punch out must be after punch in');
    }
    const dateStr = dto.date.slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (dateStr > today) {
      throw new BadRequestException('Cannot regularize for a future date');
    }
    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS).toISOString().slice(0, 10);
    if (dateStr < cutoff) {
      throw new BadRequestException('Regularization can only be requested for the last 30 days');
    }

    const schemaName = tenant.schemaName;
    const existing = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM attendance_regularizations WHERE user_id = $1::uuid AND date = $2::date AND status = 'pending'`,
        userId,
        dateStr,
      );
    });
    if (existing.length > 0) {
      throw new ConflictException('A pending regularization already exists for this date');
    }

    const id = crypto.randomUUID();
    await this.prisma.withTenantSchema(schemaName, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO attendance_regularizations (id, user_id, date, punch_in, punch_out, reason, status, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::date, $4, $5, $6, 'pending', NOW(), NOW())`,
        id,
        userId,
        dateStr,
        dto.punchIn ?? null,
        dto.punchOut ?? null,
        dto.reason,
      );
      await this.insertAuditLog(schemaName, userId, 'create', 'attendance', 'regularizations', id, null, dto as object);
    });

    const approverIds = await this.getUsersWithApprovePermission(schemaName);
    const employeeName = await this.getEmployeeName(schemaName, userId);
    const title = 'Attendance regularization requested';
    const message = `${employeeName} has requested an attendance regularization for ${dateStr}`;
    const data = { regularizationId: id, userId, date: dateStr };
    for (const approverId of approverIds) {
      await this.notificationService.create(
        approverId,
        'regularization_requested',
        title,
        message,
        schemaName,
        data,
      );
    }

    return { id, status: 'pending' };
  }

  async list(
    tenant: TenantInfo,
    userId: string,
    canApprove: boolean,
    query: { page?: number; limit?: number; status?: string; userId?: string; sortBy?: string; sortOrder?: string },
  ) {
    const schemaName = tenant.schemaName;
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 10));
    const offset = (page - 1) * limit;
    const status = query.status;
    const filterUserId = query.userId;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';
    const orderCol = sortBy === 'createdAt' ? 'ar.created_at' : 'ar.date';
    const orderDir = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    if (!canApprove) {
      conditions.push(`ar.user_id = $${p++}::uuid`);
      params.push(userId);
    }
    if (status) {
      conditions.push(`ar.status = $${p++}`);
      params.push(status);
    }
    if (filterUserId && canApprove) {
      conditions.push(`ar.user_id = $${p++}::uuid`);
      params.push(filterUserId);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows, rows] = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const countResult = await tx.$queryRawUnsafe<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS count FROM attendance_regularizations ar ${whereClause}`,
        ...params,
      );
      const listResult = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          user_id: string;
          date: string;
          punch_in: string | null;
          punch_out: string | null;
          reason: string;
          status: string;
          reviewed_by: string | null;
          reviewed_at: Date | null;
          created_at: Date;
          employee_id: string | null;
          first_name: string;
          last_name: string;
          photo_url: string | null;
          department_name: string | null;
          reviewer_first_name: string | null;
          reviewer_last_name: string | null;
        }>
      >(
        `SELECT ar.id, ar.user_id, ar.date::text, ar.punch_in, ar.punch_out, ar.reason, ar.status, ar.reviewed_by, ar.reviewed_at, ar.created_at,
                u.employee_id, u.first_name, u.last_name, u.photo_url, d.name AS department_name,
                rev.first_name AS reviewer_first_name, rev.last_name AS reviewer_last_name
         FROM attendance_regularizations ar
         JOIN users u ON ar.user_id = u.id
         LEFT JOIN employee_profiles ep ON u.id = ep.user_id
         LEFT JOIN departments d ON ep.department_id = d.id
         LEFT JOIN users rev ON ar.reviewed_by = rev.id
         ${whereClause}
         ORDER BY ${orderCol} ${orderDir}
         LIMIT $${p++} OFFSET $${p}`,
        ...params,
        limit,
        offset,
      );
      return [countResult, listResult];
    });

    const total = Number(countRows[0]?.count ?? 0);
    const data = rows.map((r) => ({
      id: r.id,
      employee: {
        id: r.user_id,
        employeeId: r.employee_id,
        firstName: r.first_name,
        lastName: r.last_name,
        photoUrl: r.photo_url,
        department: r.department_name,
      },
      date: r.date,
      punchIn: r.punch_in,
      punchOut: r.punch_out,
      reason: r.reason,
      status: r.status,
      reviewer: r.reviewer_first_name
        ? { firstName: r.reviewer_first_name, lastName: r.reviewer_last_name }
        : null,
      reviewedAt: r.reviewed_at ? r.reviewed_at.toISOString() : null,
      createdAt: r.created_at.toISOString(),
    }));

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async getById(tenant: TenantInfo, id: string, userId: string, canApprove: boolean) {
    const schemaName = tenant.schemaName;
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{
          id: string;
          user_id: string;
          date: string;
          punch_in: string | null;
          punch_out: string | null;
          reason: string;
          status: string;
          reviewed_by: string | null;
          reviewed_at: Date | null;
          created_at: Date;
          employee_id: string | null;
          first_name: string;
          last_name: string;
          photo_url: string | null;
          department_name: string | null;
          reviewer_first_name: string | null;
          reviewer_last_name: string | null;
        }>
      >(
        `SELECT ar.id, ar.user_id, ar.date::text, ar.punch_in, ar.punch_out, ar.reason, ar.status, ar.reviewed_by, ar.reviewed_at, ar.created_at,
                u.employee_id, u.first_name, u.last_name, u.photo_url, d.name AS department_name,
                rev.first_name AS reviewer_first_name, rev.last_name AS reviewer_last_name
         FROM attendance_regularizations ar
         JOIN users u ON ar.user_id = u.id
         LEFT JOIN employee_profiles ep ON u.id = ep.user_id
         LEFT JOIN departments d ON ep.department_id = d.id
         LEFT JOIN users rev ON ar.reviewed_by = rev.id
         WHERE ar.id = $1::uuid`,
        id,
      );
    });
    if (rows.length === 0) throw new NotFoundException('Regularization not found');
    const r = rows[0];
    if (!canApprove && r.user_id !== userId) throw new NotFoundException('Regularization not found');

    const existingAttendance = await this.getExistingAttendance(schemaName, r.user_id, r.date);
    return {
      id: r.id,
      employee: {
        id: r.user_id,
        employeeId: r.employee_id,
        firstName: r.first_name,
        lastName: r.last_name,
        photoUrl: r.photo_url,
        department: r.department_name,
      },
      date: r.date,
      punchIn: r.punch_in,
      punchOut: r.punch_out,
      reason: r.reason,
      status: r.status,
      reviewer: r.reviewer_first_name
        ? { firstName: r.reviewer_first_name, lastName: r.reviewer_last_name }
        : null,
      reviewedAt: r.reviewed_at ? r.reviewed_at.toISOString() : null,
      createdAt: r.created_at.toISOString(),
      existingAttendance: {
        firstPunchIn: existingAttendance.firstPunchIn,
        lastPunchOut: existingAttendance.lastPunchOut,
        totalHours: existingAttendance.totalHours,
        status: existingAttendance.status,
      },
    };
  }

  async review(
    tenant: TenantInfo,
    reviewerId: string,
    id: string,
    action: 'approve' | 'reject',
  ): Promise<{ status: string }> {
    const schemaName = tenant.schemaName;
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{ id: string; user_id: string; date: string; status: string; punch_in: string | null; punch_out: string | null }>
      >(
        `SELECT id, user_id, date::text, status, punch_in, punch_out FROM attendance_regularizations WHERE id = $1::uuid`,
        id,
      );
    });
    if (rows.length === 0) throw new NotFoundException('Regularization not found');
    const r = rows[0];
    if (r.status !== 'pending') {
      throw new BadRequestException('Can only review pending regularizations');
    }

    if (action === 'approve') {
      await this.prisma.withTenantSchema(schemaName, async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE attendance_regularizations SET status = 'approved', reviewed_by = $1::uuid, reviewed_at = NOW(), updated_at = NOW() WHERE id = $2::uuid`,
          reviewerId,
          id,
        );
        const dateStr = r.date;
        if (r.punch_in) {
          const punchTime = `${dateStr}T${r.punch_in}:00`;
          await tx.$executeRawUnsafe(
            `INSERT INTO time_logs (id, user_id, punch_type, punch_time, source, created_at)
             VALUES (gen_random_uuid(), $1::uuid, 'in', $2::timestamp, 'regularization', NOW())`,
            r.user_id,
            punchTime,
          );
        }
        if (r.punch_out) {
          const punchTime = `${dateStr}T${r.punch_out}:00`;
          await tx.$executeRawUnsafe(
            `INSERT INTO time_logs (id, user_id, punch_type, punch_time, source, created_at)
             VALUES (gen_random_uuid(), $1::uuid, 'out', $2::timestamp, 'regularization', NOW())`,
            r.user_id,
            punchTime,
          );
        }
        await this.summaryService.computeDailySummary(tx, r.user_id, new Date(dateStr), schemaName);
      });
      await this.insertAuditLog(schemaName, reviewerId, 'update', 'attendance', 'regularizations', id, { status: 'pending' }, { status: 'approved' });
      const title = 'Regularization approved';
      const message = `Your attendance regularization for ${r.date} has been approved`;
      await this.notificationService.create(
        r.user_id,
        'regularization_approved_rejected',
        title,
        message,
        schemaName,
        { regularizationId: id, date: r.date, action: 'approved' },
      );
      return { status: 'approved' };
    } else {
      await this.prisma.withTenantSchema(schemaName, async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE attendance_regularizations SET status = 'rejected', reviewed_by = $1::uuid, reviewed_at = NOW(), updated_at = NOW() WHERE id = $2::uuid`,
          reviewerId,
          id,
        );
      });
      await this.insertAuditLog(schemaName, reviewerId, 'update', 'attendance', 'regularizations', id, { status: 'pending' }, { status: 'rejected' });
      const title = 'Regularization rejected';
      const message = `Your attendance regularization for ${r.date} has been rejected`;
      await this.notificationService.create(
        r.user_id,
        'regularization_approved_rejected',
        title,
        message,
        schemaName,
        { regularizationId: id, date: r.date, action: 'rejected' },
      );
      return { status: 'rejected' };
    }
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

  private async getExistingAttendance(
    schemaName: string,
    userId: string,
    dateStr: string,
  ): Promise<{ firstPunchIn: string | null; lastPunchOut: string | null; totalHours: number; status: string }> {
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{
          first_punch_in: Date | null;
          last_punch_out: Date | null;
          total_hours: number;
          status: string;
        }>
      >(
        `SELECT first_punch_in, last_punch_out, total_hours, status FROM daily_time_summary WHERE user_id = $1::uuid AND date = $2::date`,
        userId,
        dateStr,
      );
    });
    if (rows.length === 0) {
      return { firstPunchIn: null, lastPunchOut: null, totalHours: 0, status: 'absent' };
    }
    const r = rows[0];
    return {
      firstPunchIn: r.first_punch_in ? new Date(r.first_punch_in).toISOString() : null,
      lastPunchOut: r.last_punch_out ? new Date(r.last_punch_out).toISOString() : null,
      totalHours: r.total_hours,
      status: r.status,
    };
  }

  private async insertAuditLog(
    schemaName: string,
    userId: string,
    action: string,
    module: string,
    entityType: string,
    entityId: string,
    oldValue: object | null,
    newValue: object | null,
  ): Promise<void> {
    await this.prisma.withTenantSchema(schemaName, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO audit_logs (id, user_id, action, module, entity_type, entity_id, old_value, new_value, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, NOW())`,
        userId,
        action,
        module,
        entityType,
        entityId,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
      );
    });
  }
}
