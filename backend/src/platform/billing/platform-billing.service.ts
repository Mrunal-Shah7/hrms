import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ListBillingQueryDto,
  GenerateBillingDto,
  UpdateBillingStatusDto,
} from './dto';

@Injectable()
export class PlatformBillingService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListBillingQueryDto) {
    const {
      tenantId,
      status,
      from,
      to,
      page = 1,
      limit = 20,
      sortBy = 'created_at',
      sortOrder = 'desc',
    } = query;

    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (tenantId) {
      conditions.push(`b.tenant_id = $${paramIndex++}`);
      params.push(tenantId);
    }
    if (status) {
      conditions.push(`b.status = $${paramIndex++}`);
      params.push(status);
    }
    if (from) {
      conditions.push(`b.period_start >= $${paramIndex++}`);
      params.push(from);
    }
    if (to) {
      conditions.push(`b.period_end <= $${paramIndex++}`);
      params.push(to);
    }

    const whereClause = conditions.join(' AND ');
    const sortColumn = this.mapSortColumn(sortBy);
    const safeOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const countRows = await this.prisma.queryRaw<{ count: string }>(
      `SELECT COUNT(*)::bigint as count FROM platform.billing_records b
       LEFT JOIN platform.tenants t ON b.tenant_id = t.id
       WHERE ${whereClause}`,
      ...params,
    );
    const total = parseInt(countRows[0]?.count ?? '0', 10);

    const offset = (page - 1) * limit;
    const limitParamIndex = paramIndex++;
    const offsetParamIndex = paramIndex;
    params.push(limit, offset);

    const rows = await this.prisma.queryRaw<{
      id: string;
      tenant_id: string;
      tenant_name: string;
      tenant_slug: string;
      period_start: Date;
      period_end: Date;
      user_count: number;
      per_user_rate: string;
      tier: string;
      total_amount: string;
      status: string;
      created_at: Date;
    }>(
      `SELECT b.id, b.tenant_id, t.name as tenant_name, t.slug as tenant_slug,
              b.period_start, b.period_end, b.user_count, b.per_user_rate,
              b.tier, b.total_amount, b.status, b.created_at
       FROM platform.billing_records b
       LEFT JOIN platform.tenants t ON b.tenant_id = t.id
       WHERE ${whereClause}
       ORDER BY b.${sortColumn} ${safeOrder}
       LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
      ...params,
    );

    const data = rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      tenantName: r.tenant_name ?? null,
      tenantSlug: r.tenant_slug ?? null,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      userCount: r.user_count,
      perUserRate: parseFloat(r.per_user_rate),
      tier: r.tier,
      totalAmount: parseFloat(r.total_amount),
      status: r.status,
      createdAt: r.created_at,
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
  }

  private mapSortColumn(sortBy: string): string {
    const map: Record<string, string> = {
      created_at: 'created_at',
      period_start: 'period_start',
      total_amount: 'total_amount',
      status: 'status',
    };
    return map[sortBy] ?? 'created_at';
  }

  async getById(id: string) {
    const rows = await this.prisma.queryRaw<{
      id: string;
      tenant_id: string;
      tenant_name: string;
      tenant_slug: string;
      tenant_billing_email: string;
      period_start: Date;
      period_end: Date;
      user_count: number;
      per_user_rate: string;
      tier: string;
      total_amount: string;
      status: string;
      created_at: Date;
      updated_at: Date | null;
    }>(
      `SELECT b.id, b.tenant_id, t.name as tenant_name, t.slug as tenant_slug,
              t.billing_email as tenant_billing_email,
              b.period_start, b.period_end, b.user_count, b.per_user_rate,
              b.tier, b.total_amount, b.status, b.created_at, b.updated_at
       FROM platform.billing_records b
       LEFT JOIN platform.tenants t ON b.tenant_id = t.id
       WHERE b.id = $1 LIMIT 1`,
      id,
    );

    if (rows.length === 0) {
      throw new NotFoundException('Billing record not found');
    }

    const r = rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      tenantName: r.tenant_name ?? null,
      tenantSlug: r.tenant_slug ?? null,
      tenantBillingEmail: r.tenant_billing_email ?? null,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      userCount: r.user_count,
      perUserRate: parseFloat(r.per_user_rate),
      tier: r.tier,
      totalAmount: parseFloat(r.total_amount),
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at ?? r.created_at,
    };
  }

  async generate(dto: GenerateBillingDto) {
    const tenantRows = await this.prisma.queryRaw<{
      id: string;
      status: string;
      current_user_count: number;
      subscription_tier: string;
    }>(
      `SELECT id, status, current_user_count, subscription_tier
       FROM platform.tenants WHERE id = $1 LIMIT 1`,
      dto.tenantId,
    );

    if (tenantRows.length === 0) {
      throw new NotFoundException('Tenant not found');
    }

    const tenant = tenantRows[0];
    if (tenant.status === 'cancelled') {
      throw new BadRequestException(
        'Cannot generate billing for a cancelled tenant',
      );
    }

    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodEnd <= periodStart) {
      throw new BadRequestException('Period end must be after period start');
    }

    const existingRows = await this.prisma.queryRaw<{ id: string }>(
      `SELECT id FROM platform.billing_records
       WHERE tenant_id = $1 AND period_start = $2 AND period_end = $3 LIMIT 1`,
      dto.tenantId,
      dto.periodStart,
      dto.periodEnd,
    );
    if (existingRows.length > 0) {
      throw new ConflictException(
        'Billing record already exists for this period',
      );
    }

    const userCount = tenant.current_user_count;
    const totalAmount = userCount * dto.perUserRate;

    const insertRows = await this.prisma.queryRaw<{
      id: string;
      period_start: Date;
      period_end: Date;
      user_count: number;
      per_user_rate: string;
      tier: string;
      total_amount: string;
      status: string;
      created_at: Date;
    }>(
      `INSERT INTO platform.billing_records
       (id, tenant_id, period_start, period_end, user_count, per_user_rate,
        tier, total_amount, status, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'pending', NOW(), NOW())
       RETURNING id, period_start, period_end, user_count, per_user_rate,
                 tier, total_amount, status, created_at`,
      dto.tenantId,
      dto.periodStart,
      dto.periodEnd,
      userCount,
      dto.perUserRate,
      tenant.subscription_tier,
      totalAmount,
    );

    const r = insertRows[0];
    return {
      id: r.id,
      tenantId: dto.tenantId,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      userCount: r.user_count,
      perUserRate: parseFloat(r.per_user_rate),
      tier: r.tier,
      totalAmount: parseFloat(r.total_amount),
      status: r.status,
      createdAt: r.created_at,
    };
  }

  async updateStatus(id: string, dto: UpdateBillingStatusDto) {
    const rows = await this.prisma.queryRaw<{ id: string; status: string }>(
      `SELECT id, status FROM platform.billing_records WHERE id = $1 LIMIT 1`,
      id,
    );

    if (rows.length === 0) {
      throw new NotFoundException('Billing record not found');
    }

    const current = rows[0];
    if (current.status === 'paid' && dto.status === 'overdue') {
      throw new BadRequestException(
        'Cannot change a paid record to overdue',
      );
    }
    if (current.status === 'paid' && dto.status === 'paid') {
      throw new BadRequestException('Record is already marked as paid');
    }

    await this.prisma.executeRaw(
      `UPDATE platform.billing_records SET status = $1, updated_at = NOW() WHERE id = $2`,
      dto.status,
      id,
    );

    return {
      id,
      status: dto.status,
      message: `Billing record marked as ${dto.status}`,
    };
  }
}
