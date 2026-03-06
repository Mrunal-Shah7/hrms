import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExportService } from '../../core/export/export.service';
import { NotificationService } from '../../core/notification/notification.service';
import type { TenantInfo } from '../../tenant/tenant.interface';
import type { CreateGoalDto } from './dto/create-goal.dto';
import type { UpdateGoalDto } from './dto/update-goal.dto';
import type { UpdateProgressDto } from './dto/update-progress.dto';
import type { ColumnDef } from '../../core/export/export.service';

type TimeFilter = 'all' | 'this_week' | 'last_week' | 'this_month' | 'last_month';

function getTimeFilterBounds(filter: TimeFilter): { start: Date; end: Date } | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (filter === 'all') return null;
  let start: Date;
  let end: Date;
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() + mondayOffset);
  const thisSunday = new Date(thisMonday);
  thisSunday.setDate(thisMonday.getDate() + 6);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  switch (filter) {
    case 'this_week':
      start = thisMonday;
      end = thisSunday;
      break;
    case 'last_week':
      start = lastMonday;
      end = lastSunday;
      break;
    case 'this_month':
      start = firstOfMonth;
      end = lastOfMonth;
      break;
    case 'last_month':
      start = firstOfLastMonth;
      end = lastOfLastMonth;
      break;
    default:
      return null;
  }
  return { start, end };
}

@Injectable()
export class GoalsService {
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

  private isAdminOrHr(roles: string[]): boolean {
    return (
      roles.includes('Admin') ||
      roles.includes('HR Admin') ||
      roles.includes('HR Manager')
    );
  }

  private async buildGoalVisibilityCondition(
    schemaName: string,
    userId: string,
    roles: string[],
    tx: unknown,
  ): Promise<{ sql: string; params: unknown[] }> {
    const client = tx as { $queryRawUnsafe: (sql: string, ...args: unknown[]) => Promise<unknown> };
    if (this.isAdminOrHr(roles)) {
      return { sql: '1=1', params: [] };
    }
    if (roles.includes('Manager / Team Lead')) {
      const reporteeIds = (await client.$queryRawUnsafe(
        `SELECT user_id::text FROM employee_profiles WHERE reports_to = $1`,
        userId,
      )) as Array<{ user_id: string }>;
      const reporteeList = reporteeIds.map((r) => r.user_id);
      const groupRows = (await client.$queryRawUnsafe(
        `SELECT id::text FROM groups WHERE created_by = $1
         UNION SELECT group_id::text FROM group_members WHERE user_id = $1`,
        userId,
      )) as Array<{ id: string }>;
      const gIds = [...new Set(groupRows.map((g) => g.id))];
      const projectRows = (await client.$queryRawUnsafe(
        `SELECT id::text FROM projects WHERE manager_id = $1
         UNION SELECT project_id::text FROM project_members WHERE user_id = $1`,
        userId,
      )) as Array<{ id: string }>;
      const pIds = [...new Set(projectRows.map((p) => p.id))];
      const conditions: string[] = [
        `g.created_by_id = $1::uuid`,
        `(g.assigned_to_type = 'user' AND g.assigned_to_id = $1::uuid)`,
      ];
      const params: unknown[] = [userId];
      let p = 2;
      if (reporteeList.length > 0) {
        conditions.push(
          `(g.assigned_to_type = 'user' AND g.assigned_to_id = ANY($${p}::uuid[]))`,
        );
        params.push(reporteeList);
        p++;
      }
      if (gIds.length > 0) {
        conditions.push(
          `(g.assigned_to_type = 'group' AND g.assigned_to_id = ANY($${p}::uuid[]))`,
        );
        params.push(gIds);
        p++;
      }
      if (pIds.length > 0) {
        conditions.push(
          `(g.assigned_to_type = 'project' AND g.assigned_to_id = ANY($${p}::uuid[]))`,
        );
        params.push(pIds);
      }
      return { sql: `(${conditions.join(' OR ')})`, params };
    }
    const groupIds = (await client.$queryRawUnsafe(
      `SELECT group_id::text FROM group_members WHERE user_id = $1`,
      userId,
    )) as Array<{ group_id: string }>;
    const projectIds = (await client.$queryRawUnsafe(
      `SELECT project_id::text FROM project_members WHERE user_id = $1`,
      userId,
    )) as Array<{ project_id: string }>;
    const conditions: string[] = [
      `(g.assigned_to_type = 'user' AND g.assigned_to_id = $1::uuid)`,
    ];
    const params: unknown[] = [userId];
    let p = 2;
    if (groupIds.length > 0) {
      conditions.push(
        `(g.assigned_to_type = 'group' AND g.assigned_to_id = ANY($${p}::uuid[]))`,
      );
      params.push(groupIds.map((g) => g.group_id));
      p++;
    }
    if (projectIds.length > 0) {
      conditions.push(
        `(g.assigned_to_type = 'project' AND g.assigned_to_id = ANY($${p}::uuid[]))`,
      );
      params.push(projectIds.map((p) => p.project_id));
    }
    return { sql: `(${conditions.join(' OR ')})`, params };
  }

