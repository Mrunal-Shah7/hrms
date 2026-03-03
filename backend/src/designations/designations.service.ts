import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExportService } from '../core/export/export.service';
import { TenantInfo } from '../tenant/tenant.interface';
import type { CreateDesignationDto } from './dto/create-designation.dto';
import type { UpdateDesignationDto } from './dto/update-designation.dto';
import type { ListDesignationsQueryDto } from './dto/list-designations-query.dto';

@Injectable()
export class DesignationsService {
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

  async list(tenant: TenantInfo, query: ListDesignationsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const offset = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'hierarchyLevel';
    const sortOrder = query.sortOrder ?? 'asc';

    const sortColMap: Record<string, string> = {
      name: 'des.name',
      code: 'des.code',
      hierarchyLevel: 'des.hierarchy_level',
      createdAt: 'des.created_at',
      updatedAt: 'des.updated_at',
    };
    const orderCol = sortColMap[sortBy] ?? 'des.hierarchy_level';

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const conditions: string[] = ['1=1'];
      const params: unknown[] = [];
      let p = 1;

      if (query.search?.trim()) {
        const term = `%${query.search.trim()}%`;
        conditions.push(`(des.name ILIKE $${p} OR des.code ILIKE $${p})`);
        params.push(term);
        p++;
      }

      const whereClause = conditions.join(' AND ');

      const countResult = (await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::text as count FROM designations des WHERE ${whereClause}`,
        ...params,
      )) as Array<{ count: string }>;
      const total = parseInt(countResult[0]?.count ?? '0', 10);

      const rows = (await tx.$queryRawUnsafe(
        `SELECT des.id, des.name, des.code, des.hierarchy_level, des.created_at, des.updated_at,
                (SELECT COUNT(*)::int FROM employee_profiles ep
                 WHERE ep.designation_id = des.id
                 AND EXISTS (SELECT 1 FROM users u WHERE u.id = ep.user_id AND u.status = 'active')) AS employee_count
         FROM designations des
         WHERE ${whereClause}
         ORDER BY ${orderCol} ${sortOrder}
         LIMIT $${p} OFFSET $${p + 1}`,
        ...params,
        limit,
        offset,
      )) as Array<{
        id: string;
        name: string;
        code: string;
        hierarchy_level: number;
        created_at: Date;
        updated_at: Date;
        employee_count: number;
      }>;

      const data = rows.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        hierarchyLevel: r.hierarchy_level,
        employeeCount: r.employee_count,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));

      return {
        data,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  async create(tenant: TenantInfo, userId: string, dto: CreateDesignationDto) {
    const id = crypto.randomUUID();
    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const existingCode = (await tx.$queryRawUnsafe(
        `SELECT id FROM designations WHERE code = $1`,
        dto.code,
      )) as Array<{ id: string }>;
      if (existingCode.length > 0) {
        throw new ConflictException('Designation code already exists');
      }

      const existingName = (await tx.$queryRawUnsafe(
        `SELECT id FROM designations WHERE name = $1`,
        dto.name,
      )) as Array<{ id: string }>;
      if (existingName.length > 0) {
        throw new ConflictException('A designation with this name already exists');
      }

      await tx.$executeRawUnsafe(
        `INSERT INTO designations (id, name, code, hierarchy_level, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4, NOW(), NOW())`,
        id,
        dto.name,
        dto.code,
        dto.hierarchyLevel,
      );

      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'create',
        'employee_management',
        'designations',
        id,
        null,
        dto as object,
      );
    });

    return this.findOne(tenant, id);
  }

  async findOne(tenant: TenantInfo, id: string) {
    const rows = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe(
        `SELECT des.id, des.name, des.code, des.hierarchy_level, des.created_at, des.updated_at,
                (SELECT COUNT(*)::int FROM employee_profiles ep
                 WHERE ep.designation_id = des.id
                 AND EXISTS (SELECT 1 FROM users u WHERE u.id = ep.user_id AND u.status = 'active')) AS employee_count
         FROM designations des WHERE des.id = $1::uuid`,
        id,
      );
    })) as Array<{
      id: string;
      name: string;
      code: string;
      hierarchy_level: number;
      created_at: Date;
      updated_at: Date;
      employee_count: number;
    }>;

    if (!rows || rows.length === 0) {
      throw new NotFoundException('Designation not found');
    }
    const r = rows[0];

    return {
      id: r.id,
      name: r.name,
      code: r.code,
      hierarchyLevel: r.hierarchy_level,
      employeeCount: r.employee_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async update(tenant: TenantInfo, userId: string, id: string, dto: UpdateDesignationDto) {
    const existing = await this.findOne(tenant, id);

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      if (dto.code !== undefined && dto.code !== existing.code) {
        const dup = (await tx.$queryRawUnsafe(
          `SELECT id FROM designations WHERE code = $1 AND id != $2::uuid`,
          dto.code,
          id,
        )) as Array<{ id: string }>;
        if (dup.length > 0) throw new ConflictException('Designation code already exists');
      }

      if (dto.name !== undefined && dto.name !== existing.name) {
        const dup = (await tx.$queryRawUnsafe(
          `SELECT id FROM designations WHERE name = $1 AND id != $2::uuid`,
          dto.name,
          id,
        )) as Array<{ id: string }>;
        if (dup.length > 0) throw new ConflictException('A designation with this name already exists');
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
      if (dto.hierarchyLevel !== undefined) {
        updates.push(`hierarchy_level = $${p++}`);
        params.push(dto.hierarchyLevel);
      }
      if (updates.length > 0) {
        updates.push(`updated_at = NOW()`);
        params.push(id);
        await tx.$executeRawUnsafe(
          `UPDATE designations SET ${updates.join(', ')} WHERE id = $${p}::uuid`,
          ...params,
        );
        await this.insertAuditLog(
          tenant.schemaName,
          userId,
          'update',
          'employee_management',
          'designations',
          id,
          existing as object,
          { ...existing, ...dto } as object,
        );
      }
    });

    return this.findOne(tenant, id);
  }

  async delete(tenant: TenantInfo, userId: string, id: string) {
    const existing = await this.findOne(tenant, id);

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const empCount = (await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::int as c FROM employee_profiles WHERE designation_id = $1::uuid`,
        id,
      )) as Array<{ c: number }>;
      if (empCount[0]?.c > 0) {
        throw new BadRequestException(
          `Cannot delete designation with ${empCount[0].c} assigned employees. Reassign them first.`,
        );
      }

