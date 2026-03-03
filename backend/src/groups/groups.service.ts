import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExportService } from '../core/export/export.service';
import { TenantInfo } from '../tenant/tenant.interface';
import type { CreateGroupDto } from './dto/create-group.dto';
import type { UpdateGroupDto } from './dto/update-group.dto';
import type { ListGroupsQueryDto } from './dto/list-groups-query.dto';

@Injectable()
export class GroupsService {
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

  async list(tenant: TenantInfo, query: ListGroupsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const offset = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'name';
    const sortOrder = query.sortOrder ?? 'asc';

    const sortColMap: Record<string, string> = {
      name: 'g.name',
      memberCount: 'member_count',
      createdAt: 'g.created_at',
    };
    const orderCol = sortColMap[sortBy] ?? 'g.name';

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const conditions: string[] = ['1=1'];
      const params: unknown[] = [];
      let p = 1;

      if (query.search?.trim()) {
        const term = `%${query.search.trim()}%`;
        conditions.push(`(g.name ILIKE $${p} OR g.description ILIKE $${p})`);
        params.push(term);
        p++;
      }

      const whereClause = conditions.join(' AND ');

      const countResult = (await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::text as count FROM groups g
         LEFT JOIN users u ON g.created_by = u.id
         WHERE ${whereClause}`,
        ...params,
      )) as Array<{ count: string }>;
      const total = parseInt(countResult[0]?.count ?? '0', 10);

      const rows = (await tx.$queryRawUnsafe(
        `SELECT g.id, g.name, g.description, g.created_by, g.created_at, g.updated_at,
                u.first_name AS creator_first_name, u.last_name AS creator_last_name,
                (SELECT COUNT(*)::int FROM group_members gm WHERE gm.group_id = g.id) AS member_count
         FROM groups g
         LEFT JOIN users u ON g.created_by = u.id
         WHERE ${whereClause}
         ORDER BY ${orderCol} ${sortOrder}
         LIMIT $${p} OFFSET $${p + 1}`,
        ...params,
        limit,
        offset,
      )) as Array<{
        id: string;
        name: string;
        description: string | null;
        created_by: string;
        created_at: Date;
        updated_at: Date;
        creator_first_name: string | null;
        creator_last_name: string | null;
        member_count: number;
      }>;

      const data = rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        createdBy: {
          id: r.created_by,
          firstName: r.creator_first_name ?? '',
          lastName: r.creator_last_name ?? '',
        },
        memberCount: r.member_count,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));

      return {
        data,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  async create(tenant: TenantInfo, userId: string, dto: CreateGroupDto) {
    const id = crypto.randomUUID();
    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const existing = (await tx.$queryRawUnsafe(
        `SELECT id FROM groups WHERE name = $1`,
        dto.name,
      )) as Array<{ id: string }>;
      if (existing.length > 0) {
        throw new ConflictException('A group with this name already exists');
      }

      await tx.$executeRawUnsafe(
        `INSERT INTO groups (id, name, description, created_by, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4::uuid, NOW(), NOW())`,
        id,
        dto.name,
        dto.description ?? null,
        userId,
      );

      if (dto.memberIds && dto.memberIds.length > 0) {
        for (const uid of dto.memberIds) {
          const userExists = (await tx.$queryRawUnsafe(
            `SELECT id FROM users WHERE id = $1::uuid AND status = 'active'`,
            uid,
          )) as Array<{ id: string }>;
          if (userExists.length === 0) {
            throw new BadRequestException(`User ${uid} not found or inactive`);
          }
          await tx.$executeRawUnsafe(
            `INSERT INTO group_members (id, group_id, user_id, added_at)
             VALUES (gen_random_uuid(), $1::uuid, $2::uuid, NOW())
             ON CONFLICT (group_id, user_id) DO NOTHING`,
            id,
            uid,
          );
        }
      }

      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'create',
        'employee_management',
        'groups',
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
        `SELECT g.id, g.name, g.description, g.created_by, g.created_at, g.updated_at,
                u.first_name AS creator_first_name, u.last_name AS creator_last_name,
                (SELECT COUNT(*)::int FROM group_members gm WHERE gm.group_id = g.id) AS member_count
         FROM groups g
         LEFT JOIN users u ON g.created_by = u.id
         WHERE g.id = $1::uuid`,
        id,
      );
    })) as Array<{
      id: string;
      name: string;
      description: string | null;
      created_by: string;
      created_at: Date;
      updated_at: Date;
      creator_first_name: string | null;
      creator_last_name: string | null;
      member_count: number;
    }>;

    if (!rows || rows.length === 0) {
      throw new NotFoundException('Group not found');
    }
    const r = rows[0];

    const members = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe(
        `SELECT gm.id, gm.added_at,
                u.id AS user_id, u.employee_id, u.first_name, u.last_name, u.email, u.photo_url,
                d.name AS department_name, des.name AS designation_name
         FROM group_members gm
         JOIN users u ON gm.user_id = u.id
         LEFT JOIN employee_profiles ep ON u.id = ep.user_id
         LEFT JOIN departments d ON ep.department_id = d.id
         LEFT JOIN designations des ON ep.designation_id = des.id
         WHERE gm.group_id = $1::uuid AND u.status = 'active'
         ORDER BY u.first_name ASC`,
        id,
      );
    })) as Array<{
      id: string;
      added_at: Date;
      user_id: string;
      employee_id: string | null;
      first_name: string;
      last_name: string;
      email: string;
      photo_url: string | null;
      department_name: string | null;
      designation_name: string | null;
    }>;

    return {
      id: r.id,
      name: r.name,
      description: r.description,
      createdBy: {
        id: r.created_by,
        firstName: r.creator_first_name ?? '',
        lastName: r.creator_last_name ?? '',
      },
      memberCount: r.member_count,
      members: members.map((m) => ({
        id: m.id,
        user: {
          id: m.user_id,
          employeeId: m.employee_id,
          firstName: m.first_name,
          lastName: m.last_name,
          email: m.email,
          photoUrl: m.photo_url,
          department: m.department_name ? { name: m.department_name } : null,
          designation: m.designation_name ? { name: m.designation_name } : null,
        },
        addedAt: m.added_at,
      })),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async update(tenant: TenantInfo, userId: string, id: string, dto: UpdateGroupDto) {
    await this.findOne(tenant, id);

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      if (dto.name !== undefined) {
        const existing = (await tx.$queryRawUnsafe(
          `SELECT id FROM groups WHERE name = $1 AND id != $2::uuid`,
          dto.name,
          id,
        )) as Array<{ id: string }>;
        if (existing.length > 0) {
          throw new ConflictException('A group with this name already exists');
        }
      }

      const updates: string[] = [];
      const params: unknown[] = [];
      let p = 1;
      if (dto.name !== undefined) {
        updates.push(`name = $${p++}`);
        params.push(dto.name);
      }
      if (dto.description !== undefined) {
        updates.push(`description = $${p++}`);
        params.push(dto.description ?? null);
      }
      if (updates.length > 0) {
        updates.push(`updated_at = NOW()`);
        params.push(id);
        await tx.$executeRawUnsafe(
          `UPDATE groups SET ${updates.join(', ')} WHERE id = $${p}::uuid`,
          ...params,
        );
      }
    });

    return this.findOne(tenant, id);
  }

  async delete(tenant: TenantInfo, userId: string, id: string) {
    const existing = await this.findOne(tenant, id);

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'delete',
        'employee_management',
        'groups',
        id,
        existing as object,
        null,
      );
      await tx.$executeRawUnsafe(`DELETE FROM groups WHERE id = $1::uuid`, id);
    });

    return { message: 'Group deleted' };
  }

  async addMembers(tenant: TenantInfo, userId: string, groupId: string, userIds: string[]) {
    await this.findOne(tenant, groupId);

    const added: string[] = [];
    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      for (const uid of userIds) {
        const userExists = (await tx.$queryRawUnsafe(
          `SELECT id FROM users WHERE id = $1::uuid AND status = 'active'`,
          uid,
        )) as Array<{ id: string }>;
        if (userExists.length === 0) {
          throw new BadRequestException(`User ${uid} not found or inactive`);
        }
        const inserted = (await tx.$queryRawUnsafe(
          `INSERT INTO group_members (id, group_id, user_id, added_at)
           VALUES (gen_random_uuid(), $1::uuid, $2::uuid, NOW())
           ON CONFLICT (group_id, user_id) DO NOTHING
           RETURNING user_id`,
          groupId,
          uid,
        )) as Array<{ user_id: string }>;
        if (inserted.length > 0) added.push(inserted[0].user_id);
      }
      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'update',
        'employee_management',
        'groups',
        groupId,
        null,
        { action: 'add_members', userIds } as object,
      );
    });

    const detail = await this.findOne(tenant, groupId);
    return { memberCount: detail.memberCount, added };
  }

  async removeMembers(tenant: TenantInfo, userId: string, groupId: string, userIds: string[]) {
    await this.findOne(tenant, groupId);

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      if (userIds.length === 0) return;
      const placeholders = userIds.map((_, i) => `$${i + 2}::uuid`).join(', ');
      await tx.$executeRawUnsafe(
        `DELETE FROM group_members WHERE group_id = $1::uuid AND user_id IN (${placeholders})`,
        groupId,
        ...userIds,
      );
      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'update',
        'employee_management',
        'groups',
        groupId,
        null,
        { action: 'remove_members', userIds } as object,
      );
    });

    const detail = await this.findOne(tenant, groupId);
    return { memberCount: detail.memberCount };
  }

  async export(tenant: TenantInfo, query: ListGroupsQueryDto, format: 'csv' | 'xlsx' | 'pdf'): Promise<Buffer> {
    const result = await this.list(tenant, { ...query, limit: 10000, page: 1 });
    const data = (result.data as Array<{ name: string; description: string | null; memberCount: number; createdBy: { firstName: string; lastName: string }; createdAt: Date }>).map(
      (row) => ({
        groupName: row.name,
        description: row.description ?? '',
        memberCount: row.memberCount,
        createdBy: `${row.createdBy?.firstName ?? ''} ${row.createdBy?.lastName ?? ''}`.trim(),
        createdDate: row.createdAt ? new Date(row.createdAt).toISOString().slice(0, 10) : '',
      }),
    );
    const columns = [
      { key: 'groupName', header: 'Group Name', width: 25 },
      { key: 'description', header: 'Description', width: 40 },
      { key: 'memberCount', header: 'Member Count', width: 15 },
      { key: 'createdBy', header: 'Created By', width: 25 },
      { key: 'createdDate', header: 'Created Date', width: 15 },
    ];
    if (format === 'csv') return this.exportService.toCsv(data, columns);
    if (format === 'xlsx') return this.exportService.toXlsx(data, columns, { sheetName: 'Groups' });
    return this.exportService.toPdf(data, columns, { title: 'Groups' });
  }
}