  private resolveAssigneeName(
    assignedToType: string,
    assignedToId: string,
    row: {
      assignee_first_name?: string | null;
      assignee_last_name?: string | null;
      group_name?: string | null;
      project_name?: string | null;
    },
  ): string {
    if (assignedToType === 'user' && row.assignee_first_name != null) {
      return [row.assignee_first_name, row.assignee_last_name].filter(Boolean).join(' ') || '—';
    }
    if (assignedToType === 'group' && row.group_name != null) return row.group_name;
    if (assignedToType === 'project' && row.project_name != null) return row.project_name;
    return '—';
  }

  async list(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    query: {
      page?: number;
      limit?: number;
      assignedToType?: string;
      status?: string;
      priority?: string;
      filter?: TimeFilter;
      sortBy?: string;
      sortOrder?: string;
    },
  ) {
    const schemaName = tenant.schemaName;
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 10, 100);
    const offset = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const timeFilter = (query.filter ?? 'all') as TimeFilter;
    const bounds = getTimeFilterBounds(timeFilter);

    const sortColMap: Record<string, string> = {
      createdAt: 'g.created_at',
      updatedAt: 'g.updated_at',
      dueDate: 'g.due_date',
      startDate: 'g.start_date',
      priority: 'g.priority',
      status: 'g.status',
    };
    const orderCol = sortColMap[sortBy] ?? 'g.created_at';

    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const visibility = await this.buildGoalVisibilityCondition(
        schemaName,
        userId,
        roles ?? [],
        tx,
      );
      const conditions: string[] = [visibility.sql];
      const params: unknown[] = [...visibility.params];
      let p = params.length + 1;
      if (query.assignedToType) {
        conditions.push(`g.assigned_to_type = $${p}`);
        params.push(query.assignedToType);
        p++;
      }
      if (query.status) {
        conditions.push(`g.status = $${p}`);
        params.push(query.status);
        p++;
      }
      if (query.priority) {
        conditions.push(`g.priority = $${p}`);
        params.push(query.priority);
        p++;
      }
      if (bounds) {
        conditions.push(
          `(g.created_at::date >= $${p}::date AND g.created_at::date <= $${p + 1}::date OR (g.due_date IS NOT NULL AND g.due_date >= $${p}::date AND g.due_date <= $${p + 1}::date))`,
        );
        params.push(bounds.start.toISOString().slice(0, 10), bounds.end.toISOString().slice(0, 10));
        p += 2;
      }
      const whereClause = conditions.join(' AND ');

