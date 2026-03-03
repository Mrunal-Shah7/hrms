import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExportService } from '../core/export/export.service';
import { TenantInfo } from '../tenant/tenant.interface';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';
import type { ListProjectsQueryDto } from './dto/list-projects-query.dto';
import type { ProjectMemberDto } from './dto/manage-project-members.dto';

type ProjectScope = 'ALL' | 'MANAGED_OR_MEMBER' | 'MEMBER_ONLY';

function getProjectScope(roles: string[]): ProjectScope {
  if (roles.includes('Admin') || roles.includes('HR Admin') || roles.includes('HR Manager')) {
    return 'ALL';
  }
  if (roles.includes('Manager / Team Lead')) {
    return 'MANAGED_OR_MEMBER';
  }
  return 'MEMBER_ONLY';
}

function canEditProject(roles: string[], userId: string, managerId: string): boolean {
  if (roles.includes('Admin')) return true;
  return userId === managerId;
}

function isAdmin(roles: string[]): boolean {
  return roles.includes('Admin');
}

@Injectable()
export class ProjectsService {
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

  private buildScopeCondition(scope: ProjectScope, userId: string): string {
    if (scope === 'ALL') return '1=1';
    if (scope === 'MANAGED_OR_MEMBER') {
      return `(p.manager_id = $${1}::uuid OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $${1}::uuid))`;
    }
    return `EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $${1}::uuid)`;
  }

