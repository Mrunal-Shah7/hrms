import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantProvisioningService } from '../../tenant/tenant-provisioning.service';
import { PlatformEmailService } from '../../core/email/platform-email.service';
import { buildWelcomeEmailHtml } from '../../core/email/templates/welcome-email.template';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { ListTenantsQueryDto } from './dto/list-tenants-query.dto';

@Injectable()
export class PlatformTenantsService {
  private readonly logger = new Logger(PlatformTenantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tenantProvisioning: TenantProvisioningService,
    private readonly platformEmail: PlatformEmailService,
  ) {}

  async list(query: ListTenantsQueryDto) {
    const {
      status,
      tier,
      source,
      search,
      page = 1,
      limit = 20,
      sortBy = 'created_at',
      sortOrder = 'desc',
    } = query;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`t.status = $${paramIndex++}`);
      params.push(status);
    }
    if (tier) {
      conditions.push(`t.subscription_tier = $${paramIndex++}`);
      params.push(tier);
    }
    if (source) {
      conditions.push(`t.registration_source = $${paramIndex++}`);
      params.push(source);
    }
    if (search && search.trim()) {
      conditions.push(
        `(t.name ILIKE $${paramIndex} OR t.slug ILIKE $${paramIndex} OR t.billing_email ILIKE $${paramIndex})`,
      );
      params.push(`%${search.trim()}%`);
      paramIndex++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sortColumn = this.mapSortColumn(sortBy);
    const safeOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const countRows = await this.prisma.queryRaw<{ count: string }>(
      `SELECT COUNT(*)::bigint as count FROM platform.tenants t ${whereClause}`,
      ...params,
    );
    const total = parseInt(countRows[0]?.count ?? '0', 10);

    const offset = (page - 1) * limit;
    const limitParamIndex = paramIndex++;
    const offsetParamIndex = paramIndex;
    params.push(limit, offset);

    const rows = await this.prisma.queryRaw<{
      id: string;
      name: string;
      slug: string;
      subscription_tier: string;
      max_users: number;
      current_user_count: number;
      status: string;
      registration_source: string;
      custom_domain: string | null;
      billing_email: string;
      created_at: Date;
    }>(
      `SELECT id, name, slug, subscription_tier, max_users, current_user_count,
              status, registration_source, custom_domain, billing_email, created_at
       FROM platform.tenants t
       ${whereClause}
       ORDER BY t.${sortColumn} ${safeOrder}
       LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
      ...params,
    );

    const data = rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      subscriptionTier: r.subscription_tier,
      maxUsers: r.max_users,
      currentUserCount: r.current_user_count,
      status: r.status,
      registrationSource: r.registration_source,
      customDomain: r.custom_domain,
      billingEmail: r.billing_email,
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
      name: 'name',
      slug: 'slug',
      created_at: 'created_at',
      status: 'status',
      current_user_count: 'current_user_count',
    };
    return map[sortBy] ?? 'created_at';
  }

  async getById(id: string) {
    const tenantRows = await this.prisma.queryRaw<{
      id: string;
      name: string;
      slug: string;
      custom_domain: string | null;
      schema_name: string;
      subscription_tier: string;
      max_users: number;
      current_user_count: number;
      billing_email: string;
      status: string;
      registration_source: string;
      trial_ends_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, name, slug, custom_domain, schema_name, subscription_tier,
              max_users, current_user_count, billing_email, status,
              registration_source, trial_ends_at, created_at, updated_at
       FROM platform.tenants WHERE id = $1 LIMIT 1`,
      id,
    );

    if (tenantRows.length === 0) {
      throw new NotFoundException('Tenant not found');
    }

    const t = tenantRows[0];
    const schemaName = t.schema_name;
    const billingEmail = t.billing_email;

    const [usage, billingHistory, adminAccount, registration] = await Promise.all([
      this.getUsageStats(schemaName),
      this.getBillingHistory(id),
      this.getAdminAccount(schemaName, billingEmail),
      this.getRegistrationInfo(id),
    ]);

    return {
      tenant: {
        id: t.id,
        name: t.name,
        slug: t.slug,
        customDomain: t.custom_domain,
        schemaName: t.schema_name,
        subscriptionTier: t.subscription_tier,
        maxUsers: t.max_users,
        currentUserCount: t.current_user_count,
        billingEmail: t.billing_email,
        status: t.status,
        registrationSource: t.registration_source,
        trialEndsAt: t.trial_ends_at,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      },
      usage,
      adminAccount,
      billingHistory,
      registration,
    };
  }

  private async getUsageStats(schemaName: string) {
    let activeUsers = 0;
    let storageUsedBytes = 0;

    try {
      const userRows = await this.prisma.queryRaw<{ count: string }>(
        `SELECT COUNT(*)::bigint as count FROM "${schemaName}".users WHERE status = 'active'`,
      );
      activeUsers = parseInt(userRows[0]?.count ?? '0', 10);

      const storageRows = await this.prisma.queryRaw<{ total: string }>(
        `SELECT COALESCE(SUM(file_size), 0)::bigint as total FROM "${schemaName}".file_storage`,
      );
      storageUsedBytes = parseInt(storageRows[0]?.total ?? '0', 10);
    } catch {
      // Schema might not have file_storage or other tables
    }

    const formatBytes = (bytes: number) => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    };

    return {
      activeUsers,
      storageUsedBytes,
      storageUsedFormatted: formatBytes(storageUsedBytes),
    };
  }

  private async getBillingHistory(tenantId: string) {
    const rows = await this.prisma.queryRaw<{
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
      `SELECT id, period_start, period_end, user_count, per_user_rate, tier,
              total_amount, status, created_at
       FROM platform.billing_records
       WHERE tenant_id = $1
       ORDER BY period_start DESC
       LIMIT 10`,
      tenantId,
    );

    return rows.map((r) => ({
      id: r.id,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      userCount: r.user_count,
      perUserRate: parseFloat(r.per_user_rate),
      tier: r.tier,
      totalAmount: parseFloat(r.total_amount),
      status: r.status,
      createdAt: r.created_at,
    }));
  }

  private async getAdminAccount(schemaName: string, billingEmail: string) {
    try {
      const rows = await this.prisma.queryRaw<{
        id: string;
        email: string;
        first_name: string;
        last_name: string;
        status: string;
        last_login_at: Date | null;
      }>(
        `SELECT id, email, first_name, last_name, status, last_login_at
         FROM "${schemaName}".users
         WHERE email = $1
         LIMIT 1`,
        billingEmail,
      );

      if (rows.length === 0) {
        const adminRoleRows = await this.prisma.queryRaw<{ id: string }>(
          `SELECT id FROM "${schemaName}".roles WHERE name = 'Admin' LIMIT 1`,
        );
        if (adminRoleRows.length > 0) {
          const userRows = await this.prisma.queryRaw<{
            u_id: string;
            u_email: string;
            u_first_name: string;
            u_last_name: string;
            u_status: string;
            u_last_login_at: Date | null;
          }>(
            `SELECT u.id as u_id, u.email as u_email, u.first_name as u_first_name,
                    u.last_name as u_last_name, u.status as u_status, u.last_login_at as u_last_login_at
             FROM "${schemaName}".users u
             JOIN "${schemaName}".user_roles ur ON u.id = ur.user_id
             JOIN "${schemaName}".roles r ON ur.role_id = r.id
             WHERE r.name = 'Admin'
             LIMIT 1`,
          );
          if (userRows.length > 0) {
            const u = userRows[0];
            return {
              id: u.u_id,
              email: u.u_email,
              firstName: u.u_first_name,
              lastName: u.u_last_name,
              status: u.u_status,
              lastLoginAt: u.u_last_login_at,
            };
          }
        }
        return null;
      }

      const r = rows[0];
      return {
        id: r.id,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        status: r.status,
        lastLoginAt: r.last_login_at,
      };
    } catch {
      return null;
    }
  }

  private async getRegistrationInfo(tenantId: string) {
    const rows = await this.prisma.queryRaw<{
      id: string;
      status: string;
      created_at: Date;
      verified_at: Date | null;
      provisioned_at: Date | null;
    }>(
      `SELECT id, status, created_at, verified_at, provisioned_at
       FROM platform.registration_requests
       WHERE tenant_id = $1 LIMIT 1`,
      tenantId,
    );

    if (rows.length === 0) return null;

    const r = rows[0];
    return {
      id: r.id,
      status: r.status,
      source: 'self_service' as const,
      createdAt: r.created_at,
      verifiedAt: r.verified_at,
      provisionedAt: r.provisioned_at,
    };
  }

  async create(dto: CreateTenantDto) {
    const slugAvailable = await this.checkSlugAvailability(dto.slug);
    if (!slugAvailable) {
      throw new ConflictException('Slug already taken');
    }

    const temporaryPassword =
      dto.temporaryPassword ?? this.generateSecurePassword();
    const adminPasswordHash = await bcrypt.hash(temporaryPassword, 12);

    try {
      const result = await this.tenantProvisioning.provision({
        name: dto.organizationName,
        slug: dto.slug,
        billingEmail: dto.billingEmail,
        subscriptionTier: dto.subscriptionTier,
        maxUsers: dto.maxUsers,
        customDomain: dto.customDomain,
        registrationSource: 'super_admin',
        adminName: dto.adminName,
        adminEmail: dto.adminEmail,
        adminPasswordHash,
      });

      const frontendUrl = this.config.get<string>(
        'FRONTEND_URL',
        'http://localhost:3000',
      );
      const loginUrl = `${frontendUrl}/login`;

      const html = buildWelcomeEmailHtml({
        adminName: dto.adminName,
        organizationName: dto.organizationName,
        loginUrl,
        username: dto.adminEmail,
        temporaryPassword,
      });

      await this.platformEmail.send(
        dto.adminEmail,
        `Welcome to HRMS Platform — ${dto.organizationName} is ready!`,
        html,
      );

      const tenantRows = await this.prisma.queryRaw<{
        id: string;
        name: string;
        slug: string;
        schema_name: string;
        subscription_tier: string;
        max_users: number;
        status: string;
      }>(
        `SELECT id, name, slug, schema_name, subscription_tier, max_users, status
         FROM platform.tenants WHERE id = $1 LIMIT 1`,
        result.tenantId,
      );

      const tenant = tenantRows[0];

      this.logger.log(
        `Tenant provisioned by super admin: ${dto.slug} (${result.tenantId})`,
      );

      return {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          schemaName: tenant.schema_name,
          subscriptionTier: tenant.subscription_tier,
          maxUsers: tenant.max_users,
          status: tenant.status,
        },
        adminCredentials: {
          email: dto.adminEmail,
          temporaryPassword,
        },
        message: 'Tenant provisioned successfully. Welcome email sent.',
      };
    } catch (error) {
      this.logger.error(
        `Super admin tenant provisioning failed: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  private generateSecurePassword(): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    const special = '!@#$%&*';
    const all = upper + lower + digits + special;

    let pwd = '';
    pwd += upper[crypto.randomInt(0, upper.length)];
    pwd += upper[crypto.randomInt(0, upper.length)];
    pwd += lower[crypto.randomInt(0, lower.length)];
    pwd += lower[crypto.randomInt(0, lower.length)];
    pwd += digits[crypto.randomInt(0, digits.length)];
    pwd += digits[crypto.randomInt(0, digits.length)];
    pwd += special[crypto.randomInt(0, special.length)];
    pwd += special[crypto.randomInt(0, special.length)];
    for (let i = 0; i < 4; i++) {
      pwd += all[crypto.randomInt(0, all.length)];
    }
    return pwd
      .split('')
      .sort(() => crypto.randomInt(0, 2) - 1)
      .join('');
  }

  private async checkSlugAvailability(slug: string): Promise<boolean> {
    const inTenants = await this.prisma.queryRaw<{ n: number }>(
      `SELECT 1 as n FROM platform.tenants WHERE slug = $1 LIMIT 1`,
      slug,
    );
    if (inTenants.length > 0) return false;

    const inReg = await this.prisma.queryRaw<{ n: number }>(
      `SELECT 1 as n FROM platform.registration_requests
       WHERE slug = $1 AND status IN ('pending', 'verified') LIMIT 1`,
      slug,
    );
    return inReg.length > 0 ? false : true;
  }

  async update(id: string, dto: UpdateTenantDto) {
    const tenantRows = await this.prisma.queryRaw<{
      id: string;
      current_user_count: number;
      custom_domain: string | null;
    }>(`SELECT id, current_user_count, custom_domain FROM platform.tenants WHERE id = $1 LIMIT 1`, id);

    if (tenantRows.length === 0) {
      throw new NotFoundException('Tenant not found');
    }

    const tenant = tenantRows[0];

    if (dto.maxUsers !== undefined && dto.maxUsers < tenant.current_user_count) {
      throw new BadRequestException(
        `Cannot set max users below current user count (${tenant.current_user_count})`,
      );
    }

    if (dto.customDomain !== undefined && dto.customDomain.trim()) {
      const existing = await this.prisma.queryRaw<{ n: number }>(
        `SELECT 1 as n FROM platform.tenants
         WHERE custom_domain = $1 AND id != $2 LIMIT 1`,
        dto.customDomain.trim(),
        id,
      );
      if (existing.length > 0) {
        throw new ConflictException('Custom domain already in use');
      }
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (dto.name !== undefined) {
      updates.push(`name = $${idx++}`);
      params.push(dto.name);
    }
    if (dto.subscriptionTier !== undefined) {
      updates.push(`subscription_tier = $${idx++}`);
      params.push(dto.subscriptionTier);
    }
    if (dto.maxUsers !== undefined) {
      updates.push(`max_users = $${idx++}`);
      params.push(dto.maxUsers);
    }
    if (dto.customDomain !== undefined) {
      updates.push(`custom_domain = $${idx++}`);
      params.push(dto.customDomain.trim() || null);
    }

    if (updates.length === 0) {
      const t = await this.prisma.queryRaw<Record<string, unknown>>(
        `SELECT * FROM platform.tenants WHERE id = $1 LIMIT 1`,
        id,
      );
      return this.mapTenantRow(t[0]);
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    await this.prisma.executeRaw(
      `UPDATE platform.tenants SET ${updates.join(', ')} WHERE id = $${idx}`,
      ...params,
    );

    const updated = await this.prisma.queryRaw<Record<string, unknown>>(
      `SELECT * FROM platform.tenants WHERE id = $1 LIMIT 1`,
      id,
    );
    return this.mapTenantRow(updated[0]);
  }

  private mapTenantRow(r: Record<string, unknown> | undefined) {
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      customDomain: r.custom_domain,
      schemaName: r.schema_name,
      subscriptionTier: r.subscription_tier,
      maxUsers: r.max_users,
      currentUserCount: r.current_user_count,
      billingEmail: r.billing_email,
      status: r.status,
      registrationSource: r.registration_source,
      trialEndsAt: r.trial_ends_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async suspend(id: string) {
    const rows = await this.prisma.queryRaw<{ id: string; status: string; name: string }>(
      `SELECT id, status, name FROM platform.tenants WHERE id = $1 LIMIT 1`,
      id,
    );
    if (rows.length === 0) throw new NotFoundException('Tenant not found');
    const t = rows[0];
    if (t.status === 'suspended') {
      throw new BadRequestException('Tenant is already suspended');
    }
    if (t.status === 'cancelled') {
      throw new BadRequestException('Cannot suspend a cancelled tenant');
    }
    await this.prisma.executeRaw(
      `UPDATE platform.tenants SET status = 'suspended', updated_at = NOW() WHERE id = $1`,
      id,
    );
    return {
      message:
        'Tenant suspended. All tenant-level access is now blocked.',
    };
  }

  async reactivate(id: string) {
    const rows = await this.prisma.queryRaw<{ id: string; status: string }>(
      `SELECT id, status FROM platform.tenants WHERE id = $1 LIMIT 1`,
      id,
    );
    if (rows.length === 0) throw new NotFoundException('Tenant not found');
    if (rows[0].status !== 'suspended') {
      throw new BadRequestException('Only suspended tenants can be reactivated');
    }
    await this.prisma.executeRaw(
      `UPDATE platform.tenants SET status = 'active', updated_at = NOW() WHERE id = $1`,
      id,
    );
    return {
      message: 'Tenant reactivated. Access restored.',
    };
  }

  /**
   * Recalculate current_user_count from actual user count in tenant schema.
   * Use for manual correction or daily cron to fix drift.
   */
  async recountUsers(tenantId: string): Promise<void> {
    const rows = await this.prisma.queryRaw<{ schema_name: string }>(
      `SELECT schema_name FROM platform.tenants WHERE id = $1 AND status != 'cancelled' LIMIT 1`,
      tenantId,
    );
    if (rows.length === 0) return;

    const schemaName = rows[0].schema_name;
    const countRows = await this.prisma.queryRaw<{ count: string }>(
      `SELECT COUNT(*)::bigint as count FROM "${schemaName}".users WHERE status != 'archived'`,
    );
    const count = parseInt(countRows[0]?.count ?? '0', 10);

    await this.prisma.executeRaw(
      `UPDATE platform.tenants SET current_user_count = $1, updated_at = NOW() WHERE id = $2`,
      count,
      tenantId,
    );
    this.logger.debug(`Recounted users for tenant ${tenantId}: ${count}`);
  }

  async cancel(id: string) {
    const rows = await this.prisma.queryRaw<{ id: string; status: string }>(
      `SELECT id, status FROM platform.tenants WHERE id = $1 LIMIT 1`,
      id,
    );
    if (rows.length === 0) throw new NotFoundException('Tenant not found');
    if (rows[0].status === 'cancelled') {
      throw new BadRequestException('Tenant is already cancelled');
    }
    await this.prisma.executeRaw(
      `UPDATE platform.tenants SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      id,
    );
    return {
      message:
        'Tenant cancelled. All access is permanently blocked.',
    };
  }
}