      const countResult = (await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::text as count FROM goals g
         LEFT JOIN users u ON g.assigned_to_id = u.id AND g.assigned_to_type = 'user'
         LEFT JOIN groups gr ON g.assigned_to_id = gr.id AND g.assigned_to_type = 'group'
         LEFT JOIN projects pr ON g.assigned_to_id = pr.id AND g.assigned_to_type = 'project'
         WHERE ${whereClause}`,
        ...params,
      )) as Array<{ count: string }>;
      const total = parseInt(countResult[0]?.count ?? '0', 10);
      const totalPages = Math.ceil(total / limit);

      const rows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          title: string;
          description: string | null;
          assigned_to_id: string;
          assigned_to_type: string;
          created_by_id: string;
          priority: string;
          status: string;
          progress: number;
          start_date: Date | null;
          due_date: Date | null;
          completed_at: Date | null;
          created_at: Date;
          updated_at: Date;
          assignee_first_name: string | null;
          assignee_last_name: string | null;
          group_name: string | null;
          project_name: string | null;
          creator_first_name: string;
          creator_last_name: string;
        }>
      >(
        `SELECT g.id, g.title, g.description, g.assigned_to_id, g.assigned_to_type, g.created_by_id,
                g.priority, g.status, g.progress, g.start_date, g.due_date, g.completed_at, g.created_at, g.updated_at,
                u.first_name AS assignee_first_name, u.last_name AS assignee_last_name,
                gr.name AS group_name, pr.name AS project_name,
                cu.first_name AS creator_first_name, cu.last_name AS creator_last_name
         FROM goals g
         LEFT JOIN users u ON g.assigned_to_id = u.id AND g.assigned_to_type = 'user'
         LEFT JOIN groups gr ON g.assigned_to_id = gr.id AND g.assigned_to_type = 'group'
         LEFT JOIN projects pr ON g.assigned_to_id = pr.id AND g.assigned_to_type = 'project'
         LEFT JOIN users cu ON g.created_by_id = cu.id
         WHERE ${whereClause}
         ORDER BY ${orderCol} ${sortOrder}
         LIMIT $${p} OFFSET $${p + 1}`,
        ...params,
        limit,
        offset,
      );

      const today = new Date().toISOString().slice(0, 10);
      const data = rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        assignedTo: {
          type: r.assigned_to_type as 'user' | 'group' | 'project',
          id: r.assigned_to_id,
          name: this.resolveAssigneeName(r.assigned_to_type, r.assigned_to_id, r),
        },
        createdBy: {
          id: r.created_by_id,
          firstName: r.creator_first_name,
          lastName: r.creator_last_name,
        },
        priority: r.priority,
        status: r.status,
        progress: r.progress,
        startDate: r.start_date ? (r.start_date as Date).toISOString().slice(0, 10) : null,
        dueDate: r.due_date ? (r.due_date as Date).toISOString().slice(0, 10) : null,
        completedAt: r.completed_at ? (r.completed_at as Date).toISOString() : null,
        isOverdue:
          r.status !== 'completed' &&
          r.due_date != null &&
          (r.due_date as Date).toISOString().slice(0, 10) < today,
        createdAt: (r.created_at as Date).toISOString(),
        updatedAt: (r.updated_at as Date).toISOString(),
      }));
      return { data, meta: { page, limit, total, totalPages } };
    });
  }

  async create(
    tenant: TenantInfo,
    userId: string,
    dto: CreateGoalDto,
  ) {
    const schemaName = tenant.schemaName;
    const assignedToType = dto.assignedToType ?? 'user';

    if (assignedToType === 'user') {
      const userExists = (await this.prisma.withTenantSchema(schemaName, async (tx) => {
        return tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM users WHERE id = $1 AND status = 'active'`,
          dto.assignedToId,
        );
      })) as Array<{ id: string }>;
      if (userExists.length === 0) throw new NotFoundException('User not found');
    } else if (assignedToType === 'group') {
      const groupExists = (await this.prisma.withTenantSchema(schemaName, async (tx) => {
        return tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM groups WHERE id = $1`,
          dto.assignedToId,
        );
      })) as Array<{ id: string }>;
      if (groupExists.length === 0) throw new NotFoundException('Group not found');
    } else {
      const projectExists = (await this.prisma.withTenantSchema(schemaName, async (tx) => {
        return tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM projects WHERE id = $1`,
          dto.assignedToId,
        );
      })) as Array<{ id: string }>;
      if (projectExists.length === 0) throw new NotFoundException('Project not found');
    }

    if (dto.startDate && dto.dueDate && dto.dueDate < dto.startDate) {
      throw new BadRequestException('Due date must be on or after start date');
    }

    const created = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const result = (await tx.$queryRawUnsafe<Array<{
        id: string;
        title: string;
        assigned_to_type: string;
        assigned_to_id: string;
        created_by_id: string;
        priority: string;
        status: string;
        progress: number;
        start_date: Date | null;
        due_date: Date | null;
        created_at: Date;
        updated_at: Date;
      }>>(
        `INSERT INTO goals (id, title, description, assigned_to_id, assigned_to_type, created_by_id, priority, status, progress, start_date, due_date, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10::date, NOW(), NOW())
       RETURNING id, title, assigned_to_type, assigned_to_id, created_by_id, priority, status, progress, start_date, due_date, created_at, updated_at`,
        dto.title,
        dto.description ?? null,
        dto.assignedToId,
        assignedToType,
        userId,
        dto.priority ?? 'medium',
        'not_started',
        0,
        dto.startDate ?? null,
        dto.dueDate ?? null,
      )) as Array<{
        id: string;
        title: string;
        assigned_to_type: string;
        assigned_to_id: string;
        created_by_id: string;
        priority: string;
        status: string;
        progress: number;
        start_date: Date | null;
        due_date: Date | null;
        created_at: Date;
        updated_at: Date;
      }>;
      const row = result[0];
      if (!row) throw new BadRequestException('Insert failed');
      return row;
    });

    await this.insertAuditLog(
      schemaName,
      userId,
      'create',
      'performance',
      'goals',
      created.id,
      null,
      { title: created.title, assignedToType, assignedToId: dto.assignedToId },
    );

    const recipientIds: string[] = [];
    if (assignedToType === 'user') {
      recipientIds.push(dto.assignedToId);
    } else if (assignedToType === 'group') {
      const members = (await this.prisma.withTenantSchema(schemaName, async (tx) => {
        return tx.$queryRawUnsafe<Array<{ user_id: string }>>(
          `SELECT user_id::text FROM group_members WHERE group_id = $1`,
          dto.assignedToId,
        );
      })) as Array<{ user_id: string }>;
      recipientIds.push(...members.map((m) => m.user_id));
    } else {
      const members = (await this.prisma.withTenantSchema(schemaName, async (tx) => {
        return tx.$queryRawUnsafe<Array<{ user_id: string }>>(
          `SELECT user_id::text FROM project_members WHERE project_id = $1`,
          dto.assignedToId,
        );
      })) as Array<{ user_id: string }>;
      recipientIds.push(...members.map((m) => m.user_id));
    }
    const title = 'New goal assigned';
    const message = `You have been assigned a new goal: '${created.title}'`;
    const data = { goalId: created.id, assignedToType, assignedToId: dto.assignedToId };
    for (const recipientId of recipientIds) {
      this.notificationService
        .create(recipientId, 'goal_assigned', title, message, schemaName, data)
        .catch(() => {});
    }

    return this.findOne(tenant, userId, [], created.id);
  }

  private shiftPlaceholders(sql: string, offset: number): string {
    return sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
  }

  async findOne(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    id: string,
  ) {
    const schemaName = tenant.schemaName;
    const visibility = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return this.buildGoalVisibilityCondition(schemaName, userId, roles ?? [], tx);
    });
    const whereClause = `g.id = $1 AND ${this.shiftPlaceholders(visibility.sql, 1)}`;
    const params = [id, ...visibility.params];

    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{
          id: string;
          title: string;
          description: string | null;
          assigned_to_id: string;
          assigned_to_type: string;
          created_by_id: string;
          priority: string;
          status: string;
          progress: number;
          start_date: Date | null;
          due_date: Date | null;
          completed_at: Date | null;
          created_at: Date;
          updated_at: Date;
          assignee_first_name: string | null;
          assignee_last_name: string | null;
          group_name: string | null;
          project_name: string | null;
          creator_first_name: string;
          creator_last_name: string;
        }>
      >(
        `SELECT g.id, g.title, g.description, g.assigned_to_id, g.assigned_to_type, g.created_by_id,
                g.priority, g.status, g.progress, g.start_date, g.due_date, g.completed_at, g.created_at, g.updated_at,
                u.first_name AS assignee_first_name, u.last_name AS assignee_last_name,
                gr.name AS group_name, pr.name AS project_name,
                cu.first_name AS creator_first_name, cu.last_name AS creator_last_name
         FROM goals g
         LEFT JOIN users u ON g.assigned_to_id = u.id AND g.assigned_to_type = 'user'
         LEFT JOIN groups gr ON g.assigned_to_id = gr.id AND g.assigned_to_type = 'group'
         LEFT JOIN projects pr ON g.assigned_to_id = pr.id AND g.assigned_to_type = 'project'
         LEFT JOIN users cu ON g.created_by_id = cu.id
         WHERE ${whereClause}`,
        ...params,
      );
    });
    if (rows.length === 0) throw new NotFoundException('Goal not found');
    const r = rows[0];

    const historyRows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{
          id: string;
          user_id: string;
          first_name: string;
          last_name: string;
          photo_url: string | null;
          old_progress: number;
          new_progress: number;
          note: string | null;
          created_at: Date;
        }>
      >(
        `SELECT gph.id, gph.user_id, u.first_name, u.last_name, u.photo_url,
                gph.old_progress, gph.new_progress, gph.note, gph.created_at
         FROM goal_progress_history gph
         JOIN users u ON gph.user_id = u.id
         WHERE gph.goal_id = $1
         ORDER BY gph.created_at DESC`,
        id,
      );
    });

    const today = new Date().toISOString().slice(0, 10);
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      assignedTo: {
        type: r.assigned_to_type as 'user' | 'group' | 'project',
        id: r.assigned_to_id,
        name: this.resolveAssigneeName(r.assigned_to_type, r.assigned_to_id, r),
      },
      createdBy: {
        id: r.created_by_id,
        firstName: r.creator_first_name,
        lastName: r.creator_last_name,
      },
      priority: r.priority,
      status: r.status,
      progress: r.progress,
      startDate: r.start_date ? (r.start_date as Date).toISOString().slice(0, 10) : null,
      dueDate: r.due_date ? (r.due_date as Date).toISOString().slice(0, 10) : null,
      completedAt: r.completed_at ? (r.completed_at as Date).toISOString() : null,
      isOverdue:
        r.status !== 'completed' &&
        r.due_date != null &&
        (r.due_date as Date).toISOString().slice(0, 10) < today,
      progressHistory: historyRows.map((h) => ({
        id: h.id,
        user: {
          id: h.user_id,
          firstName: h.first_name,
          lastName: h.last_name,
          photoUrl: h.photo_url,
        },
        oldProgress: h.old_progress,
        newProgress: h.new_progress,
        note: h.note,
        createdAt: (h.created_at as Date).toISOString(),
      })),
      createdAt: (r.created_at as Date).toISOString(),
      updatedAt: (r.updated_at as Date).toISOString(),
    };
  }

  async update(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    id: string,
    dto: UpdateGoalDto,
  ) {
    const schemaName = tenant.schemaName;
    const goal = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{ created_by_id: string; status: string; completed_at: Date | null }>
      >(`SELECT created_by_id, status, completed_at FROM goals WHERE id = $1`, id);
      if (rows.length === 0) return null;
      return rows[0];
    });
    if (!goal) throw new NotFoundException('Goal not found');
    const canEdit =
      this.isAdminOrHr(roles ?? []) || goal.created_by_id === userId;
    if (!canEdit) throw new ForbiddenException('Only the goal creator or admin can update this goal');

    if (dto.startDate != null && dto.dueDate != null && dto.dueDate < dto.startDate) {
      throw new BadRequestException('Due date must be on or after start date');
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    if (dto.title !== undefined) {
      updates.push(`title = $${p}`);
      params.push(dto.title);
      p++;
    }
    if (dto.description !== undefined) {
      updates.push(`description = $${p}`);
      params.push(dto.description);
      p++;
    }
    if (dto.priority !== undefined) {
      updates.push(`priority = $${p}`);
      params.push(dto.priority);
      p++;
    }
    if (dto.status !== undefined) {
      updates.push(`status = $${p}`);
      params.push(dto.status);
      p++;
      if (dto.status === 'completed') {
        updates.push(`completed_at = NOW()`);
      } else {
        updates.push(`completed_at = NULL`);
      }
    }
    if (dto.startDate !== undefined) {
      updates.push(`start_date = $${p}::date`);
      params.push(dto.startDate);
      p++;
    }
    if (dto.dueDate !== undefined) {
      updates.push(`due_date = $${p}::date`);
      params.push(dto.dueDate);
      p++;
    }
    if (updates.length === 0) return this.findOne(tenant, userId, roles, id);
    updates.push(`updated_at = NOW()`);
    params.push(id);

    await this.prisma.withTenantSchema(schemaName, async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE goals SET ${updates.join(', ')} WHERE id = $${p}`,
        ...params,
      );
    });
    await this.insertAuditLog(
      schemaName,
      userId,
      'update',
      'performance',
      'goals',
      id,
      {},
      dto as object,
    );
    return this.findOne(tenant, userId, roles, id);
  }

  async updateProgress(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    id: string,
    dto: UpdateProgressDto,
  ) {
    const schemaName = tenant.schemaName;
    const goal = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          progress: number;
          status: string;
          title: string;
          created_by_id: string;
        }>
      >(
        `SELECT g.id, g.progress, g.status, g.title, g.created_by_id,
                (g.assigned_to_type = 'user' AND g.assigned_to_id = $2) AS is_assignee,
                (g.assigned_to_type = 'group' AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = g.assigned_to_id AND gm.user_id = $2)) AS in_group,
                (g.assigned_to_type = 'project' AND EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = g.assigned_to_id AND pm.user_id = $2)) AS in_project
         FROM goals g WHERE g.id = $1`,
        id,
        userId,
      );
      if (rows.length === 0) return null;
      const r = rows[0] as typeof rows[0] & { is_assignee: boolean; in_group: boolean; in_project: boolean };
      const canUpdate =
        this.isAdminOrHr(roles ?? []) ||
        r.created_by_id === userId ||
        r.is_assignee ||
        r.in_group ||
        r.in_project;
      if (!canUpdate) return null;
      return {
        id: r.id,
        progress: r.progress,
        status: r.status,
        title: r.title,
        created_by_id: r.created_by_id,
      };
    });
    if (!goal) throw new NotFoundException('Goal not found');
    if (dto.progress === goal.progress) {
      throw new BadRequestException('Progress value is unchanged');
    }

    const oldProgress = goal.progress;
    const newProgress = dto.progress;
    let newStatus = goal.status;
    if (newProgress > 0 && goal.status === 'not_started') newStatus = 'in_progress';
    if (newProgress === 100) newStatus = 'completed';

    await this.prisma.withTenantSchema(schemaName, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO goal_progress_history (id, goal_id, user_id, old_progress, new_progress, note, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())`,
        id,
        userId,
        oldProgress,
        newProgress,
        dto.note ?? null,
      );
      await tx.$executeRawUnsafe(
        `UPDATE goals SET progress = $1, status = $2, updated_at = NOW()${newStatus === 'completed' ? ', completed_at = NOW()' : ''} WHERE id = $3`,
        newProgress,
        newStatus,
        id,
      );
    });

    await this.insertAuditLog(
      schemaName,
      userId,
      'update',
      'performance',
      'goals',
      id,
      { progress: oldProgress },
      { progress: newProgress, note: dto.note },
    );

    this.notificationService
      .create(
        goal.created_by_id,
        'goal_progress_updated',
        'Goal progress updated',
        `'${goal.title}' progress updated from ${oldProgress}% to ${newProgress}%`,
        schemaName,
        { goalId: id, oldProgress, newProgress },
      )
      .catch(() => {});

    if (newProgress === 100) {
      this.notificationService
        .create(
          goal.created_by_id,
          'goal_completed',
          'Goal completed',
          `'${goal.title}' has been marked as completed`,
          schemaName,
          { goalId: id },
        )
        .catch(() => {});
    }

    return this.findOne(tenant, userId, roles, id);
  }

  async remove(tenant: TenantInfo, userId: string, roles: string[], id: string) {
    const schemaName = tenant.schemaName;
    const goal = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{ created_by_id: string }>
      >(`SELECT created_by_id FROM goals WHERE id = $1`, id);
      return rows[0] ?? null;
    });
    if (!goal) throw new NotFoundException('Goal not found');
    const canDelete =
      this.isAdminOrHr(roles ?? []) || goal.created_by_id === userId;
    if (!canDelete) throw new ForbiddenException('Only the goal creator or admin can delete this goal');

    await this.prisma.withTenantSchema(schemaName, async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM goals WHERE id = $1`, id);
    });
    await this.insertAuditLog(
      schemaName,
      userId,
      'delete',
      'performance',
      'goals',
      id,
      {},
      null,
    );
    return { message: 'Goal deleted' };
  }

  async export(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    query: {
      format: 'csv' | 'xlsx' | 'pdf';
      assignedToType?: string;
      status?: string;
      priority?: string;
      filter?: TimeFilter;
    },
  ) {
    const listResult = await this.list(tenant, userId, roles, {
      page: 1,
      limit: 10000,
      assignedToType: query.assignedToType,
      status: query.status,
      priority: query.priority,
      filter: (query.filter ?? 'all') as TimeFilter,
    });
    const columns: ColumnDef[] = [
      { key: 'title', header: 'Title', width: 25 },
      { key: 'description', header: 'Description', width: 40, format: (v) => (v ? String(v).slice(0, 200) : '') },
      { key: 'assignedToName', header: 'Assigned To', width: 20 },
      { key: 'assignedToType', header: 'Assignment Type', width: 15 },
      { key: 'createdBy', header: 'Created By', width: 20 },
      { key: 'priority', header: 'Priority', width: 10 },
      { key: 'status', header: 'Status', width: 12 },
      { key: 'progress', header: 'Progress', width: 10, format: (v) => `${v}%` },
      { key: 'startDate', header: 'Start Date', width: 12 },
      { key: 'dueDate', header: 'Due Date', width: 12 },
      { key: 'completedAt', header: 'Completed At', width: 18 },
      { key: 'overdue', header: 'Overdue', width: 8 },
    ];
    const rows = listResult.data.map((g) => ({
      title: g.title,
      description: g.description ?? '',
      assignedToName: g.assignedTo.name,
      assignedToType: g.assignedTo.type,
      createdBy: `${g.createdBy.firstName} ${g.createdBy.lastName}`.trim(),
      priority: g.priority,
      status: g.status,
      progress: g.progress,
      startDate: g.startDate ?? '',
      dueDate: g.dueDate ?? '',
      completedAt: g.completedAt ?? '',
      overdue: g.isOverdue ? 'Yes' : 'No',
    }));
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `goals_${dateStr}.${query.format}`;
    if (query.format === 'csv') {
      const buf = await this.exportService.toCsv(rows, columns);
      return { buffer: buf, filename };
    }
    if (query.format === 'xlsx') {
      const buf = await this.exportService.toXlsx(rows, columns, { sheetName: 'Goals', filename });
      return { buffer: buf, filename };
    }
    const buf = await this.exportService.toPdf(rows, columns, { title: 'Goals Export', filename });
    return { buffer: buf, filename };
  }
}