  async list(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    query: ListProjectsQueryDto,
  ) {
    const scope = getProjectScope(roles);
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const offset = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'name';
    const sortOrder = query.sortOrder ?? 'asc';

    const sortColMap: Record<string, string> = {
      name: 'p.name',
      status: 'p.status',
      createdAt: 'p.created_at',
    };
    const orderCol = sortColMap[sortBy] ?? 'p.name';

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const conditions: string[] = [this.buildScopeCondition(scope, userId)];
      const params: unknown[] = scope !== 'ALL' ? [userId] : [];
      let p = params.length + 1;

      if (query.search?.trim()) {
        const term = `%${query.search.trim()}%`;
        conditions.push(`p.name ILIKE $${p++}`);
        params.push(term);
      }
      if (query.status) {
        conditions.push(`p.status = $${p++}`);
        params.push(query.status);
      }
      if (query.managerId) {
        conditions.push(`p.manager_id = $${p++}`);
        params.push(query.managerId);
      }

      const whereClause = conditions.join(' AND ');

      const countResult = (await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::text as count FROM projects p WHERE ${whereClause}`,
        ...params,
      )) as Array<{ count: string }>;
      const total = parseInt(countResult[0]?.count ?? '0', 10);

      const rows = (await tx.$queryRawUnsafe(
        `SELECT p.id, p.name, p.description, p.manager_id, p.start_date, p.end_date, p.status,
                p.created_at, p.updated_at,
                mgr.first_name AS manager_first_name, mgr.last_name AS manager_last_name,
                (SELECT COUNT(*)::int FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
                (SELECT COUNT(*)::int FROM project_tasks pt WHERE pt.project_id = p.id) AS task_count,
                (SELECT COUNT(*)::int FROM project_tasks pt WHERE pt.project_id = p.id AND pt.status = 'done') AS completed_task_count
         FROM projects p
         LEFT JOIN users mgr ON p.manager_id = mgr.id
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
        manager_id: string;
        start_date: Date | null;
        end_date: Date | null;
        status: string;
        created_at: Date;
        updated_at: Date;
        manager_first_name: string | null;
        manager_last_name: string | null;
        member_count: number;
        task_count: number;
        completed_task_count: number;
      }>;

      const data = rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        status: r.status,
        startDate: r.start_date,
        endDate: r.end_date,
        manager: {
          id: r.manager_id,
          firstName: r.manager_first_name ?? '',
          lastName: r.manager_last_name ?? '',
        },
        memberCount: r.member_count,
        taskCount: r.task_count,
        completedTaskCount: r.completed_task_count,
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
    dto: CreateProjectDto,
  ) {
    const id = crypto.randomUUID();

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const mgrExists = (await tx.$queryRawUnsafe(
        `SELECT id FROM users WHERE id = $1::uuid AND status = 'active'`,
        dto.managerId,
      )) as Array<{ id: string }>;
      if (mgrExists.length === 0) {
        throw new BadRequestException('Project manager not found or inactive');
      }

      if (dto.startDate && dto.endDate && new Date(dto.endDate) < new Date(dto.startDate)) {
        throw new BadRequestException('End date must be after start date');
      }

      await tx.$executeRawUnsafe(
        `INSERT INTO projects (id, name, description, manager_id, budget, start_date, end_date, status, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6::date, $7::date, 'active', NOW(), NOW())`,
        id,
        dto.name,
        dto.description ?? null,
        dto.managerId,
        dto.budget ?? null,
        dto.startDate ?? null,
        dto.endDate ?? null,
      );

      await tx.$executeRawUnsafe(
        `INSERT INTO project_members (id, project_id, user_id, role, added_at)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'manager', NOW())
         ON CONFLICT (project_id, user_id) DO NOTHING`,
        id,
        dto.managerId,
      );

      if (dto.memberIds && dto.memberIds.length > 0) {
        for (const uid of dto.memberIds) {
          if (uid === dto.managerId) continue;
          const userExists = (await tx.$queryRawUnsafe(
            `SELECT id FROM users WHERE id = $1::uuid AND status = 'active'`,
            uid,
          )) as Array<{ id: string }>;
          if (userExists.length === 0) {
            throw new BadRequestException(`User ${uid} not found or inactive`);
          }
          await tx.$executeRawUnsafe(
            `INSERT INTO project_members (id, project_id, user_id, role, added_at)
             VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'member', NOW())
             ON CONFLICT (project_id, user_id) DO NOTHING`,
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
        'projects',
        id,
        null,
        dto as object,
      );
    });

    return this.findOne(tenant, userId, roles, id);
  }

  async findOne(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    id: string,
  ) {
    const scope = getProjectScope(roles);
    const scopeCond = this.buildScopeCondition(scope, userId);

    const rows = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      let sql: string;
      let params: unknown[];
      if (scope === 'ALL') {
        sql = `SELECT p.id, p.name, p.description, p.manager_id, p.budget, p.start_date, p.end_date, p.status,
                p.created_at, p.updated_at,
                mgr.employee_id AS mgr_emp_id, mgr.first_name AS mgr_first_name, mgr.last_name AS mgr_last_name,
                mgr.email AS mgr_email, mgr.photo_url AS mgr_photo_url
         FROM projects p
         LEFT JOIN users mgr ON p.manager_id = mgr.id
         WHERE p.id = $1::uuid`;
        params = [id];
      } else {
        sql = `SELECT p.id, p.name, p.description, p.manager_id, p.budget, p.start_date, p.end_date, p.status,
                p.created_at, p.updated_at,
                mgr.employee_id AS mgr_emp_id, mgr.first_name AS mgr_first_name, mgr.last_name AS mgr_last_name,
                mgr.email AS mgr_email, mgr.photo_url AS mgr_photo_url
         FROM projects p
         LEFT JOIN users mgr ON p.manager_id = mgr.id
         WHERE p.id = $2::uuid AND ${scopeCond}`;
        params = [userId, id];
      }
      return tx.$queryRawUnsafe(sql, ...params);
    })) as Array<{
      id: string;
      name: string;
      description: string | null;
      manager_id: string;
      budget: number | null;
      start_date: Date | null;
      end_date: Date | null;
      status: string;
      created_at: Date;
      updated_at: Date;
      mgr_emp_id: string | null;
      mgr_first_name: string | null;
      mgr_last_name: string | null;
      mgr_email: string | null;
      mgr_photo_url: string | null;
    }>;

    if (!rows || rows.length === 0) {
      throw new NotFoundException('Project not found');
    }
    const r = rows[0];

    const includeBudget = isAdmin(roles) || r.manager_id === userId;

    const members = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe(
        `SELECT pm.id, pm.role, pm.added_at,
                u.id AS user_id, u.employee_id, u.first_name, u.last_name, u.email, u.photo_url,
                d.name AS department_name
         FROM project_members pm
         JOIN users u ON pm.user_id = u.id
         LEFT JOIN employee_profiles ep ON u.id = ep.user_id
         LEFT JOIN departments d ON ep.department_id = d.id
         WHERE pm.project_id = $1::uuid
         ORDER BY pm.role DESC, u.first_name ASC`,
        id,
      );
    })) as Array<{
      id: string;
      role: string | null;
      added_at: Date;
      user_id: string;
      employee_id: string | null;
      first_name: string;
      last_name: string;
      email: string;
      photo_url: string | null;
      department_name: string | null;
    }>;

    const taskSummary = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const rows2 = (await tx.$queryRawUnsafe(
        `SELECT status, COUNT(*)::int as cnt FROM project_tasks WHERE project_id = $1::uuid GROUP BY status`,
        id,
      )) as Array<{ status: string; cnt: number }>;
      const total = rows2.reduce((s, x) => s + x.cnt, 0);
      const todo = rows2.find((x) => x.status === 'todo')?.cnt ?? 0;
      const inProgress = rows2.find((x) => x.status === 'in_progress')?.cnt ?? 0;
      const done = rows2.find((x) => x.status === 'done')?.cnt ?? 0;
      return { total, todo, inProgress, done };
    }));

    const result: Record<string, unknown> = {
      id: r.id,
      name: r.name,
      description: r.description,
      status: r.status,
      startDate: r.start_date,
      endDate: r.end_date,
      manager: {
        id: r.manager_id,
        employeeId: r.mgr_emp_id,
        firstName: r.mgr_first_name ?? '',
        lastName: r.mgr_last_name ?? '',
        email: r.mgr_email ?? '',
        photoUrl: r.mgr_photo_url,
      },
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
        },
        role: m.role ?? 'member',
        addedAt: m.added_at,
      })),
      taskSummary,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };

    if (includeBudget) {
      result.budget = r.budget;
    }

    return result;
  }

  async update(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    id: string,
    dto: UpdateProjectDto,
  ) {
    const existing = await this.findOne(tenant, userId, roles, id) as Record<string, unknown>;
    const managerId = (existing.manager as { id: string })?.id ?? '';
    if (!canEditProject(roles, userId, managerId)) {
      throw new ForbiddenException('Only the project manager or an admin can edit this project');
    }

    if (dto.budget !== undefined && !isAdmin(roles)) {
      throw new ForbiddenException('Only administrators can modify project budgets');
    }

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      if (dto.managerId && dto.managerId !== managerId) {
        const mgrExists = (await tx.$queryRawUnsafe(
          `SELECT id FROM users WHERE id = $1::uuid AND status = 'active'`,
          dto.managerId,
        )) as Array<{ id: string }>;
        if (mgrExists.length === 0) {
          throw new BadRequestException('Project manager not found or inactive');
        }
      }

      if (dto.startDate && dto.endDate && new Date(dto.endDate) < new Date(dto.startDate)) {
        throw new BadRequestException('End date must be after start date');
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
      if (dto.managerId !== undefined) {
        updates.push(`manager_id = $${p++}`);
        params.push(dto.managerId);
      }
      if (dto.budget !== undefined && isAdmin(roles)) {
        updates.push(`budget = $${p++}`);
        params.push(dto.budget ?? null);
      }
      if (dto.startDate !== undefined) {
        updates.push(`start_date = $${p++}`);
        params.push(dto.startDate ?? null);
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
        await tx.$executeRawUnsafe(
          `UPDATE projects SET ${updates.join(', ')} WHERE id = $${p}::uuid`,
          ...params,
        );
        await this.insertAuditLog(
          tenant.schemaName,
          userId,
          'update',
          'employee_management',
          'projects',
          id,
          existing as object,
          { ...existing, ...dto } as object,
        );
      }
    });

    return this.findOne(tenant, userId, roles, id);
  }

  async delete(tenant: TenantInfo, userId: string, roles: string[], id: string) {
    if (!isAdmin(roles)) {
      throw new ForbiddenException('Only administrators can delete projects');
    }

    const existing = await this.findOne(tenant, userId, roles, id);

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'delete',
        'employee_management',
        'projects',
        id,
        existing as object,
        null,
      );
      await tx.$executeRawUnsafe(`DELETE FROM projects WHERE id = $1::uuid`, id);
    });

    return { message: 'Project deleted' };
  }

  async addMembers(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    projectId: string,
    members: ProjectMemberDto[],
  ) {
    const project = await this.findOne(tenant, userId, roles, projectId) as Record<string, unknown>;
    const managerId = (project.manager as { id: string })?.id;
    if (!canEditProject(roles, userId, managerId)) {
      throw new ForbiddenException('Only the project manager or an admin can add members');
    }

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      for (const m of members) {
        const userExists = (await tx.$queryRawUnsafe(
          `SELECT id FROM users WHERE id = $1::uuid AND status = 'active'`,
          m.userId,
        )) as Array<{ id: string }>;
        if (userExists.length === 0) {
          throw new BadRequestException(`User ${m.userId} not found or inactive`);
        }
        await tx.$executeRawUnsafe(
          `INSERT INTO project_members (id, project_id, user_id, role, added_at)
           VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, NOW())
           ON CONFLICT (project_id, user_id) DO NOTHING`,
          projectId,
          m.userId,
          m.role ?? 'member',
        );
      }
    });

    return this.findOne(tenant, userId, roles, projectId);
  }

  async removeMembers(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    projectId: string,
    userIds: string[],
  ) {
    const project = await this.findOne(tenant, userId, roles, projectId) as Record<string, unknown>;
    const managerId = (project.manager as { id: string })?.id;
    if (!canEditProject(roles, userId, managerId)) {
      throw new ForbiddenException('Only the project manager or an admin can remove members');
    }

    if (userIds.includes(managerId)) {
      throw new BadRequestException(
        'Cannot remove the project manager. Transfer management first.',
      );
    }

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      if (userIds.length > 0) {
        const placeholders = userIds.map((_, i) => `$${i + 2}::uuid`).join(', ');
        await tx.$executeRawUnsafe(
          `DELETE FROM project_members WHERE project_id = $1::uuid AND user_id IN (${placeholders})`,
          projectId,
          ...userIds,
        );
      }
    });

    return this.findOne(tenant, userId, roles, projectId);
  }

  async export(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    query: ListProjectsQueryDto,
    format: 'csv' | 'xlsx' | 'pdf',
  ): Promise<Buffer> {
    const scope = getProjectScope(roles);
    const sortBy = query.sortBy ?? 'name';
    const sortOrder = query.sortOrder ?? 'asc';
    const sortColMap: Record<string, string> = {
      name: 'p.name',
      status: 'p.status',
      createdAt: 'p.created_at',
    };
    const orderCol = sortColMap[sortBy] ?? 'p.name';

    const rows = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const conditions: string[] = [this.buildScopeCondition(scope, userId)];
      const params: unknown[] = scope !== 'ALL' ? [userId] : [];
      let p = params.length + 1;
      if (query.search?.trim()) {
        conditions.push(`p.name ILIKE $${p++}`);
        params.push(`%${query.search.trim()}%`);
      }
      if (query.status) {
        conditions.push(`p.status = $${p++}`);
        params.push(query.status);
      }
      if (query.managerId) {
        conditions.push(`p.manager_id = $${p++}`);
        params.push(query.managerId);
      }
      const whereClause = conditions.join(' AND ');
      return tx.$queryRawUnsafe(
        `SELECT p.id, p.name, p.description, p.manager_id, p.budget, p.start_date, p.end_date, p.status,
                mgr.first_name AS manager_first_name, mgr.last_name AS manager_last_name,
                (SELECT COUNT(*)::int FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
                (SELECT COUNT(*)::int FROM project_tasks pt WHERE pt.project_id = p.id) AS task_count,
                (SELECT COUNT(*)::int FROM project_tasks pt WHERE pt.project_id = p.id AND pt.status = 'done') AS completed_task_count
         FROM projects p
         LEFT JOIN users mgr ON p.manager_id = mgr.id
         WHERE ${whereClause}
         ORDER BY ${orderCol} ${sortOrder}
         LIMIT 10000`,
        ...params,
      );
    })) as Array<{
      name: string;
      description: string | null;
      manager_id: string;
      budget: number | null;
      start_date: Date | null;
      end_date: Date | null;
      status: string;
      manager_first_name: string | null;
      manager_last_name: string | null;
      member_count: number;
      task_count: number;
      completed_task_count: number;
    }>;

    const adminOrShowBudget = isAdmin(roles);
    const data = rows.map((r) => {
      const showBudget = adminOrShowBudget || r.manager_id === userId;
      const row: Record<string, unknown> = {
        projectName: r.name,
        description: (r.description ?? '').length > 200 ? `${(r.description ?? '').slice(0, 200)}...` : (r.description ?? ''),
        manager: `${r.manager_first_name ?? ''} ${r.manager_last_name ?? ''}`.trim(),
        status: r.status,
        members: r.member_count,
        tasksTotal: r.task_count,
        tasksCompleted: r.completed_task_count,
        startDate: r.start_date ? new Date(r.start_date).toISOString().slice(0, 10) : '',
        endDate: r.end_date ? new Date(r.end_date).toISOString().slice(0, 10) : '',
      };
      if (showBudget && r.budget != null) {
        row.budget = r.budget;
      }
      return row;
    });

    const baseColumns = [
      { key: 'projectName', header: 'Project Name', width: 25 },
      { key: 'description', header: 'Description', width: 40 },
      { key: 'manager', header: 'Manager', width: 25 },
      { key: 'status', header: 'Status', width: 12 },
      { key: 'members', header: 'Members', width: 10 },
      { key: 'tasksTotal', header: 'Tasks (Total)', width: 12 },
      { key: 'tasksCompleted', header: 'Tasks (Completed)', width: 16 },
      { key: 'startDate', header: 'Start Date', width: 12 },
      { key: 'endDate', header: 'End Date', width: 12 },
    ];
    const columns = adminOrShowBudget || data.some((r) => 'budget' in r)
      ? [...baseColumns, { key: 'budget', header: 'Budget', width: 15 }]
      : baseColumns;

    if (format === 'csv') return this.exportService.toCsv(data, columns);
    if (format === 'xlsx') return this.exportService.toXlsx(data, columns, { sheetName: 'Projects' });
    return this.exportService.toPdf(data, columns, { title: 'Projects' });
  }
}
