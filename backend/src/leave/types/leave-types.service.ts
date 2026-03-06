import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExportService } from '../../core/export/export.service';
import { TenantInfo } from '../../tenant/tenant.interface';
import type { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import type { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import type { ListLeaveTypesQueryDto } from './dto/list-leave-types-query.dto';
import type { ColumnDef } from '../../core/export/export.service';

interface LeaveTypeRow {
  id: string;
  name: string;
  code: string;
  color: string | null;
  icon: string | null;
  is_paid: boolean;
  max_consecutive_days: number | null;
  created_at: Date;
  updated_at: Date;
  policy_count: string;
}

@Injectable()
export class LeaveTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exportService: ExportService,
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

  async list(tenant: TenantInfo, query: ListLeaveTypesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const offset = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'name';
    const sortOrder = query.sortOrder ?? 'asc';
    const sortColMap: Record<string, string> = {
      name: 'lt.name',
      code: 'lt.code',
      createdAt: 'lt.created_at',
    };
    const orderCol = sortColMap[sortBy] ?? 'lt.name';

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const conditions: string[] = ['1=1'];
      const params: unknown[] = [];
      let p = 1;
      if (query.search?.trim()) {
        const term = `%${query.search.trim()}%`;
        conditions.push(`(lt.name ILIKE $${p} OR lt.code ILIKE $${p})`);
        params.push(term);
        p++;
      }
      const whereClause = conditions.join(' AND ');
      const countResult = (await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::text as count FROM leave_types lt WHERE ${whereClause}`,
        ...params,
      )) as Array<{ count: string }>;
      const total = parseInt(countResult[0]?.count ?? '0', 10);

      const rows = (await tx.$queryRawUnsafe(
        `SELECT lt.id, lt.name, lt.code, lt.color, lt.icon, lt.is_paid, lt.max_consecutive_days,
                lt.created_at, lt.updated_at,
                (SELECT COUNT(*)::text FROM leave_policies lp WHERE lp.leave_type_id = lt.id) AS policy_count
         FROM leave_types lt
         WHERE ${whereClause}
         ORDER BY ${orderCol} ${sortOrder === 'desc' ? 'DESC' : 'ASC'}
         LIMIT $${p} OFFSET $${p + 1}`,
        ...params,
        limit,
        offset,
      )) as LeaveTypeRow[];

      const data = rows.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        color: r.color,
        icon: r.icon,
        isPaid: r.is_paid,
        maxConsecutiveDays: r.max_consecutive_days,
        policyCount: parseInt(r.policy_count, 10),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));

      return {
        data,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    });
  }

  async create(tenant: TenantInfo, userId: string, dto: CreateLeaveTypeDto) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const existingCode = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM leave_types WHERE code = $1`,
        dto.code,
      );
      if (existingCode.length > 0) {
        throw new ConflictException('Leave type with this code already exists');
      }
      const existingName = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM leave_types WHERE name = $1`,
        dto.name,
      );
      if (existingName.length > 0) {
        throw new ConflictException('Leave type with this name already exists');
      }
      const id = crypto.randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO leave_types (id, name, code, color, icon, is_paid, max_consecutive_days, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        id,
        dto.name,
        dto.code,
        dto.color ?? null,
        dto.icon ?? null,
        dto.isPaid,
        dto.maxConsecutiveDays ?? null,
      );
      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'create',
        'leave',
        'leave_types',
        id,
        null,
        { name: dto.name, code: dto.code },
      );
      const row = (await tx.$queryRawUnsafe(
        `SELECT id, name, code, color, icon, is_paid, max_consecutive_days, created_at, updated_at FROM leave_types WHERE id = $1`,
        id,
      )) as LeaveTypeRow[];
      const r = row[0];
      return {
        id: r.id,
        name: r.name,
        code: r.code,
        color: r.color,
        icon: r.icon,
        isPaid: r.is_paid,
        maxConsecutiveDays: r.max_consecutive_days,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  }

  async findOne(tenant: TenantInfo, id: string) {
    const result = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const rows = (await tx.$queryRawUnsafe(
        `SELECT lt.id, lt.name, lt.code, lt.color, lt.icon, lt.is_paid, lt.max_consecutive_days, lt.created_at, lt.updated_at,
                (SELECT COUNT(*)::text FROM leave_policies lp WHERE lp.leave_type_id = lt.id) AS policy_count
         FROM leave_types lt WHERE lt.id = $1`,
        id,
      )) as LeaveTypeRow[];
      if (rows.length === 0) return null;
      const r = rows[0];
      const empCountRows = await tx.$queryRawUnsafe<{ count: string }[]>(
        `SELECT COUNT(DISTINCT ep.user_id)::text AS count
         FROM leave_policies lp
         JOIN employee_profiles ep ON (
           (lp.designation_id IS NULL OR ep.designation_id = lp.designation_id)
           AND (lp.department_id IS NULL OR ep.department_id = lp.department_id)
           AND (lp.employment_type IS NULL OR ep.employment_type = lp.employment_type)
         )
         WHERE lp.leave_type_id = $1`,
        id,
      );
      const totalCovered = parseInt(empCountRows[0]?.count ?? '0', 10);
      return {
        id: r.id,
        name: r.name,
        code: r.code,
        color: r.color,
        icon: r.icon,
        isPaid: r.is_paid,
        maxConsecutiveDays: r.max_consecutive_days,
        policyCount: parseInt(r.policy_count, 10),
        totalEmployeesCovered: totalCovered,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
    if (!result) throw new NotFoundException('Leave type not found');
    return result;
  }

  async update(tenant: TenantInfo, userId: string, id: string, dto: UpdateLeaveTypeDto) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const existing = (await tx.$queryRawUnsafe(
        `SELECT id, name, code FROM leave_types WHERE id = $1`,
        id,
      )) as Array<{ id: string; name: string; code: string }>;
      if (existing.length === 0) throw new NotFoundException('Leave type not found');
      if (dto.code !== undefined && dto.code !== existing[0].code) {
        const requestCount = (await tx.$queryRawUnsafe<{ count: string }[]>(
          `SELECT COUNT(*)::text FROM leave_requests WHERE leave_type_id = $1`,
          id,
        ))[0];
        if (parseInt(requestCount?.count ?? '0', 10) > 0) {
          throw new BadRequestException(
            'Cannot change code when leave requests exist for this type. Archive it instead by removing its policies.',
          );
        }
      }
      if (dto.code !== undefined) {
        const dup = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM leave_types WHERE code = $1 AND id != $2`,
          dto.code,
          id,
        );
        if (dup.length > 0) throw new ConflictException('Leave type with this code already exists');
      }
      if (dto.name !== undefined) {
        const dup = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM leave_types WHERE name = $1 AND id != $2`,
          dto.name,
          id,
        );
        if (dup.length > 0) throw new ConflictException('Leave type with this name already exists');
      }
      const updates: string[] = [];
      const params: unknown[] = [];
      let p = 1;
      if (dto.name !== undefined) {
        updates.push(`name = $${p++}`);
        params.push(dto.name);
      }
      if (dto.code !== undefined) {
        updates.push(`code = $${p++}`);
        params.push(dto.code);
      }
      if (dto.color !== undefined) {
        updates.push(`color = $${p++}`);
        params.push(dto.color);
      }
      if (dto.icon !== undefined) {
        updates.push(`icon = $${p++}`);
        params.push(dto.icon);
      }
      if (dto.isPaid !== undefined) {
        updates.push(`is_paid = $${p++}`);
        params.push(dto.isPaid);
      }
      if (dto.maxConsecutiveDays !== undefined) {
        updates.push(`max_consecutive_days = $${p++}`);
        params.push(dto.maxConsecutiveDays);
      }
      if (updates.length === 0) {
        return this.findOne(tenant, id);
      }
      updates.push(`updated_at = NOW()`);
      params.push(id);
      await tx.$executeRawUnsafe(
        `UPDATE leave_types SET ${updates.join(', ')} WHERE id = $${p}`,
        ...params,
      );
      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'update',
        'leave',
        'leave_types',
        id,
        { name: existing[0].name, code: existing[0].code },
        dto as object,
      );
      return this.findOne(tenant, id);
    });
  }

  async delete(tenant: TenantInfo, userId: string, id: string) {
    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const requestCount = (await tx.$queryRawUnsafe<{ count: string }[]>(
        `SELECT COUNT(*)::text FROM leave_requests WHERE leave_type_id = $1`,
        id,
      ))[0];
      if (parseInt(requestCount?.count ?? '0', 10) > 0) {
        throw new BadRequestException(
          'Cannot delete leave type with existing requests. Archive it instead by removing its policies.',
        );
      }
      const existing = (await tx.$queryRawUnsafe(
        `SELECT id, name, code FROM leave_types WHERE id = $1`,
        id,
      )) as Array<{ id: string; name: string; code: string }>;
      if (existing.length === 0) throw new NotFoundException('Leave type not found');
      await tx.$executeRawUnsafe(`DELETE FROM leave_types WHERE id = $1`, id);
      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'delete',
        'leave',
        'leave_types',
        id,
        { name: existing[0].name, code: existing[0].code },
        null,
      );
    });
    return { message: 'Leave type deleted' };
  }

  async export(tenant: TenantInfo, format: 'csv' | 'xlsx') {
    const { data } = await this.list(tenant, { page: 1, limit: 10000 });
    const columns: ColumnDef[] = [
      { key: 'name', header: 'Name' },
      { key: 'code', header: 'Code' },
      {
        key: 'isPaid',
        header: 'Paid/Unpaid',
        format: (v) => (v ? 'Paid' : 'Unpaid'),
      },
      {
        key: 'maxConsecutiveDays',
        header: 'Max Consecutive Days',
        format: (v) => (v != null ? String(v) : '—'),
      },
      { key: 'policyCount', header: 'Policy Count' },
    ];
    if (format === 'csv') return this.exportService.toCsv(data, columns);
    return this.exportService.toXlsx(data, columns, { sheetName: 'Leave Types' });
  }
}
