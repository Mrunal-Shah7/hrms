import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../../core/notification/notification.service';
import type { TenantInfo } from '../../tenant/tenant.interface';
import type { CreateCycleDto } from './dto/create-cycle.dto';
import type { UpdateCycleDto } from './dto/update-cycle.dto';

@Injectable()
export class ReviewCyclesService {
  constructor(
    private readonly prisma: PrismaService,
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
    query: {
      page?: number;
      limit?: number;
      status?: string;
      sortBy?: string;
      sortOrder?: string;
    },
  ) {
    const schemaName = tenant.schemaName;
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 10, 100);
    const offset = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'startDate';
    const sortOrder = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const orderCol = sortBy === 'startDate' ? 'rc.start_date' : sortBy === 'endDate' ? 'rc.end_date' : 'rc.created_at';

    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const conditions: string[] = ['1=1'];
      const params: unknown[] = [];
      let p = 1;
      if (query.status) {
        conditions.push(`rc.status = $${p}`);
        params.push(query.status);
        p++;
      }
      const whereClause = conditions.join(' AND ');

      const countResult = (await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::text as count FROM performance_review_cycles rc WHERE ${whereClause}`,
        ...params,
      )) as Array<{ count: string }>;
      const total = parseInt(countResult[0]?.count ?? '0', 10);
      const totalPages = Math.ceil(total / limit);

      const rows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          name: string;
          type: string;
          start_date: Date;
          end_date: Date;
          status: string;
          created_at: Date;
          updated_at: Date;
          review_count: string;
          submitted_count: string;
          acknowledged_count: string;
        }>
      >(
        `SELECT rc.id, rc.name, rc.type, rc.start_date, rc.end_date, rc.status, rc.created_at, rc.updated_at,
                (SELECT COUNT(*)::text FROM performance_reviews pr WHERE pr.cycle_id = rc.id) AS review_count,
                (SELECT COUNT(*)::text FROM performance_reviews pr WHERE pr.cycle_id = rc.id AND pr.status = 'submitted') AS submitted_count,
                (SELECT COUNT(*)::text FROM performance_reviews pr WHERE pr.cycle_id = rc.id AND pr.status = 'acknowledged') AS acknowledged_count
         FROM performance_review_cycles rc
         WHERE ${whereClause}
         ORDER BY ${orderCol} ${sortOrder}
         LIMIT $${p} OFFSET $${p + 1}`,
        ...params,
        limit,
        offset,
      );

      const data = rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        startDate: (r.start_date as Date).toISOString().slice(0, 10),
        endDate: (r.end_date as Date).toISOString().slice(0, 10),
        status: r.status,
        reviewCount: parseInt(r.review_count, 10),
        submittedCount: parseInt(r.submitted_count, 10),
        acknowledgedCount: parseInt(r.acknowledged_count, 10),
        createdAt: (r.created_at as Date).toISOString(),
        updatedAt: (r.updated_at as Date).toISOString(),
      }));
      return { data, meta: { page, limit, total, totalPages } };
    });
  }

  async create(tenant: TenantInfo, userId: string, dto: CreateCycleDto) {
    const schemaName = tenant.schemaName;
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end <= start) {
      throw new BadRequestException('End date must be after start date');
    }

    const nameExists = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM performance_review_cycles WHERE name = $1`,
        dto.name,
      );
      return rows.length > 0;
    });
    if (nameExists) throw new ConflictException('A review cycle with this name already exists');

    const created = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const result = (await tx.$queryRawUnsafe<Array<{
        id: string;
        name: string;
        type: string;
        start_date: Date;
        end_date: Date;
        status: string;
        created_at: Date;
        updated_at: Date;
      }>>(
        `INSERT INTO performance_review_cycles (id, name, type, start_date, end_date, status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3::date, $4::date, 'draft', NOW(), NOW())
         RETURNING id, name, type, start_date, end_date, status, created_at, updated_at`,
        dto.name,
        dto.type,
        dto.startDate,
        dto.endDate,
      )) as Array<{ id: string; name: string; type: string; start_date: Date; end_date: Date; status: string; created_at: Date; updated_at: Date }>;
      return result[0];
    });

    await this.insertAuditLog(
      schemaName,
      userId,
      'create',
      'performance',
      'review_cycles',
      created.id,
      null,
      { name: created.name, type: dto.type },
    );

    return this.findOne(tenant, created.id);
  }

  async findOne(tenant: TenantInfo, id: string) {
    const schemaName = tenant.schemaName;
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{
          id: string;
          name: string;
          type: string;
          start_date: Date;
          end_date: Date;
          status: string;
          created_at: Date;
          updated_at: Date;
          review_count: string;
          submitted_count: string;
          acknowledged_count: string;
        }>
      >(
        `SELECT rc.id, rc.name, rc.type, rc.start_date, rc.end_date, rc.status, rc.created_at, rc.updated_at,
                (SELECT COUNT(*)::text FROM performance_reviews pr WHERE pr.cycle_id = rc.id) AS review_count,
                (SELECT COUNT(*)::text FROM performance_reviews pr WHERE pr.cycle_id = rc.id AND pr.status = 'submitted') AS submitted_count,
                (SELECT COUNT(*)::text FROM performance_reviews pr WHERE pr.cycle_id = rc.id AND pr.status = 'acknowledged') AS acknowledged_count
         FROM performance_review_cycles rc WHERE rc.id = $1`,
        id,
      );
    });
    if (rows.length === 0) throw new NotFoundException('Review cycle not found');
    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      startDate: (r.start_date as Date).toISOString().slice(0, 10),
      endDate: (r.end_date as Date).toISOString().slice(0, 10),
      status: r.status,
      reviewCount: parseInt(r.review_count, 10),
      submittedCount: parseInt(r.submitted_count, 10),
      acknowledgedCount: parseInt(r.acknowledged_count, 10),
      createdAt: (r.created_at as Date).toISOString(),
      updatedAt: (r.updated_at as Date).toISOString(),
    };
  }

  async update(
    tenant: TenantInfo,
    userId: string,
    id: string,
    dto: UpdateCycleDto,
  ) {
    const schemaName = tenant.schemaName;
    const existing = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{ status: string; start_date: Date; end_date: Date }>
      >(
        `SELECT status, start_date, end_date FROM performance_review_cycles WHERE id = $1`,
        id,
      );
      return rows[0] ?? null;
    });
    if (!existing) throw new NotFoundException('Review cycle not found');

    if (dto.startDate != null && dto.endDate != null && new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new BadRequestException('End date must be after start date');
    }

    if (dto.status !== undefined) {
      if (existing.status === 'completed' && dto.status !== 'completed') {
        throw new BadRequestException('Cannot change status from completed');
      }
      if (existing.status === 'draft' && dto.status === 'completed') {
        throw new BadRequestException('Cannot set status to completed from draft; activate first');
      }
      if (existing.status === 'active' && dto.status === 'draft') {
        throw new BadRequestException('Cannot revert to draft from active');
      }
      if (existing.status === 'draft' && dto.status === 'active') {
        const overlapping = await this.prisma.withTenantSchema(schemaName, async (tx) => {
          const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id FROM performance_review_cycles
             WHERE status = 'active' AND id != $1
               AND start_date <= $2::date AND end_date >= $3::date`,
            id,
            dto.endDate ?? existing.end_date,
            dto.startDate ?? existing.start_date,
          );
          return rows;
        });
        if (overlapping.length > 0) {
          throw new ConflictException('An active review cycle already overlaps with this date range');
        }
        await this.activateCycle(schemaName, id, userId, tenant);
      }
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    if (dto.name !== undefined) {
      updates.push(`name = $${p}`);
      params.push(dto.name);
      p++;
    }
    if (dto.type !== undefined) {
      updates.push(`type = $${p}`);
      params.push(dto.type);
      p++;
    }
    if (dto.startDate !== undefined) {
      updates.push(`start_date = $${p}::date`);
      params.push(dto.startDate);
      p++;
    }
    if (dto.endDate !== undefined) {
      updates.push(`end_date = $${p}::date`);
      params.push(dto.endDate);
      p++;
    }
    if (dto.status !== undefined) {
      updates.push(`status = $${p}`);
      params.push(dto.status);
      p++;
    }
    if (updates.length > 0) {
      updates.push(`updated_at = NOW()`);
      params.push(id);
      await this.prisma.withTenantSchema(schemaName, async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE performance_review_cycles SET ${updates.join(', ')} WHERE id = $${p}`,
          ...params,
        );
      });
      await this.insertAuditLog(
        schemaName,
        userId,
        'update',
        'performance',
        'review_cycles',
        id,
        {},
        dto as object,
      );
    }

    return this.findOne(tenant, id);
  }

  private async activateCycle(
    schemaName: string,
    cycleId: string,
    _userId: string,
    tenant: TenantInfo,
  ) {
    const pairs = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<Array<{ subject_id: string; reviewer_id: string }>>(
        `SELECT ep.user_id::text AS subject_id, ep.reports_to::text AS reviewer_id
         FROM employee_profiles ep
         WHERE ep.reports_to IS NOT NULL`,
      );
    }) as Array<{ subject_id: string; reviewer_id: string }>;

    const existing = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<Array<{ subject_id: string }>>(
        `SELECT subject_id::text FROM performance_reviews WHERE cycle_id = $1`,
        cycleId,
      );
    }) as Array<{ subject_id: string }>;
    const existingSet = new Set(existing.map((e) => e.subject_id));

    for (const { subject_id, reviewer_id } of pairs) {
      if (existingSet.has(subject_id)) continue;
      await this.prisma.withTenantSchema(schemaName, async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO performance_reviews (id, cycle_id, subject_id, reviewer_id, status, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, 'pending', NOW(), NOW())`,
          cycleId,
          subject_id,
          reviewer_id,
        );
      });
      existingSet.add(subject_id);
    }

    const cycle = await this.findOne(tenant, cycleId);
    const reviewerIds = [...new Set(pairs.map((p) => p.reviewer_id))];
    const title = 'Performance review cycle started';
    const message = `Review cycle '${cycle.name}' is now active. Please submit reviews for your team by ${cycle.endDate}.`;
    const data = { cycleId, cycleName: cycle.name, endDate: cycle.endDate };
    for (const reviewerId of reviewerIds) {
      this.notificationService
        .create(reviewerId, 'review_cycle_started', title, message, schemaName, data)
        .catch(() => {});
    }
  }

  async remove(tenant: TenantInfo, userId: string, id: string) {
    const schemaName = tenant.schemaName;
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<Array<{ status: string }>>(
        `SELECT status FROM performance_review_cycles WHERE id = $1`,
        id,
      );
    });
    if (rows.length === 0) throw new NotFoundException('Review cycle not found');
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('Cannot delete an active or completed review cycle');
    }
    await this.prisma.withTenantSchema(schemaName, async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM performance_review_cycles WHERE id = $1`, id);
    });
    await this.insertAuditLog(
      schemaName,
      userId,
      'delete',
      'performance',
      'review_cycles',
      id,
      {},
      null,
    );
    return { message: 'Review cycle deleted' };
  }
}