      const hierarchyCount = (await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::int as c FROM reporting_hierarchy
         WHERE designation_id = $1::uuid OR reports_to_designation_id = $1::uuid`,
        id,
        id,
      )) as Array<{ c: number }>;
      if (hierarchyCount[0]?.c > 0) {
        throw new BadRequestException(
          'Cannot delete designation used in reporting hierarchy. Remove it from the hierarchy first.',
        );
      }

      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'delete',
        'employee_management',
        'designations',
        id,
        existing as object,
        null,
      );

      await tx.$executeRawUnsafe(`DELETE FROM designations WHERE id = $1::uuid`, id);
    });

    return { message: 'Designation deleted' };
  }

  async export(tenant: TenantInfo, format: 'csv' | 'xlsx') {
    const result = await this.list(tenant, { limit: 10000, page: 1 });
    const data = (result.data as Record<string, unknown>[]).map((row) => ({
      name: row.name,
      code: row.code,
      hierarchyLevel: row.hierarchyLevel ?? 0,
      employeeCount: row.employeeCount ?? 0,
    }));

    const columns = [
      { key: 'name', header: 'Name' },
      { key: 'code', header: 'Code' },
      { key: 'hierarchyLevel', header: 'Hierarchy Level' },
      { key: 'employeeCount', header: 'Employee Count' },
    ];

    if (format === 'csv') {
      return this.exportService.toCsv(data, columns);
    }
    return this.exportService.toXlsx(data, columns, { sheetName: 'Designations' });
  }
}
