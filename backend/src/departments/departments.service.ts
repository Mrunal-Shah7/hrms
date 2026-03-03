import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExportService } from '../core/export/export.service';
import { TenantInfo } from '../tenant/tenant.interface';
import type { CreateDepartmentDto } from './dto/create-department.dto';
import type { UpdateDepartmentDto } from './dto/update-department.dto';
import type { ListDepartmentsQueryDto } from './dto/list-departments-query.dto';

@Injectable()
export class DepartmentsService {
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

  private async getParentDepth(schemaName: string, parentId: string | null): Promise<number> {
    if (!parentId) return 0;
    const rows = (await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<Array<{ parent_id: string | null }>>(
        `WITH RECURSIVE chain AS (
          SELECT id, parent_id, 1 AS depth FROM departments WHERE id = $1::uuid
          UNION ALL
          SELECT d.id, d.parent_id, c.depth + 1
          FROM departments d JOIN chain c ON d.id = c.parent_id
          WHERE c.depth < 10
        ) SELECT parent_id FROM chain ORDER BY depth DESC LIMIT 1`,
        parentId,
      );
    })) as Array<{ parent_id: string | null }>;
    let depth = 0;
    let current: string | null = parentId;
    while (current) {
      depth++;
      const r = (await this.prisma.withTenantSchema(schemaName, async (tx) => {
        return tx.$queryRawUnsafe<Array<{ parent_id: string | null }>>(
          `SELECT parent_id FROM departments WHERE id = $1::uuid`,
          current,
        );
      })) as Array<{ parent_id: string | null }>;
      current = r[0]?.parent_id ?? null;
    }
    return depth;
  }

  async list(tenant: TenantInfo, query: ListDepartmentsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const offset = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'name';
    const sortOrder = query.sortOrder ?? 'asc';

    const sortColMap: Record<string, string> = {
      name: 'd.name',
      code: 'd.code',
      mailAlias: 'd.mail_alias',
      createdAt: 'd.created_at',
      updatedAt: 'd.updated_at',
    };
    const orderCol = sortColMap[sortBy] ?? 'd.name';

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const conditions: string[] = ['1=1'];
      const params: unknown[] = [];
      let p = 1;

      if (query.search?.trim()) {
        const term = `%${query.search.trim()}%`;
        conditions.push(`(d.name ILIKE $${p} OR d.code ILIKE $${p})`);
        params.push(term);
        p++;
      }
      if (query.parentId !== undefined) {
        if (query.parentId === 'null' || query.parentId === '') {
          conditions.push(`d.parent_id IS NULL`);
        } else {
          conditions.push(`d.parent_id = $${p++}`);
          params.push(query.parentId);
        }
      }

      const whereClause = conditions.join(' AND ');

      const countResult = (await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::text as count FROM departments d WHERE ${whereClause}`,
        ...params,
      )) as Array<{ count: string }>;
      const total = parseInt(countResult[0]?.count ?? '0', 10);

      const rows = (await tx.$queryRawUnsafe(
        `SELECT d.id, d.name, d.code, d.mail_alias, d.head_id, d.parent_id, d.created_at, d.updated_at,
                pd.name AS parent_name,
                hd.first_name AS head_first_name, hd.last_name AS head_last_name, hd.id AS head_user_id,
                (SELECT COUNT(*)::int FROM employee_profiles ep
                 WHERE ep.department_id = d.id
                 AND EXISTS (SELECT 1 FROM users u WHERE u.id = ep.user_id AND u.status = 'active')) AS employee_count
         FROM departments d
         LEFT JOIN departments pd ON d.parent_id = pd.id
         LEFT JOIN users hd ON d.head_id = hd.id
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
        mail_alias: string | null;
        head_id: string | null;
        parent_id: string | null;
        created_at: Date;
        updated_at: Date;
        parent_name: string | null;
        head_first_name: string | null;
        head_last_name: string | null;
        head_user_id: string | null;
        employee_count: number;
      }>;

      const data = rows.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        mailAlias: r.mail_alias,
        head: r.head_id
          ? { id: r.head_user_id, firstName: r.head_first_name, lastName: r.head_last_name }
          : null,
        parent: r.parent_id ? { id: r.parent_id, name: r.parent_name } : null,
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

  async create(tenant: TenantInfo, userId: string, dto: CreateDepartmentDto) {
    const id = crypto.randomUUID();
    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const existingCode = (await tx.$queryRawUnsafe(
        `SELECT id FROM departments WHERE code = $1`,
        dto.code,
      )) as Array<{ id: string }>;
      if (existingCode.length > 0) {
        throw new ConflictException('Department code already exists');
      }

      const parentVal = dto.parentId ?? null;
      const existingName = (await tx.$queryRawUnsafe(
        parentVal === null
          ? `SELECT id FROM departments WHERE name = $1 AND parent_id IS NULL`
          : `SELECT id FROM departments WHERE name = $1 AND parent_id = $2`,
        ...(parentVal === null ? [dto.name] : [dto.name, parentVal]),
      )) as Array<{ id: string }>;
      if (existingName.length > 0) {
        throw new ConflictException('A department with this name already exists at this level');
      }

      if (dto.headId) {
        const headExists = (await tx.$queryRawUnsafe(
          `SELECT id FROM users WHERE id = $1::uuid AND status = 'active'`,
          dto.headId,
        )) as Array<{ id: string }>;
        if (headExists.length === 0) {
          throw new BadRequestException('Department head not found or inactive');
        }
      }

      if (dto.parentId) {
        const parentExists = (await tx.$queryRawUnsafe(
          `SELECT id FROM departments WHERE id = $1::uuid`,
          dto.parentId,
        )) as Array<{ id: string }>;
        if (parentExists.length === 0) {
          throw new BadRequestException('Parent department not found');
        }
        const depth = await this.getParentDepth(tenant.schemaName, dto.parentId);
        if (depth >= 5) {
          throw new BadRequestException('Department hierarchy cannot exceed 5 levels');
        }
      }

      await tx.$executeRawUnsafe(
        `INSERT INTO departments (id, name, code, mail_alias, head_id, parent_id, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::uuid, NOW(), NOW())`,
        id,
        dto.name,
        dto.code,
        dto.mailAlias ?? null,
        dto.headId ?? null,
        dto.parentId ?? null,
      );

      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'create',
        'employee_management',
        'departments',
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
        `SELECT d.id, d.name, d.code, d.mail_alias, d.head_id, d.parent_id, d.created_at, d.updated_at,
                pd.name AS parent_name, pd.code AS parent_code,
                hd.first_name AS head_first_name, hd.last_name AS head_last_name, hd.id AS head_user_id,
                (SELECT COUNT(*)::int FROM employee_profiles ep
                 WHERE ep.department_id = d.id
                 AND EXISTS (SELECT 1 FROM users u WHERE u.id = ep.user_id AND u.status = 'active')) AS employee_count
         FROM departments d
         LEFT JOIN departments pd ON d.parent_id = pd.id
         LEFT JOIN users hd ON d.head_id = hd.id
         WHERE d.id = $1::uuid`,
        id,
      );
    })) as Array<{
      id: string;
      name: string;
      code: string;
      mail_alias: string | null;
      head_id: string | null;
      parent_id: string | null;
      created_at: Date;
      updated_at: Date;
      parent_name: string | null;
      parent_code: string | null;
      head_first_name: string | null;
      head_last_name: string | null;
      head_user_id: string | null;
      employee_count: number;
    }>;

    if (!rows || rows.length === 0) {
      throw new NotFoundException('Department not found');
    }
    const r = rows[0];

    const children = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe(
        `SELECT id, name, code FROM departments WHERE parent_id = $1::uuid ORDER BY name`,
        id,
      );
    })) as Array<{ id: string; name: string; code: string }>;

    const recentMembers = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe(
        `SELECT u.id, u.employee_id, u.first_name, u.last_name, u.email, u.photo_url,
                des.name AS designation_name
         FROM users u
         JOIN employee_profiles ep ON u.id = ep.user_id
         LEFT JOIN designations des ON ep.designation_id = des.id
         WHERE ep.department_id = $1::uuid AND u.status = 'active'
         ORDER BY u.first_name
         LIMIT 10`,
        id,
      );
    })) as Array<{
      id: string;
      employee_id: string | null;
      first_name: string;
      last_name: string;
      email: string;
      photo_url: string | null;
      designation_name: string | null;
    }>;

    return {
      id: r.id,
      name: r.name,
      code: r.code,
      mailAlias: r.mail_alias,
      head: r.head_id
        ? { id: r.head_user_id, firstName: r.head_first_name, lastName: r.head_last_name }
        : null,
      parent: r.parent_id ? { id: r.parent_id, name: r.parent_name, code: r.parent_code } : null,
      children: children.map((c) => ({ id: c.id, name: c.name, code: c.code })),
      employeeCount: r.employee_count,
      recentMembers: recentMembers.map((m) => ({
        id: m.id,
        employeeId: m.employee_id,
        firstName: m.first_name,
        lastName: m.last_name,
        email: m.email,
        photoUrl: m.photo_url,
        designation: m.designation_name,
      })),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async update(tenant: TenantInfo, userId: string, id: string, dto: UpdateDepartmentDto) {
    const existing = await this.findOne(tenant, id);

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      if (dto.code !== undefined && dto.code !== existing.code) {
        const dup = (await tx.$queryRawUnsafe(
          `SELECT id FROM departments WHERE code = $1 AND id != $2::uuid`,
          dto.code,
          id,
        )) as Array<{ id: string }>;
        if (dup.length > 0) throw new ConflictException('Department code already exists');
      }

      if (dto.name !== undefined && dto.name !== existing.name) {
        const parentVal = dto.parentId !== undefined ? dto.parentId : (existing.parent as { id: string } | null)?.id ?? null;
        const dup =
          parentVal === null
            ? ((await tx.$queryRawUnsafe(
                `SELECT id FROM departments WHERE name = $1 AND parent_id IS NULL AND id != $2::uuid`,
                dto.name,
                id,
              )) as Array<{ id: string }>)
            : ((await tx.$queryRawUnsafe(
                `SELECT id FROM departments WHERE name = $1 AND parent_id = $2::uuid AND id != $3::uuid`,
                dto.name,
                parentVal,
                id,
              )) as Array<{ id: string }>);
        if (dup.length > 0) throw new ConflictException('A department with this name already exists at this level');
      }

      if (dto.headId !== undefined) {
        if (dto.headId) {
          const headExists = (await tx.$queryRawUnsafe(
            `SELECT id FROM users WHERE id = $1::uuid AND status = 'active'`,
            dto.headId,
          )) as Array<{ id: string }>;
          if (headExists.length === 0) throw new BadRequestException('Department head not found or inactive');
        }
      }

      if (dto.parentId !== undefined) {
        if (dto.parentId === id) throw new BadRequestException('Department cannot be its own parent');
        if (dto.parentId) {
          const parentExists = (await tx.$queryRawUnsafe(
            `SELECT id FROM departments WHERE id = $1::uuid`,
            dto.parentId,
          )) as Array<{ id: string }>;
          if (parentExists.length === 0) throw new BadRequestException('Parent department not found');
          let walk: string | null = dto.parentId;
          while (walk) {
            if (walk === id) {
              throw new BadRequestException('Circular department hierarchy detected');
            }
            const next = (await tx.$queryRawUnsafe(
              `SELECT parent_id FROM departments WHERE id = $1::uuid`,
              walk,
            )) as Array<{ parent_id: string | null }>;
            walk = next[0]?.parent_id ?? null;
          }
          const depth = await this.getParentDepth(tenant.schemaName, dto.parentId);
          if (depth >= 5) throw new BadRequestException('Department hierarchy cannot exceed 5 levels');
        }
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
      if (dto.mailAlias !== undefined) {
        updates.push(`mail_alias = $${p++}`);
        params.push(dto.mailAlias ?? null);
      }
      if (dto.headId !== undefined) {
        updates.push(`head_id = $${p++}`);
        params.push(dto.headId ?? null);
      }
      if (dto.parentId !== undefined) {
        updates.push(`parent_id = $${p++}`);
        params.push(dto.parentId ?? null);
      }
      if (updates.length > 0) {
        updates.push(`updated_at = NOW()`);
        params.push(id);
        await tx.$executeRawUnsafe(
          `UPDATE departments SET ${updates.join(', ')} WHERE id = $${p}::uuid`,
          ...params,
        );
        await this.insertAuditLog(
          tenant.schemaName,
          userId,
          'update',
          'employee_management',
          'departments',
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
        `SELECT COUNT(*)::int as c FROM employee_profiles WHERE department_id = $1::uuid`,
        id,
      )) as Array<{ c: number }>;
      if (empCount[0]?.c > 0) {
        throw new BadRequestException(
          `Cannot delete department with ${empCount[0].c} assigned employees. Reassign them first.`,
        );
      }
      const childCount = (await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::int as c FROM departments WHERE parent_id = $1::uuid`,
        id,
      )) as Array<{ c: number }>;
      if (childCount[0]?.c > 0) {
        throw new BadRequestException(
          'Cannot delete department with sub-departments. Delete or reassign them first.',
        );
      }

      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'delete',
        'employee_management',
        'departments',
        id,
        existing as object,
        null,
      );

      await tx.$executeRawUnsafe(`DELETE FROM departments WHERE id = $1::uuid`, id);
    });

    return { message: 'Department deleted' };
  }

  async getMembers(
    tenant: TenantInfo,
    id: string,
    query: { page?: number; limit?: number; search?: string; sortBy?: string; sortOrder?: string },
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const offset = (page - 1) * limit;

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const countResult = (await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::text as count FROM users u
         JOIN employee_profiles ep ON u.id = ep.user_id
         WHERE ep.department_id = $1::uuid AND u.status = 'active'`,
        id,
      )) as Array<{ count: string }>;
      const total = parseInt(countResult[0]?.count ?? '0', 10);

      const rows = (await tx.$queryRawUnsafe(
        `SELECT u.id, u.employee_id, u.first_name, u.last_name, u.email, u.phone, u.photo_url,
                u.email_domain_type, u.status, ep.employment_type, ep.date_of_joining,
                des.name AS designation_name
         FROM users u
         JOIN employee_profiles ep ON u.id = ep.user_id
         LEFT JOIN designations des ON ep.designation_id = des.id
         WHERE ep.department_id = $1::uuid AND u.status = 'active'
         ORDER BY u.first_name
         LIMIT $2 OFFSET $3`,
        id,
        limit,
        offset,
      )) as Array<{
        id: string;
        employee_id: string | null;
        first_name: string;
        last_name: string;
        email: string;
        phone: string | null;
        photo_url: string | null;
        email_domain_type: string;
        status: string;
        employment_type: string | null;
        date_of_joining: Date | null;
        designation_name: string | null;
      }>;

      const data = rows.map((r) => ({
        id: r.id,
        employeeId: r.employee_id,
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
        phone: r.phone,
        photoUrl: r.photo_url,
        emailDomainType: r.email_domain_type,
        status: r.status,
        employmentType: r.employment_type ?? 'permanent',
        dateOfJoining: r.date_of_joining,
        designation: r.designation_name ? { name: r.designation_name } : null,
      }));

      return {
        data,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  async getTree(tenant: TenantInfo) {
    const rows = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe(
        `SELECT id, name, code, parent_id FROM departments ORDER BY name`,
      );
    })) as Array<{ id: string; name: string; code: string; parent_id: string | null }>;

    const byId = new Map<string, { id: string; name: string; code: string; children: unknown[] }>();
    for (const r of rows) {
      byId.set(r.id, { id: r.id, name: r.name, code: r.code, children: [] });
    }

    const roots: { id: string; name: string; code: string; children: unknown[] }[] = [];
    for (const r of rows) {
      const node = byId.get(r.id)!;
      if (!r.parent_id) {
        roots.push(node);
      } else {
        const parent = byId.get(r.parent_id);
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
    }

    return roots;
  }

  async export(tenant: TenantInfo, format: 'csv' | 'xlsx') {
    const result = await this.list(tenant, { limit: 10000, page: 1 });
    const data = (result.data as Record<string, unknown>[]).map((row) => ({
      name: row.name,
      code: row.code,
      mailAlias: row.mailAlias ?? '',
      headName: row.head && typeof row.head === 'object' && 'firstName' in row.head && 'lastName' in row.head
        ? `${(row.head as { firstName: string; lastName: string }).firstName} ${(row.head as { firstName: string; lastName: string }).lastName}`
        : '',
      parentDepartment: row.parent && typeof row.parent === 'object' && 'name' in row.parent
        ? (row.parent as { name: string }).name
        : '',
      employeeCount: row.employeeCount ?? 0,
    }));

    const columns = [
      { key: 'name', header: 'Name' },
      { key: 'code', header: 'Code' },
      { key: 'mailAlias', header: 'Mail Alias' },
      { key: 'headName', header: 'Head Name' },
      { key: 'parentDepartment', header: 'Parent Department' },
      { key: 'employeeCount', header: 'Employee Count' },
    ];

    if (format === 'csv') {
      return this.exportService.toCsv(data, columns);
    }
    return this.exportService.toXlsx(data, columns, { sheetName: 'Departments' });
  }
}
