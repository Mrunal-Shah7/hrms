import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../../core/notification/notification.service';
import type { TenantInfo } from '../../tenant/tenant.interface';
import type { CreateReviewDto } from './dto/create-review.dto';
import type { SubmitReviewDto } from './dto/submit-review.dto';

function isAdminOrHr(roles: string[]): boolean {
  return (
    roles.includes('Admin') ||
    roles.includes('HR Admin') ||
    roles.includes('HR Manager')
  );
}

@Injectable()
export class ReviewsService {
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
    userId: string,
    roles: string[],
    query: {
      cycleId?: string;
      status?: string;
      page?: number;
      limit?: number;
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
    const sortColMap: Record<string, string> = {
      createdAt: 'pr.created_at',
      submittedAt: 'pr.submitted_at',
      acknowledgedAt: 'pr.acknowledged_at',
    };
    const orderCol = sortColMap[sortBy] ?? 'pr.created_at';

    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      let visibilityClause: string;
      const params: unknown[] = [];
      let p = 1;
      if (isAdminOrHr(roles ?? [])) {
        visibilityClause = '1=1';
      } else if (roles?.includes('Manager / Team Lead')) {
        visibilityClause = `pr.reviewer_id = $${p}::uuid`;
        params.push(userId);
        p++;
      } else {
        visibilityClause = `pr.subject_id = $${p}::uuid`;
        params.push(userId);
        p++;
      }
      const conditions: string[] = [visibilityClause];
      if (query.cycleId) {
        conditions.push(`pr.cycle_id = $${p}::uuid`);
        params.push(query.cycleId);
        p++;
      }
      if (query.status) {
        conditions.push(`pr.status = $${p}`);
        params.push(query.status);
        p++;
      }
      const whereClause = conditions.join(' AND ');

      const countResult = (await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::text as count FROM performance_reviews pr WHERE ${whereClause}`,
        ...params,
      )) as Array<{ count: string }>;
      const total = parseInt(countResult[0]?.count ?? '0', 10);
      const totalPages = Math.ceil(total / limit);

      const rows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          cycle_id: string;
          cycle_name: string;
          cycle_type: string;
          subject_id: string;
          sub_employee_id: string | null;
          sub_first_name: string;
          sub_last_name: string;
          sub_photo_url: string | null;
          sub_department: string | null;
          sub_designation: string | null;
          reviewer_id: string;
          rev_first_name: string;
          rev_last_name: string;
          rating: number | null;
          status: string;
          submitted_at: Date | null;
          acknowledged_at: Date | null;
          created_at: Date;
        }>
      >(
        `SELECT pr.id, pr.cycle_id, rc.name AS cycle_name, rc.type AS cycle_type,
                pr.subject_id, u.employee_id AS sub_employee_id, u.first_name AS sub_first_name, u.last_name AS sub_last_name, u.photo_url AS sub_photo_url,
                d.name AS sub_department, des.name AS sub_designation,
                pr.reviewer_id, rv.first_name AS rev_first_name, rv.last_name AS rev_last_name,
                pr.rating, pr.status, pr.submitted_at, pr.acknowledged_at, pr.created_at
         FROM performance_reviews pr
         JOIN performance_review_cycles rc ON pr.cycle_id = rc.id
         JOIN users u ON pr.subject_id = u.id
         LEFT JOIN employee_profiles ep ON u.id = ep.user_id
         LEFT JOIN departments d ON ep.department_id = d.id
         LEFT JOIN designations des ON ep.designation_id = des.id
         JOIN users rv ON pr.reviewer_id = rv.id
         WHERE ${whereClause}
         ORDER BY ${orderCol} ${sortOrder}
         LIMIT $${p} OFFSET $${p + 1}`,
        ...params,
        limit,
        offset,
      );

      const data = rows.map((r) => ({
        id: r.id,
        cycle: { id: r.cycle_id, name: r.cycle_name, type: r.cycle_type },
        subject: {
          id: r.subject_id,
          employeeId: r.sub_employee_id,
          firstName: r.sub_first_name,
          lastName: r.sub_last_name,
          photoUrl: r.sub_photo_url,
          department: r.sub_department,
          designation: r.sub_designation,
        },
        reviewer: {
          id: r.reviewer_id,
          firstName: r.rev_first_name,
          lastName: r.rev_last_name,
        },
        rating: r.rating,
        status: r.status,
        submittedAt: r.submitted_at ? (r.submitted_at as Date).toISOString() : null,
        acknowledgedAt: r.acknowledged_at ? (r.acknowledged_at as Date).toISOString() : null,
        createdAt: (r.created_at as Date).toISOString(),
      }));
      return { data, meta: { page, limit, total, totalPages } };
    });
  }

  async findOne(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    id: string,
  ) {
    const schemaName = tenant.schemaName;
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{
          id: string;
          cycle_id: string;
          cycle_name: string;
          cycle_type: string;
          cycle_start: Date;
          cycle_end: Date;
          subject_id: string;
          sub_employee_id: string | null;
          sub_first_name: string;
          sub_last_name: string;
          sub_photo_url: string | null;
          sub_department: string | null;
          sub_designation: string | null;
          reviewer_id: string;
          rev_first_name: string;
          rev_last_name: string;
          rating: number | null;
          comments: string | null;
          strengths: string | null;
          improvements: string | null;
          status: string;
          submitted_at: Date | null;
          acknowledged_at: Date | null;
          created_at: Date;
          updated_at: Date;
        }>
      >(
        `SELECT pr.id, pr.cycle_id, rc.name AS cycle_name, rc.type AS cycle_type, rc.start_date AS cycle_start, rc.end_date AS cycle_end,
                pr.subject_id, u.employee_id AS sub_employee_id, u.first_name AS sub_first_name, u.last_name AS sub_last_name, u.photo_url AS sub_photo_url,
                d.name AS sub_department, des.name AS sub_designation,
                pr.reviewer_id, rv.first_name AS rev_first_name, rv.last_name AS rev_last_name,
                pr.rating, pr.comments, pr.strengths, pr.improvements,
                pr.status, pr.submitted_at, pr.acknowledged_at, pr.created_at, pr.updated_at
         FROM performance_reviews pr
         JOIN performance_review_cycles rc ON pr.cycle_id = rc.id
         JOIN users u ON pr.subject_id = u.id
         LEFT JOIN employee_profiles ep ON u.id = ep.user_id
         LEFT JOIN departments d ON ep.department_id = d.id
         LEFT JOIN designations des ON ep.designation_id = des.id
         JOIN users rv ON pr.reviewer_id = rv.id
         WHERE pr.id = $1`,
        id,
      );
    });
    if (rows.length === 0) throw new NotFoundException('Review not found');
    const r = rows[0];
    const canViewAsSubject = r.subject_id === userId;
    const canViewAsReviewer = r.reviewer_id === userId;
    if (canViewAsSubject && r.status === 'pending') {
      throw new ForbiddenException('Review has not yet been submitted');
    }
    if (!isAdminOrHr(roles ?? []) && !canViewAsSubject && !canViewAsReviewer) {
      throw new ForbiddenException('You do not have access to this review');
    }

    return {
      id: r.id,
      cycle: {
        id: r.cycle_id,
        name: r.cycle_name,
        type: r.cycle_type,
        startDate: (r.cycle_start as Date).toISOString().slice(0, 10),
        endDate: (r.cycle_end as Date).toISOString().slice(0, 10),
      },
      subject: {
        id: r.subject_id,
        employeeId: r.sub_employee_id,
        firstName: r.sub_first_name,
        lastName: r.sub_last_name,
        photoUrl: r.sub_photo_url,
        department: r.sub_department,
        designation: r.sub_designation,
      },
      reviewer: {
        id: r.reviewer_id,
        firstName: r.rev_first_name,
        lastName: r.rev_last_name,
      },
      rating: r.rating,
      comments: r.comments,
      strengths: r.strengths,
      improvements: r.improvements,
      status: r.status,
      submittedAt: r.submitted_at ? (r.submitted_at as Date).toISOString() : null,
      acknowledgedAt: r.acknowledged_at ? (r.acknowledged_at as Date).toISOString() : null,
      createdAt: (r.created_at as Date).toISOString(),
      updatedAt: (r.updated_at as Date).toISOString(),
    };
  }

  async create(tenant: TenantInfo, userId: string, dto: CreateReviewDto) {
    const schemaName = tenant.schemaName;
    const cycle = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{ id: string; status: string }>
      >(`SELECT id, status FROM performance_review_cycles WHERE id = $1`, dto.cycleId);
      return rows[0] ?? null;
    });
    if (!cycle) throw new NotFoundException('Review cycle not found');
    if (cycle.status !== 'active') {
      throw new BadRequestException('Can only add reviews to an active cycle');
    }
    const subjectExists = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM users WHERE id = $1 AND status = 'active'`,
        dto.subjectId,
      );
      return rows.length > 0;
    });
    if (!subjectExists) throw new NotFoundException('Subject not found');
    const reviewerExists = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM users WHERE id = $1 AND status = 'active'`,
        dto.reviewerId,
      );
      return rows.length > 0;
    });
    if (!reviewerExists) throw new NotFoundException('Reviewer not found');

    const duplicate = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM performance_reviews WHERE cycle_id = $1 AND subject_id = $2`,
        dto.cycleId,
        dto.subjectId,
      );
    });
    if (duplicate.length > 0) {
      throw new ConflictException('A review already exists for this employee in this cycle');
    }

    const created = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const rows = (await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO performance_reviews (id, cycle_id, subject_id, reviewer_id, status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'pending', NOW(), NOW())
         RETURNING id`,
        dto.cycleId,
        dto.subjectId,
        dto.reviewerId,
      )) as Array<{ id: string }>;
      return rows[0].id;
    });

    await this.insertAuditLog(
      schemaName,
      userId,
      'create',
      'performance',
      'reviews',
      created,
      null,
      { cycleId: dto.cycleId, subjectId: dto.subjectId, reviewerId: dto.reviewerId },
    );
    return this.findOne(tenant, userId, [], created);
  }

  async submit(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    id: string,
    dto: SubmitReviewDto,
  ) {
    const schemaName = tenant.schemaName;
    const review = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{ status: string; subject_id: string; reviewer_id: string; cycle_id: string; cycle_name: string; reviewer_first: string; reviewer_last: string }>
      >(
        `SELECT pr.status, pr.subject_id, pr.reviewer_id, pr.cycle_id, rc.name AS cycle_name, rv.first_name AS reviewer_first, rv.last_name AS reviewer_last
         FROM performance_reviews pr
         JOIN performance_review_cycles rc ON pr.cycle_id = rc.id
         JOIN users rv ON pr.reviewer_id = rv.id
         WHERE pr.id = $1`,
        id,
      );
      return rows[0] ?? null;
    });
    if (!review) throw new NotFoundException('Review not found');
    if (review.status !== 'pending') {
      throw new BadRequestException('Can only submit pending reviews');
    }
    const canSubmit = review.reviewer_id === userId || isAdminOrHr(roles ?? []);
    if (!canSubmit) throw new ForbiddenException('Only the reviewer can submit this review');

    await this.prisma.withTenantSchema(schemaName, async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE performance_reviews SET rating = $1, comments = $2, strengths = $3, improvements = $4, status = 'submitted', submitted_at = NOW(), updated_at = NOW() WHERE id = $5`,
        dto.rating,
        dto.comments ?? null,
        dto.strengths ?? null,
        dto.improvements ?? null,
        id,
      );
    });

    await this.insertAuditLog(
      schemaName,
      userId,
      'update',
      'performance',
      'reviews',
      id,
      { status: 'pending' },
      { status: 'submitted', rating: dto.rating },
    );

    const reviewerName = [review.reviewer_first, review.reviewer_last].filter(Boolean).join(' ');
    this.notificationService
      .create(
        review.subject_id,
        'review_submitted',
        'Performance review submitted',
        `Your performance review for cycle '${review.cycle_name}' has been submitted by ${reviewerName}. Please review and acknowledge.`,
        schemaName,
        { reviewId: id, cycleId: review.cycle_id, reviewerId: review.reviewer_id },
      )
      .catch(() => {});

    return this.findOne(tenant, userId, roles ?? [], id);
  }

  async acknowledge(tenant: TenantInfo, userId: string, roles: string[], id: string) {
    const schemaName = tenant.schemaName;
    const review = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{ status: string; subject_id: string }>
      >(`SELECT status, subject_id FROM performance_reviews WHERE id = $1`, id);
      return rows[0] ?? null;
    });
    if (!review) throw new NotFoundException('Review not found');
    if (review.status !== 'submitted') {
      throw new BadRequestException('Can only acknowledge submitted reviews');
    }
    if (review.subject_id !== userId) {
      throw new ForbiddenException('Only the reviewed employee can acknowledge');
    }

    await this.prisma.withTenantSchema(schemaName, async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE performance_reviews SET status = 'acknowledged', acknowledged_at = NOW(), updated_at = NOW() WHERE id = $1`,
        id,
      );
    });

    await this.insertAuditLog(
      schemaName,
      userId,
      'update',
      'performance',
      'reviews',
      id,
      { status: 'submitted' },
      { status: 'acknowledged' },
    );
    return this.findOne(tenant, userId, roles ?? [], id);
  }
}
