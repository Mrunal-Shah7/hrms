import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExportService } from '../../core/export/export.service';
import { NotificationService } from '../../core/notification/notification.service';
import { TenantInfo } from '../../tenant/tenant.interface';
import type { CreateTaskDto } from './dto/create-task.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';
import type { ListTasksQueryDto } from './dto/list-tasks-query.dto';

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

function canEditTask(roles: string[], userId: string, managerId: string, myProjectRole: string | null): boolean {
  if (roles.includes('Admin')) return true;
  if (userId === managerId) return true;
  return myProjectRole === 'lead' || myProjectRole === 'manager';
}

function isProjectMemberOrManager(
  userId: string,
  managerId: string,
  memberRows: Array<{ user_id: string; role: string | null }>,
): boolean {
  if (userId === managerId) return true;
  return memberRows.some((m) => m.user_id === userId);
}

@Injectable()
export class TasksService {
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
    await this.prisma.withTenantSchema(schemaName, async (tx: PrismaClient) => {
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

  private async getProjectWithAccess(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    projectId: string,
  ): Promise<{
    id: string;
    name: string;
    manager_id: string;
    managerId: string;
    memberRows: Array<{ user_id: string; role: string | null }>;
  }> {
    const scope = getProjectScope(roles);
    let whereClause: string;
    const params: unknown[] = [projectId];
    if (scope === 'ALL') {
      whereClause = 'p.id = $1::uuid';
    } else if (scope === 'MANAGED_OR_MEMBER') {
      whereClause = `p.id = $1::uuid AND (p.manager_id = $2::uuid OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2::uuid))`;
      params.push(userId);
    } else {
      whereClause = `p.id = $1::uuid AND EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2::uuid)`;
      params.push(userId);
    }

    const rows = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx: PrismaClient) => {
      return tx.$queryRawUnsafe(
        `SELECT p.id, p.name, p.manager_id FROM projects p WHERE ${whereClause}`,
        ...params,
      );
    })) as Array<{ id: string; name: string; manager_id: string }>;

    if (!rows || rows.length === 0) {
      throw new NotFoundException('Project not found');
    }

