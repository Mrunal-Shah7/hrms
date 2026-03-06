import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExportService } from '../../core/export/export.service';
import type { ColumnDef } from '../../core/export/export.service';
import { TenantInfo } from '../../tenant/tenant.interface';
import type { CreateLeavePolicyDto } from './dto/create-leave-policy.dto';
import type { UpdateLeavePolicyDto } from './dto/update-leave-policy.dto';
import type { ListLeavePoliciesQueryDto } from './dto/list-leave-policies-query.dto';

interface PolicyRow {
  id: string;
  leave_type_id: string;
  designation_id: string | null;
  department_id: string | null;
  employment_type: string | null;
  annual_allocation: number;
  carry_forward: boolean;
  max_carry_forward: number | null;
  accrual_type: string;
  created_at: Date;
  updated_at: Date;
  leave_type_name: string;
  leave_type_code: string;
  leave_type_color: string | null;
  designation_name: string | null;
  department_name: string | null;
}

@Injectable()
export class LeavePoliciesService {
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

  async list(tenant: TenantInfo, query: ListLeavePoliciesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const offset = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';
    const sortColMap: Record<string, string> = {
      createdAt: 'lp.created_at',
      updatedAt: 'lp.updated_at',
      annualAllocation: 'lp.annual_allocation',
    };
    const orderCol = sortColMap[sortBy] ?? 'lp.created_at';

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const conditions: string[] = ['1=1'];
      const params: unknown[] = [];
      let p = 1;
      if (query.leaveTypeId) {
        conditions.push(`lp.leave_type_id = $${p++}`);
        params.push(query.leaveTypeId);
      }
      if (query.departmentId) {
        conditions.push(`lp.department_id = $${p++}`);
        params.push(query.departmentId);
      }
      if (query.designationId) {
        conditions.push(`lp.designation_id = $${p++}`);
        params.push(query.designationId);
      }
      if (query.employmentType) {
        conditions.push(`lp.employment_type = $${p++}`);
        params.push(query.employmentType);
      }
      const whereClause = conditions.join(' AND ');
      const countResult = (await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::text as count FROM leave_policies lp WHERE ${whereClause}`,
        ...params,
      )) as Array<{ count: string }>;
      const total = parseInt(countResult[0]?.count ?? '0', 10);

      const rows = (await tx.$queryRawUnsafe(
        `SELECT lp.id, lp.leave_type_id, lp.designation_id, lp.department_id, lp.employment_type,
                lp.annual_allocation, lp.carry_forward, lp.max_carry_forward, lp.accrual_type,
                lp.created_at, lp.updated_at,
                lt.name AS leave_type_name, lt.code AS leave_type_code, lt.color AS leave_type_color,
                des.name AS designation_name, dept.name AS department_name
         FROM leave_policies lp
         JOIN leave_types lt ON lp.leave_type_id = lt.id
         LEFT JOIN designations des ON lp.designation_id = des.id
         LEFT JOIN departments dept ON lp.department_id = dept.id
         WHERE ${whereClause}
         ORDER BY ${orderCol} ${sortOrder === 'desc' ? 'DESC' : 'ASC'}
         LIMIT $${p} OFFSET $${p + 1}`,
        ...params,
        limit,
        offset,
      )) as PolicyRow[];

      const data = rows.map((r) => ({
        id: r.id,
        leaveType: {
          id: r.leave_type_id,
          name: r.leave_type_name,
          code: r.leave_type_code,
          color: r.leave_type_color,
        },
        designation: r.designation_id
          ? { id: r.designation_id, name: r.designation_name ?? '' }
          : null,
        department: r.department_id
          ? { id: r.department_id, name: r.department_name ?? '' }
          : null,
        employmentType: r.employment_type,
        annualAllocation: r.annual_allocation,
        carryForward: r.carry_forward,
        maxCarryForward: r.max_carry_forward,
        accrualType: r.accrual_type,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));

      return {
        data,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  async export(tenant: TenantInfo, query: ListLeavePoliciesQueryDto, format: 'csv' | 'xlsx'): Promise<Buffer> {
    const { data } = await this.list(tenant, { ...query, page: 1, limit: 10000 });
    const exportData: Record<string, unknown>[] = data.map((row) => ({
      leaveTypeName: (row.leaveType as { name?: string })?.name ?? '',
      leaveTypeCode: (row.leaveType as { code?: string })?.code ?? '',
      designation: (row.designation as { name?: string } | null)?.name ?? 'All',
      department: (row.department as { name?: string } | null)?.name ?? 'All',
      employmentType: row.employmentType ?? 'All',
      annualAllocation: row.annualAllocation,
      accrualType: row.accrualType,
      carryForward: row.carryForward ? 'Yes' : 'No',
      maxCarryForward: row.maxCarryForward != null ? String(row.maxCarryForward) : '—',
    }));
    const columns: ColumnDef[] = [
      { key: 'leaveTypeName', header: 'Leave Type' },
      { key: 'leaveTypeCode', header: 'Leave Type Code' },
      { key: 'designation', header: 'Designation' },
      { key: 'department', header: 'Department' },
      { key: 'employmentType', header: 'Employment Type' },
      { key: 'annualAllocation', header: 'Annual Allocation' },
      { key: 'accrualType', header: 'Accrual Type' },
      { key: 'carryForward', header: 'Carry Forward' },
      { key: 'maxCarryForward', header: 'Max Carry Forward' },
    ];
    if (format === 'csv') return this.exportService.toCsv(exportData, columns);
    return this.exportService.toXlsx(exportData, columns, { sheetName: 'Leave Policies' });
  }

  async create(tenant: TenantInfo, userId: string, dto: CreateLeavePolicyDto) {
    if (dto.carryForward && (dto.maxCarryForward === undefined || dto.maxCarryForward === null)) {
      throw new BadRequestException(
        'Maximum carry forward days required when carry forward is enabled',
      );
    }
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const ltRows = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM leave_types WHERE id = $1`,
        dto.leaveTypeId,
      );
      if (ltRows.length === 0) throw new NotFoundException('Leave type not found');
      if (dto.designationId) {
        const desRows = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM designations WHERE id = $1`,
          dto.designationId,
        );
        if (desRows.length === 0) throw new NotFoundException('Designation not found');
      }
      if (dto.departmentId) {
        const deptRows = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM departments WHERE id = $1`,
          dto.departmentId,
        );
        if (deptRows.length === 0) throw new NotFoundException('Department not found');
      }
      const dup = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM leave_policies
         WHERE leave_type_id = $1
           AND (designation_id = $2 OR ($2::uuid IS NULL AND designation_id IS NULL))
           AND (department_id = $3 OR ($3::uuid IS NULL AND department_id IS NULL))
           AND (employment_type::text IS NOT DISTINCT FROM $4)`,
        dto.leaveTypeId,
        dto.designationId ?? null,
        dto.departmentId ?? null,
        dto.employmentType ?? null,
      );
      if (dup.length > 0) {
        throw new ConflictException(
          'A policy with this exact scope already exists for this leave type',
        );
      }
      const id = crypto.randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO leave_policies (id, leave_type_id, designation_id, department_id, employment_type,
          annual_allocation, carry_forward, max_carry_forward, accrual_type, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
        id,
        dto.leaveTypeId,
        dto.designationId ?? null,
        dto.departmentId ?? null,
        dto.employmentType ?? null,
        dto.annualAllocation,
        dto.carryForward,
        dto.carryForward ? dto.maxCarryForward ?? null : null,
        dto.accrualType,
      );
      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'create',
        'leave',
        'leave_policies',
        id,
        null,
        { leaveTypeId: dto.leaveTypeId, annualAllocation: dto.annualAllocation },
      );
      const rows = (await tx.$queryRawUnsafe(
        `SELECT lp.id, lp.leave_type_id, lp.designation_id, lp.department_id, lp.employment_type,
                lp.annual_allocation, lp.carry_forward, lp.max_carry_forward, lp.accrual_type,
                lp.created_at, lp.updated_at,
                lt.name AS leave_type_name, lt.code AS leave_type_code, lt.color AS leave_type_color,
                des.name AS designation_name, dept.name AS department_name
         FROM leave_policies lp
         JOIN leave_types lt ON lp.leave_type_id = lt.id
         LEFT JOIN designations des ON lp.designation_id = des.id
         LEFT JOIN departments dept ON lp.department_id = dept.id
         WHERE lp.id = $1`,
        id,
      )) as PolicyRow[];
      const r = rows[0];
      return {
        id: r.id,
        leaveType: { id: r.leave_type_id, name: r.leave_type_name, code: r.leave_type_code, color: r.leave_type_color },
        designation: r.designation_id ? { id: r.designation_id, name: r.designation_name ?? '' } : null,
        department: r.department_id ? { id: r.department_id, name: r.department_name ?? '' } : null,
        employmentType: r.employment_type,
        annualAllocation: r.annual_allocation,
        carryForward: r.carry_forward,
        maxCarryForward: r.max_carry_forward,
        accrualType: r.accrual_type,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  }

  async findOne(tenant: TenantInfo, id: string) {
    const result = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const rows = (await tx.$queryRawUnsafe(
        `SELECT lp.id, lp.leave_type_id, lp.designation_id, lp.department_id, lp.employment_type,
                lp.annual_allocation, lp.carry_forward, lp.max_carry_forward, lp.accrual_type,
                lp.created_at, lp.updated_at,
                lt.name AS leave_type_name, lt.code AS leave_type_code, lt.color AS leave_type_color,
                des.name AS designation_name, dept.name AS department_name
         FROM leave_policies lp
         JOIN leave_types lt ON lp.leave_type_id = lt.id
         LEFT JOIN designations des ON lp.designation_id = des.id
         LEFT JOIN departments dept ON lp.department_id = dept.id
         WHERE lp.id = $1`,
        id,
      )) as PolicyRow[];
      if (rows.length === 0) return null;
      const r = rows[0];
      const countRows = await tx.$queryRawUnsafe<{ count: string }[]>(
        `WITH pol AS (SELECT designation_id, department_id, employment_type FROM leave_policies WHERE id = $1::uuid)
         SELECT COUNT(*)::text AS count FROM users u
         JOIN employee_profiles ep ON u.id = ep.user_id
         CROSS JOIN pol
         WHERE u.status = 'active'
           AND (pol.designation_id IS NULL OR ep.designation_id = pol.designation_id)
           AND (pol.department_id IS NULL OR ep.department_id = pol.department_id)
           AND (pol.employment_type IS NULL OR ep.employment_type = pol.employment_type)`,
        id,
      );
      const affectedCount = parseInt(countRows[0]?.count ?? '0', 10);
      return {
        id: r.id,
        leaveType: { id: r.leave_type_id, name: r.leave_type_name, code: r.leave_type_code, color: r.leave_type_color },
        designation: r.designation_id ? { id: r.designation_id, name: r.designation_name ?? '' } : null,
        department: r.department_id ? { id: r.department_id, name: r.department_name ?? '' } : null,
        employmentType: r.employment_type,
        annualAllocation: r.annual_allocation,
        carryForward: r.carry_forward,
        maxCarryForward: r.max_carry_forward,
        accrualType: r.accrual_type,
        affectedEmployeeCount: affectedCount,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
    if (!result) throw new NotFoundException('Leave policy not found');
    return result;
  }

  async update(tenant: TenantInfo, userId: string, id: string, dto: UpdateLeavePolicyDto) {
    if (dto.carryForward === true && dto.maxCarryForward === undefined) {
      const existing = await this.findOne(tenant, id);
      if (existing.carryForward && existing.maxCarryForward == null) {
        throw new BadRequestException(
          'Maximum carry forward days required when carry forward is enabled',
        );
      }
    }
    if (dto.carryForward && dto.maxCarryForward !== undefined && dto.maxCarryForward < 0) {
      throw new BadRequestException('maxCarryForward must be >= 0');
    }
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const existing = (await tx.$queryRawUnsafe(
        `SELECT id, leave_type_id, designation_id, department_id, employment_type FROM leave_policies WHERE id = $1`,
        id,
      )) as Array<{
        id: string;
        leave_type_id: string;
        designation_id: string | null;
        department_id: string | null;
        employment_type: string | null;
      }>;
      if (existing.length === 0) throw new NotFoundException('Leave policy not found');
      const designId = dto.designationId !== undefined ? dto.designationId : existing[0].designation_id;
      const deptId = dto.departmentId !== undefined ? dto.departmentId : existing[0].department_id;
      const empType = dto.employmentType !== undefined ? dto.employmentType : existing[0].employment_type;
      const ltId = dto.leaveTypeId !== undefined ? dto.leaveTypeId : existing[0].leave_type_id;
      const dup = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM leave_policies
         WHERE leave_type_id = $1
           AND (designation_id = $2 OR ($2::uuid IS NULL AND designation_id IS NULL))
           AND (department_id = $3 OR ($3::uuid IS NULL AND department_id IS NULL))
           AND (employment_type::text IS NOT DISTINCT FROM $4)
           AND id != $5`,
        ltId,
        designId ?? null,
        deptId ?? null,
        empType ?? null,
        id,
      );
      if (dup.length > 0) {
        throw new ConflictException(
          'A policy with this exact scope already exists for this leave type',
        );
      }
      const updates: string[] = [];
      const params: unknown[] = [];
      let p = 1;
      if (dto.leaveTypeId !== undefined) {
        updates.push(`leave_type_id = $${p++}`);
        params.push(dto.leaveTypeId);
      }
      if (dto.designationId !== undefined) {
        updates.push(`designation_id = $${p++}`);
        params.push(dto.designationId);
      }
      if (dto.departmentId !== undefined) {
        updates.push(`department_id = $${p++}`);
        params.push(dto.departmentId);
      }
      if (dto.employmentType !== undefined) {
        updates.push(`employment_type = $${p++}`);
        params.push(dto.employmentType);
      }
      if (dto.annualAllocation !== undefined) {
        updates.push(`annual_allocation = $${p++}`);
        params.push(dto.annualAllocation);
      }
      if (dto.carryForward !== undefined) {
        updates.push(`carry_forward = $${p++}`);
        params.push(dto.carryForward);
      }
      if (dto.maxCarryForward !== undefined) {
        updates.push(`max_carry_forward = $${p++}`);
        params.push(dto.carryForward === false ? null : dto.maxCarryForward);
      } else if (dto.carryForward === false) {
        updates.push(`max_carry_forward = NULL`);
      }
      if (dto.accrualType !== undefined) {
        updates.push(`accrual_type = $${p++}`);
        params.push(dto.accrualType);
      }
      if (updates.length > 0) {
        params.push(id);
        await tx.$executeRawUnsafe(
          `UPDATE leave_policies SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${p}`,
          ...params,
        );
        await this.insertAuditLog(
          tenant.schemaName,
          userId,
          'update',
          'leave',
          'leave_policies',
          id,
          {},
          dto as object,
        );
      }
      return this.findOne(tenant, id);
    });
  }

  async delete(tenant: TenantInfo, userId: string, id: string) {
    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const existing = (await tx.$queryRawUnsafe(
        `SELECT id, leave_type_id, annual_allocation FROM leave_policies WHERE id = $1`,
        id,
      )) as Array<{ id: string; leave_type_id: string; annual_allocation: number }>;
      if (existing.length === 0) throw new NotFoundException('Leave policy not found');
      await tx.$executeRawUnsafe(`DELETE FROM leave_policies WHERE id = $1`, id);
      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'delete',
        'leave',
        'leave_policies',
        id,
        { leaveTypeId: existing[0].leave_type_id },
        null,
      );
    });
    return { message: 'Leave policy deleted' };
  }

  async preview(
    tenant: TenantInfo,
    leaveTypeId: string,
    designationId?: string,
    departmentId?: string,
    employmentType?: string,
  ) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      let sql = `
        SELECT u.id, u.employee_id, u.first_name, u.last_name
        FROM users u
        JOIN employee_profiles ep ON u.id = ep.user_id
        WHERE u.status = 'active'
      `;
      const params: unknown[] = [];
      let p = 1;
      if (designationId) {
        sql += ` AND ep.designation_id = $${p++}`;
        params.push(designationId);
      }
      if (departmentId) {
        sql += ` AND ep.department_id = $${p++}`;
        params.push(departmentId);
      }
      if (employmentType) {
        sql += ` AND ep.employment_type = $${p++}`;
        params.push(employmentType);
      }
      const countRows = (await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::text AS count FROM (${sql}) sub`,
        ...params,
      )) as Array<{ count: string }>;
      const total = parseInt(countRows[0]?.count ?? '0', 10);
      const sampleRows = (await tx.$queryRawUnsafe(
        `${sql} ORDER BY u.first_name, u.last_name LIMIT 5`,
        ...params,
      )) as Array<{ id: string; employee_id: string | null; first_name: string; last_name: string }>;
      return {
        affectedEmployeeCount: total,
        sampleEmployees: sampleRows.map((s) => ({
          id: s.id,
          employeeId: s.employee_id,
          firstName: s.first_name,
          lastName: s.last_name,
        })),
      };
    });
  }
}
