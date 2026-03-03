import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExportService } from '../core/export/export.service';
import { NotificationService } from '../core/notification/notification.service';
import { TenantInfo } from '../tenant/tenant.interface';
import type { CreateDelegationDto } from './dto/create-delegation.dto';
import type { UpdateDelegationDto } from './dto/update-delegation.dto';
import type { ListDelegationsQueryDto } from './dto/list-delegations-query.dto';

type DelegationScope = 'ALL' | 'DELEGATOR_OR_DELEGATEE' | 'DELEGATEE_ONLY';

function getDelegationScope(roles: string[]): DelegationScope {
  if (roles.includes('Admin') || roles.includes('HR Admin') || roles.includes('HR Manager')) {
    return 'ALL';
  }
  if (roles.includes('Manager / Team Lead')) {
    return 'DELEGATOR_OR_DELEGATEE';
  }
  return 'DELEGATEE_ONLY';
}

function isAdminOrHr(roles: string[]): boolean {
  return roles.includes('Admin') || roles.includes('HR Admin') || roles.includes('HR Manager');
}

@Injectable()
export class DelegationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exportService: ExportService,
    private readonly notificationService: NotificationService,
  ) {}

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

  async list(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    query: ListDelegationsQueryDto,
  ) {
    const scope = getDelegationScope(roles);
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const offset = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const sortColMap: Record<string, string> = {
      createdAt: 'del.created_at',
      updatedAt: 'del.updated_at',
      startDate: 'del.start_date',
      endDate: 'del.end_date',
    };
    const orderCol = sortColMap[sortBy] ?? 'del.created_at';

    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (scope === 'DELEGATOR_OR_DELEGATEE') {
      conditions.push(`(del.delegator_id = $${p}::uuid OR del.delegatee_id = $${p}::uuid)`);
      params.push(userId);
      p++;
    } else if (scope === 'DELEGATEE_ONLY') {
      conditions.push(`del.delegatee_id = $${p}::uuid`);
      params.push(userId);
      p++;
    }

    if (query.status) {
      conditions.push(`del.status = $${p++}`);
      params.push(query.status);
    }
    if (query.type) {
      conditions.push(`del.type = $${p++}`);
      params.push(query.type);
    }

    const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const countResult = (await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::text as count FROM delegations del WHERE ${whereClause}`,
        ...params,
      )) as Array<{ count: string }>;
      const total = parseInt(countResult[0]?.count ?? '0', 10);

      const rows = (await tx.$queryRawUnsafe(
        `SELECT del.id, del.type, del.description, del.start_date, del.end_date, del.status,
                del.created_at, del.updated_at,
                dlor.id AS delegator_id, dlor.employee_id AS delegator_emp_id,
                dlor.first_name AS delegator_first_name, dlor.last_name AS delegator_last_name,
                dlor.photo_url AS delegator_photo_url,
                dlee.id AS delegatee_id, dlee.employee_id AS delegatee_emp_id,
                dlee.first_name AS delegatee_first_name, dlee.last_name AS delegatee_last_name,
                dlee.photo_url AS delegatee_photo_url
         FROM delegations del
         JOIN users dlor ON del.delegator_id = dlor.id
         JOIN users dlee ON del.delegatee_id = dlee.id
         WHERE ${whereClause}
         ORDER BY ${orderCol} ${sortOrder}
         LIMIT $${p} OFFSET $${p + 1}`,
        ...params,
        limit,
        offset,
      )) as Array<{
        id: string;
        type: string;
        description: string | null;
        start_date: Date;
        end_date: Date | null;
        status: string;
        created_at: Date;
        updated_at: Date;
        delegator_id: string;
        delegator_emp_id: string | null;
        delegator_first_name: string;
        delegator_last_name: string;
        delegator_photo_url: string | null;
        delegatee_id: string;
        delegatee_emp_id: string | null;
        delegatee_first_name: string;
        delegatee_last_name: string;
        delegatee_photo_url: string | null;
      }>;

      const data = rows.map((r) => ({
        id: r.id,
        type: r.type,
        description: r.description,
        startDate: r.start_date,
        endDate: r.end_date,
        status: r.status,
        delegator: {
          id: r.delegator_id,
          employeeId: r.delegator_emp_id,
          firstName: r.delegator_first_name,
          lastName: r.delegator_last_name,
          photoUrl: r.delegator_photo_url,
        },
        delegatee: {
          id: r.delegatee_id,
          employeeId: r.delegatee_emp_id,
          firstName: r.delegatee_first_name,
          lastName: r.delegatee_last_name,
          photoUrl: r.delegatee_photo_url,
        },
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));

      return {
        data,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  async create(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    dto: CreateDelegationDto,
  ) {
    let delegatorId = dto.delegatorId ?? userId;

    if (dto.delegatorId && dto.delegatorId !== userId) {
      if (!isAdminOrHr(roles)) {
        throw new ForbiddenException('You can only create delegations for yourself');
      }
    }

    if (delegatorId === dto.delegateeId) {
      throw new BadRequestException('Cannot delegate to yourself');
    }

    const [delegatorExists, delegateeExists] = await this.prisma.withTenantSchema(
      tenant.schemaName,
      async (tx) => {
        const d1 = (await tx.$queryRawUnsafe(
          `SELECT id FROM users WHERE id = $1::uuid AND status = 'active'`,
          delegatorId,
        )) as Array<{ id: string }>;
        const d2 = (await tx.$queryRawUnsafe(
          `SELECT id FROM users WHERE id = $1::uuid AND status = 'active'`,
          dto.delegateeId,
        )) as Array<{ id: string }>;
        return [d1.length > 0, d2.length > 0];
      },
    );

    if (!delegatorExists) {
      throw new BadRequestException('Delegator not found or inactive');
    }
    if (!delegateeExists) {
      throw new BadRequestException('Delegatee not found or inactive');
    }

    if (!isAdminOrHr(roles)) {
      const reporteeCheck = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
        return tx.$queryRawUnsafe(
          `SELECT id FROM employee_profiles WHERE user_id = $1::uuid AND reports_to = $2::uuid`,
          dto.delegateeId,
          delegatorId,
        );
      })) as Array<{ id: string }>;
      if (reporteeCheck.length === 0) {
        throw new BadRequestException('Delegatee must be a direct reportee of the delegator');
      }
    }

    if (dto.startDate && dto.endDate && new Date(dto.endDate) < new Date(dto.startDate)) {
      throw new BadRequestException('End date must be after start date');
    }

    let endDate = dto.endDate ?? null;
    if (dto.type === 'permanent' && dto.endDate) {
      endDate = null;
    }

    const overlapping = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe(
        `SELECT id FROM delegations
         WHERE delegator_id = $1::uuid AND delegatee_id = $2::uuid AND status = 'active'
           AND (start_date <= COALESCE($3::date, '9999-12-31'::date)
                AND COALESCE(end_date, '9999-12-31'::date) >= $4::date)`,
        delegatorId,
        dto.delegateeId,
        endDate ?? '9999-12-31',
        dto.startDate,
      );
    })) as Array<{ id: string }>;

    if (overlapping.length > 0) {
      throw new ConflictException(
        'An active delegation already exists between these users for the specified period',
      );
    }

    const id = crypto.randomUUID();

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO delegations (id, delegator_id, delegatee_id, type, description, start_date, end_date, status, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::date, $7::date, 'active', NOW(), NOW())`,
        id,
        delegatorId,
        dto.delegateeId,
        dto.type,
        dto.description ?? null,
        dto.startDate,
        endDate,
      );
    });

    const delegatorRows = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe(
        `SELECT first_name, last_name FROM users WHERE id = $1::uuid`,
        delegatorId,
      );
    })) as Array<{ first_name: string; last_name: string }>;
    const delegatorName =
      delegatorRows[0]?.first_name && delegatorRows[0]?.last_name
        ? `${delegatorRows[0].first_name} ${delegatorRows[0].last_name}`
        : 'Your manager';

    await this.notificationService.create(
      dto.delegateeId,
      'delegation_created',
      'New delegation assigned',
      `A ${dto.type} delegation has been assigned to you by ${delegatorName}, starting ${dto.startDate}`,
      tenant.schemaName,
      {
        delegationId: id,
        delegatorId,
        type: dto.type,
        startDate: dto.startDate,
        endDate: endDate,
      },
    );

    await this.insertAuditLog(
      tenant.schemaName,
      userId,
      'create',
      'employee_management',
      'delegations',
      id,
      null,
      { delegatorId, delegateeId: dto.delegateeId, type: dto.type, startDate: dto.startDate, endDate } as object,
    );

    return this.findOne(tenant, userId, roles, id);
  }

  async findOne(tenant: TenantInfo, userId: string, roles: string[], id: string) {
    const scope = getDelegationScope(roles);
    const conditions: string[] = ['del.id = $1::uuid'];
    const params: unknown[] = [id];
    let p = 2;

    if (scope === 'DELEGATOR_OR_DELEGATEE') {
      conditions.push(`(del.delegator_id = $${p}::uuid OR del.delegatee_id = $${p}::uuid)`);
      params.push(userId);
      p++;
    } else if (scope === 'DELEGATEE_ONLY') {
      conditions.push(`del.delegatee_id = $${p}::uuid`);
      params.push(userId);
      p++;
    }

    const whereClause = conditions.join(' AND ');

    const rows = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe(
        `SELECT del.id, del.type, del.description, del.start_date, del.end_date, del.status,
                del.created_at, del.updated_at,
                dlor.id AS delegator_id, dlor.employee_id AS delegator_emp_id,
                dlor.first_name AS delegator_first_name, dlor.last_name AS delegator_last_name,
                dlor.email AS delegator_email, dlor.photo_url AS delegator_photo_url,
                d.name AS delegator_dept_name, des.name AS delegator_desig_name,
                dlee.id AS delegatee_id, dlee.employee_id AS delegatee_emp_id,
                dlee.first_name AS delegatee_first_name, dlee.last_name AS delegatee_last_name,
                dlee.email AS delegatee_email, dlee.photo_url AS delegatee_photo_url,
                d2.name AS delegatee_dept_name, des2.name AS delegatee_desig_name
         FROM delegations del
         JOIN users dlor ON del.delegator_id = dlor.id
         JOIN users dlee ON del.delegatee_id = dlee.id
         LEFT JOIN employee_profiles ep1 ON dlor.id = ep1.user_id
         LEFT JOIN departments d ON ep1.department_id = d.id
         LEFT JOIN designations des ON ep1.designation_id = des.id
         LEFT JOIN employee_profiles ep2 ON dlee.id = ep2.user_id
         LEFT JOIN departments d2 ON ep2.department_id = d2.id
         LEFT JOIN designations des2 ON ep2.designation_id = des2.id
         WHERE ${whereClause}`,
        ...params,
      );
    })) as Array<{
      id: string;
      type: string;
      description: string | null;
      start_date: Date;
      end_date: Date | null;
      status: string;
      created_at: Date;
      updated_at: Date;
      delegator_id: string;
      delegator_emp_id: string | null;
      delegator_first_name: string;
      delegator_last_name: string;
      delegator_email: string;
      delegator_photo_url: string | null;
      delegator_dept_name: string | null;
      delegator_desig_name: string | null;
      delegatee_id: string;
      delegatee_emp_id: string | null;
      delegatee_first_name: string;
      delegatee_last_name: string;
      delegatee_email: string;
      delegatee_photo_url: string | null;
      delegatee_dept_name: string | null;
      delegatee_desig_name: string | null;
    }>;

    if (!rows || rows.length === 0) {
      throw new NotFoundException('Delegation not found');
    }

    const r = rows[0];
    return {
      id: r.id,
      type: r.type,
      description: r.description,
      startDate: r.start_date,
      endDate: r.end_date,
      status: r.status,
      delegator: {
        id: r.delegator_id,
        employeeId: r.delegator_emp_id,
        firstName: r.delegator_first_name,
        lastName: r.delegator_last_name,
        email: r.delegator_email,
        photoUrl: r.delegator_photo_url,
        department: r.delegator_dept_name ? { name: r.delegator_dept_name } : null,
        designation: r.delegator_desig_name ? { name: r.delegator_desig_name } : null,
      },
      delegatee: {
        id: r.delegatee_id,
        employeeId: r.delegatee_emp_id,
        firstName: r.delegatee_first_name,
        lastName: r.delegatee_last_name,
        email: r.delegatee_email,
        photoUrl: r.delegatee_photo_url,
        department: r.delegatee_dept_name ? { name: r.delegatee_dept_name } : null,
        designation: r.delegatee_desig_name ? { name: r.delegatee_desig_name } : null,
      },
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async update(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    id: string,
    dto: UpdateDelegationDto,
  ) {
    const existing = (await this.findOne(tenant, userId, roles, id)) as {
      delegator: { id: string };
      status: string;
      [k: string]: unknown;
    };

    if (!isAdminOrHr(roles) && existing.delegator.id !== userId) {
      throw new ForbiddenException('Only the delegator or an admin can edit this delegation');
    }

    const validStatusTransitions: Record<string, string[]> = {
      active: ['completed', 'cancelled'],
      completed: [],
      cancelled: [],
    };
    if (dto.status !== undefined && dto.status !== existing.status) {
      const allowed = validStatusTransitions[existing.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Cannot transition status from ${existing.status} to ${dto.status}`,
        );
      }
    }

    if (dto.startDate && dto.endDate && new Date(dto.endDate) < new Date(dto.startDate)) {
      throw new BadRequestException('End date must be after start date');
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    if (dto.type !== undefined) {
      updates.push(`type = $${p++}`);
      params.push(dto.type);
    }
    if (dto.description !== undefined) {
      updates.push(`description = $${p++}`);
      params.push(dto.description ?? null);
    }
    if (dto.startDate !== undefined) {
      updates.push(`start_date = $${p++}`);
      params.push(dto.startDate);
    }
    if (dto.endDate !== undefined) {
      updates.push(`end_date = $${p++}`);
      params.push(dto.endDate ?? null);
    }
    if (dto.status !== undefined) {
      updates.push(`status = $${p++}`);
      params.push(dto.status);
    }

    if (updates.length > 0) {
      updates.push(`updated_at = NOW()`);
      params.push(id);
      await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE delegations SET ${updates.join(', ')} WHERE id = $${p}::uuid`,
          ...params,
        );
      });
      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'update',
        'employee_management',
        'delegations',
        id,
        existing as object,
        { ...existing, ...dto } as object,
      );
    }

    return this.findOne(tenant, userId, roles, id);
  }

  async delete(tenant: TenantInfo, userId: string, roles: string[], id: string) {
    if (!roles.includes('Admin')) {
      throw new ForbiddenException('Only administrators can delete delegations');
    }

    const existing = await this.findOne(tenant, userId, roles, id);

    await this.insertAuditLog(
      tenant.schemaName,
      userId,
      'delete',
      'employee_management',
      'delegations',
      id,
      existing as object,
      null,
    );
    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM delegations WHERE id = $1::uuid`, id);
    });

    return { message: 'Delegation deleted' };
  }

  async export(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    query: ListDelegationsQueryDto,
    format: 'csv' | 'xlsx' | 'pdf',
  ): Promise<Buffer> {
    const scope = getDelegationScope(roles);
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';
    const sortColMap: Record<string, string> = {
      createdAt: 'del.created_at',
      updatedAt: 'del.updated_at',
      startDate: 'del.start_date',
      endDate: 'del.end_date',
    };
    const orderCol = sortColMap[sortBy] ?? 'del.created_at';

    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    if (scope === 'DELEGATOR_OR_DELEGATEE') {
      conditions.push(`(del.delegator_id = $${p}::uuid OR del.delegatee_id = $${p}::uuid)`);
      params.push(userId);
      p++;
    } else if (scope === 'DELEGATEE_ONLY') {
      conditions.push(`del.delegatee_id = $${p}::uuid`);
      params.push(userId);
      p++;
    }
    if (query.status) {
      conditions.push(`del.status = $${p++}`);
      params.push(query.status);
    }
    if (query.type) {
      conditions.push(`del.type = $${p++}`);
      params.push(query.type);
    }
    const whereClause = conditions.length > 0 ? conditions.join(' AND ') : '1=1';

    const rows = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe(
        `SELECT dlor.first_name AS delegator_first_name, dlor.last_name AS delegator_last_name,
                dlor.employee_id AS delegator_emp_id,
                dlee.first_name AS delegatee_first_name, dlee.last_name AS delegatee_last_name,
                dlee.employee_id AS delegatee_emp_id,
                del.type, del.description, del.start_date, del.end_date, del.status, del.created_at
         FROM delegations del
         JOIN users dlor ON del.delegator_id = dlor.id
         JOIN users dlee ON del.delegatee_id = dlee.id
         WHERE ${whereClause}
         ORDER BY ${orderCol} ${sortOrder}
         LIMIT 10000`,
        ...params,
      );
    })) as Array<{
      delegator_first_name: string;
      delegator_last_name: string;
      delegator_emp_id: string | null;
      delegatee_first_name: string;
      delegatee_last_name: string;
      delegatee_emp_id: string | null;
      type: string;
      description: string | null;
      start_date: Date;
      end_date: Date | null;
      status: string;
      created_at: Date;
    }>;

    const data = rows.map((r) => ({
      delegator: `${r.delegator_first_name} ${r.delegator_last_name}`.trim(),
      delegatorEmployeeId: r.delegator_emp_id ?? '',
      delegatee: `${r.delegatee_first_name} ${r.delegatee_last_name}`.trim(),
      delegateeEmployeeId: r.delegatee_emp_id ?? '',
      type: r.type,
      description: r.description ?? '',
      startDate: r.start_date ? new Date(r.start_date).toISOString().slice(0, 10) : '',
      endDate: r.end_date ? new Date(r.end_date).toISOString().slice(0, 10) : '',
      status: r.status,
      createdDate: r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '',
    }));

    const columns = [
      { key: 'delegator', header: 'Delegator', width: 25 },
      { key: 'delegatorEmployeeId', header: 'Delegator Employee ID', width: 18 },
      { key: 'delegatee', header: 'Delegatee', width: 25 },
      { key: 'delegateeEmployeeId', header: 'Delegatee Employee ID', width: 18 },
      { key: 'type', header: 'Type', width: 15 },
      { key: 'description', header: 'Description', width: 40 },
      { key: 'startDate', header: 'Start Date', width: 12 },
      { key: 'endDate', header: 'End Date', width: 12 },
      { key: 'status', header: 'Status', width: 12 },
      { key: 'createdDate', header: 'Created Date', width: 12 },
    ];

    if (format === 'csv') return this.exportService.toCsv(data, columns);
    if (format === 'xlsx') return this.exportService.toXlsx(data, columns, { sheetName: 'Delegations' });
    return this.exportService.toPdf(data, columns, { title: 'Delegations' });
  }
}