    const project = rows[0];
    const memberRows = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx: PrismaClient) => {
      return tx.$queryRawUnsafe(
        `SELECT user_id, role FROM project_members WHERE project_id = $1::uuid`,
        projectId,
      );
    })) as Array<{ user_id: string; role: string | null }>;

    return {
      id: project.id,
      name: project.name,
      manager_id: project.manager_id,
      managerId: project.manager_id,
      memberRows,
    };
  }

  async list(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    projectId: string,
    query: ListTasksQueryDto,
  ) {
    await this.getProjectWithAccess(tenant, userId, roles, projectId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const sortColMap: Record<string, string> = {
      createdAt: 'pt.created_at',
      updatedAt: 'pt.updated_at',
      dueDate: 'pt.due_date',
      priority: 'pt.priority',
      status: 'pt.status',
      title: 'pt.title',
    };
    const orderCol = sortColMap[sortBy] ?? 'pt.created_at';

    const conditions: string[] = ['pt.project_id = $1::uuid'];
    const params: unknown[] = [projectId];
    let p = 2;
    if (query.status) {
      conditions.push(`pt.status = $${p++}`);
      params.push(query.status);
    }
    if (query.priority) {
      conditions.push(`pt.priority = $${p++}`);
      params.push(query.priority);
    }
    if (query.assigneeId) {
      conditions.push(`pt.assignee_id = $${p++}`);
      params.push(query.assigneeId);
    }
    const whereClause = conditions.join(' AND ');

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx: PrismaClient) => {
      const countResult = (await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::text as count FROM project_tasks pt WHERE ${whereClause}`,
        ...params,
      )) as Array<{ count: string }>;
      const total = parseInt(countResult[0]?.count ?? '0', 10);

      const rows = (await tx.$queryRawUnsafe(
        `SELECT pt.id, pt.title, pt.description, pt.status, pt.priority, pt.due_date,
                pt.created_at, pt.updated_at,
                u.id AS assignee_id, u.first_name AS assignee_first_name,
                u.last_name AS assignee_last_name, u.photo_url AS assignee_photo_url
         FROM project_tasks pt
         LEFT JOIN users u ON pt.assignee_id = u.id
         WHERE ${whereClause}
         ORDER BY ${orderCol} ${sortOrder}
         LIMIT $${p} OFFSET $${p + 1}`,
        ...params,
        limit,
        offset,
      )) as Array<{
        id: string;
        title: string;
        description: string | null;
        status: string;
        priority: string | null;
        due_date: Date | null;
        created_at: Date;
        updated_at: Date;
        assignee_id: string | null;
        assignee_first_name: string | null;
        assignee_last_name: string | null;
        assignee_photo_url: string | null;
      }>;

      const data = rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        status: r.status,
        priority: r.priority ?? 'medium',
        dueDate: r.due_date,
        assignee: r.assignee_id
          ? {
              id: r.assignee_id,
              firstName: r.assignee_first_name ?? '',
              lastName: r.assignee_last_name ?? '',
              photoUrl: r.assignee_photo_url,
            }
          : null,
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
    projectId: string,
    dto: CreateTaskDto,
  ) {
    const project = await this.getProjectWithAccess(tenant, userId, roles, projectId);

    if (dto.assigneeId) {
      const isMember = isProjectMemberOrManager(
        dto.assigneeId,
        project.managerId,
        project.memberRows,
      );
      if (!isMember) {
        throw new BadRequestException('Assignee must be a member of this project');
      }
      const userExists = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx: PrismaClient) => {
        return tx.$queryRawUnsafe(
          `SELECT id FROM users WHERE id = $1::uuid AND status = 'active'`,
          dto.assigneeId,
        );
      })) as Array<{ id: string }>;
      if (userExists.length === 0) {
        throw new BadRequestException('Assignee not found or inactive');
      }
    }

    const myRole = project.memberRows.find((m) => m.user_id === userId)?.role ?? null;
    const canEdit = canEditTask(roles, userId, project.managerId, myRole);
    if (!canEdit) {
      throw new ForbiddenException('Only project manager, lead, or admin can create tasks');
    }

    const taskId = crypto.randomUUID();

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx: PrismaClient) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO project_tasks (id, project_id, title, description, assignee_id, status, priority, due_date, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7, $8::date, NOW(), NOW())`,
        taskId,
        projectId,
        dto.title,
        dto.description ?? null,
        dto.assigneeId ?? null,
        dto.status ?? 'todo',
        dto.priority ?? 'medium',
        dto.dueDate ?? null,
      );
    });

    await this.insertAuditLog(
      tenant.schemaName,
      userId,
      'create',
      'employee_management',
      'projects',
      taskId,
      null,
      { projectId, ...dto } as object,
    );

    if (dto.assigneeId) {
      await this.notificationService.create(
        dto.assigneeId,
        'task_assigned',
        'New task assigned',
        `You have been assigned the task '${dto.title}' in project '${project.name}'`,
        tenant.schemaName,
        {
          projectId,
          taskId,
          projectName: project.name,
          taskTitle: dto.title,
        },
      );
    }

    const result = await this.list(tenant, userId, roles, projectId, {
      page: 1,
      limit: 100,
    });
    const task = (result as { data: Array<{ id: string }> }).data.find((t) => t.id === taskId);
    if (task) return task;

    const rows = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx: PrismaClient) => {
      return tx.$queryRawUnsafe(
        `SELECT pt.id, pt.title, pt.description, pt.status, pt.priority, pt.due_date,
                pt.created_at, pt.updated_at,
                u.id AS assignee_id, u.first_name AS assignee_first_name,
                u.last_name AS assignee_last_name, u.photo_url AS assignee_photo_url
         FROM project_tasks pt
         LEFT JOIN users u ON pt.assignee_id = u.id
         WHERE pt.id = $1::uuid`,
        taskId,
      );
    })) as Array<{
      id: string;
      title: string;
      description: string | null;
      status: string;
      priority: string | null;
      due_date: Date | null;
      created_at: Date;
      updated_at: Date;
      assignee_id: string | null;
      assignee_first_name: string | null;
      assignee_last_name: string | null;
      assignee_photo_url: string | null;
    }>;

    if (rows.length === 0) throw new NotFoundException('Task not found');
    const r = rows[0];
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      priority: r.priority ?? 'medium',
      dueDate: r.due_date,
      assignee: r.assignee_id
        ? {
            id: r.assignee_id,
            firstName: r.assignee_first_name ?? '',
            lastName: r.assignee_last_name ?? '',
            photoUrl: r.assignee_photo_url,
          }
        : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async update(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    projectId: string,
    taskId: string,
    dto: UpdateTaskDto,
  ) {
    const project = await this.getProjectWithAccess(tenant, userId, roles, projectId);

    const taskRows = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx: PrismaClient) => {
      return tx.$queryRawUnsafe(
        `SELECT id, assignee_id, status, title FROM project_tasks WHERE project_id = $1::uuid AND id = $2::uuid`,
        projectId,
        taskId,
      );
    })) as Array<{ id: string; assignee_id: string | null; status: string; title: string }>;

    if (!taskRows || taskRows.length === 0) {
      throw new NotFoundException('Task not found');
    }
    const existing = taskRows[0];

    const isAssignee = existing.assignee_id === userId;
    const myRole = project.memberRows.find((m) => m.user_id === userId)?.role ?? null;
    const canFullEdit = canEditTask(roles, userId, project.managerId, myRole);

    if (isAssignee && !canFullEdit) {
      const allowedFields = ['status'];
      const attemptedChanges = Object.keys(dto).filter((k) => dto[k as keyof UpdateTaskDto] !== undefined);
      const illegalChanges = attemptedChanges.filter((k) => !allowedFields.includes(k));
      if (illegalChanges.length > 0) {
        throw new ForbiddenException('You can only update the task status');
      }
    }

    if (dto.assigneeId !== undefined && dto.assigneeId !== existing.assignee_id) {
      const isMember = isProjectMemberOrManager(
        dto.assigneeId,
        project.managerId,
        project.memberRows,
      );
      if (!isMember) {
        throw new BadRequestException('Assignee must be a member of this project');
      }
      const userExists = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx: PrismaClient) => {
        return tx.$queryRawUnsafe(
          `SELECT id FROM users WHERE id = $1::uuid AND status = 'active'`,
          dto.assigneeId,
        );
      })) as Array<{ id: string }>;
      if (userExists.length === 0) {
        throw new BadRequestException('Assignee not found or inactive');
      }
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    if (dto.title !== undefined) {
      updates.push(`title = $${p++}`);
      params.push(dto.title);
    }
    if (dto.description !== undefined) {
      updates.push(`description = $${p++}`);
      params.push(dto.description ?? null);
    }
    if (dto.assigneeId !== undefined) {
      updates.push(`assignee_id = $${p++}`);
      params.push(dto.assigneeId ?? null);
    }
    if (dto.status !== undefined) {
      updates.push(`status = $${p++}`);
      params.push(dto.status);
    }
    if (dto.priority !== undefined) {
      updates.push(`priority = $${p++}`);
      params.push(dto.priority);
    }
    if (dto.dueDate !== undefined) {
      updates.push(`due_date = $${p++}`);
      params.push(dto.dueDate ?? null);
    }

    if (updates.length === 0) {
      const result = await this.list(tenant, userId, roles, projectId, { page: 1, limit: 100 });
      const task = (result as { data: Array<{ id: string }> }).data.find((t) => t.id === taskId);
      if (task) return task;
    }

    if (updates.length > 0) {
      updates.push(`updated_at = NOW()`);
      params.push(projectId, taskId);
      await this.prisma.withTenantSchema(tenant.schemaName, async (tx: PrismaClient) => {
        await tx.$executeRawUnsafe(
          `UPDATE project_tasks SET ${updates.join(', ')} WHERE project_id = $${p++}::uuid AND id = $${p}::uuid`,
          ...params,
        );
      });
      const oldVal = {
        title: existing.title,
        status: existing.status,
        assigneeId: existing.assignee_id,
      };
      const newVal = {
        ...oldVal,
        ...dto,
        assigneeId: dto.assigneeId !== undefined ? dto.assigneeId : existing.assignee_id,
      };
      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'update',
        'employee_management',
        'projects',
        taskId,
        oldVal as object,
        newVal as object,
      );
    }

    if (dto.assigneeId !== undefined && dto.assigneeId !== existing.assignee_id && dto.assigneeId) {
      const taskRows2 = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx: PrismaClient) => {
        return tx.$queryRawUnsafe(
          `SELECT title FROM project_tasks WHERE id = $1::uuid`,
          taskId,
        );
      })) as Array<{ title: string }>;
      const taskTitle = taskRows2[0]?.title ?? existing.title;

      await this.notificationService.create(
        dto.assigneeId,
        'task_assigned',
        'New task assigned',
        `You have been assigned the task '${taskTitle}' in project '${project.name}'`,
        tenant.schemaName,
        {
          projectId,
          taskId,
          projectName: project.name,
          taskTitle,
        },
      );
    }

    if (dto.status !== undefined && dto.status !== existing.status) {
      const taskRows2 = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx: PrismaClient) => {
        return tx.$queryRawUnsafe(
          `SELECT title FROM project_tasks WHERE id = $1::uuid`,
          taskId,
        );
      })) as Array<{ title: string }>;
      const taskTitle = taskRows2[0]?.title ?? existing.title;

      await this.notificationService.create(
        project.managerId,
        'task_status_updated',
        'Task status updated',
        `Task '${taskTitle}' in project '${project.name}' changed to '${dto.status}'`,
        tenant.schemaName,
        {
          projectId,
          taskId,
          projectName: project.name,
          taskTitle,
          newStatus: dto.status,
        },
      );
    }

    const result = await this.list(tenant, userId, roles, projectId, { page: 1, limit: 100 });
    const task = (result as { data: Array<{ id: string }> }).data.find((t) => t.id === taskId);
    if (task) return task;

    const rows = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx: PrismaClient) => {
      return tx.$queryRawUnsafe(
        `SELECT pt.id, pt.title, pt.description, pt.status, pt.priority, pt.due_date,
                pt.created_at, pt.updated_at,
                u.id AS assignee_id, u.first_name AS assignee_first_name,
                u.last_name AS assignee_last_name, u.photo_url AS assignee_photo_url
         FROM project_tasks pt
         LEFT JOIN users u ON pt.assignee_id = u.id
         WHERE pt.id = $1::uuid`,
        taskId,
      );
    })) as Array<{
      id: string;
      title: string;
      description: string | null;
      status: string;
      priority: string | null;
      due_date: Date | null;
      created_at: Date;
      updated_at: Date;
      assignee_id: string | null;
      assignee_first_name: string | null;
      assignee_last_name: string | null;
      assignee_photo_url: string | null;
    }>;

    if (rows.length === 0) throw new NotFoundException('Task not found');
    const r = rows[0];
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      priority: r.priority ?? 'medium',
      dueDate: r.due_date,
      assignee: r.assignee_id
        ? {
            id: r.assignee_id,
            firstName: r.assignee_first_name ?? '',
            lastName: r.assignee_last_name ?? '',
            photoUrl: r.assignee_photo_url,
          }
        : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async delete(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    projectId: string,
    taskId: string,
  ) {
    const project = await this.getProjectWithAccess(tenant, userId, roles, projectId);

    const myRole = project.memberRows.find((m) => m.user_id === userId)?.role ?? null;
    const canDelete = canEditTask(roles, userId, project.managerId, myRole);
    if (!canDelete) {
      throw new ForbiddenException('Only project manager, lead, or admin can delete tasks');
    }

    const result = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx: PrismaClient) => {
      return tx.$executeRawUnsafe(
        `DELETE FROM project_tasks WHERE project_id = $1::uuid AND id = $2::uuid`,
        projectId,
        taskId,
      );
    }));

    if (result === 0) {
      throw new NotFoundException('Task not found');
    }

    return { message: 'Task deleted' };
  }

  async export(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    projectId: string,
    query: ListTasksQueryDto,
    format: 'csv' | 'xlsx' | 'pdf',
  ): Promise<{ buffer: Buffer; projectName: string }> {
    const project = await this.getProjectWithAccess(tenant, userId, roles, projectId);

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';
    const sortColMap: Record<string, string> = {
      createdAt: 'pt.created_at',
      updatedAt: 'pt.updated_at',
      dueDate: 'pt.due_date',
      priority: 'pt.priority',
      status: 'pt.status',
      title: 'pt.title',
    };
    const orderCol = sortColMap[sortBy] ?? 'pt.created_at';

    const conditions: string[] = ['pt.project_id = $1::uuid'];
    const params: unknown[] = [projectId];
    let p = 2;
    if (query.status) {
      conditions.push(`pt.status = $${p++}`);
      params.push(query.status);
    }
    if (query.priority) {
      conditions.push(`pt.priority = $${p++}`);
      params.push(query.priority);
    }
    if (query.assigneeId) {
      conditions.push(`pt.assignee_id = $${p++}`);
      params.push(query.assigneeId);
    }
    const whereClause = conditions.join(' AND ');

    const rows = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx: PrismaClient) => {
      return tx.$queryRawUnsafe(
        `SELECT pt.title, pt.description, pt.status, pt.priority, pt.due_date, pt.created_at,
                u.first_name AS assignee_first_name, u.last_name AS assignee_last_name
         FROM project_tasks pt
         LEFT JOIN users u ON pt.assignee_id = u.id
         WHERE ${whereClause}
         ORDER BY ${orderCol} ${sortOrder}
         LIMIT 10000`,
        ...params,
      );
    })) as Array<{
      title: string;
      description: string | null;
      status: string;
      priority: string | null;
      due_date: Date | null;
      created_at: Date;
      assignee_first_name: string | null;
      assignee_last_name: string | null;
    }>;

    const data = rows.map((r) => ({
      title: r.title,
      description: r.description ?? '',
      assignee: `${r.assignee_first_name ?? ''} ${r.assignee_last_name ?? ''}`.trim() || '—',
      status: r.status,
      priority: r.priority ?? 'medium',
      dueDate: r.due_date ? new Date(r.due_date).toISOString().slice(0, 10) : '',
      createdDate: r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '',
    }));

    const columns = [
      { key: 'title', header: 'Title', width: 30 },
      { key: 'description', header: 'Description', width: 40 },
      { key: 'assignee', header: 'Assignee', width: 25 },
      { key: 'status', header: 'Status', width: 12 },
      { key: 'priority', header: 'Priority', width: 10 },
      { key: 'dueDate', header: 'Due Date', width: 12 },
      { key: 'createdDate', header: 'Created Date', width: 12 },
    ];

    let buffer: Buffer;
    if (format === 'csv') buffer = await this.exportService.toCsv(data, columns);
    else if (format === 'xlsx') buffer = await this.exportService.toXlsx(data, columns, { sheetName: 'Tasks' });
    else buffer = await this.exportService.toPdf(data, columns, { title: 'Tasks' });

    return { buffer, projectName: project.name };
  }
}
