import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantProvisioningService } from '../../tenant/tenant-provisioning.service';
import { PlatformEmailService } from '../../core/email/platform-email.service';
import { buildWelcomeEmailHtml } from '../../core/email/templates/welcome-email.template';
import { ListRegistrationsQueryDto } from './dto';

@Injectable()
export class PlatformRegistrationsService {
  private readonly logger = new Logger(PlatformRegistrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tenantProvisioning: TenantProvisioningService,
    private readonly platformEmail: PlatformEmailService,
  ) {}

  async list(query: ListRegistrationsQueryDto) {
    const {
      status,
      search,
      page = 1,
      limit = 20,
      sortBy = 'created_at',
      sortOrder = 'desc',
    } = query;

    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`r.status = $${paramIndex++}`);
      params.push(status);
    }
    if (search && search.trim()) {
      conditions.push(
        `(r.organization_name ILIKE $${paramIndex} OR r.admin_email ILIKE $${paramIndex})`,
      );
      params.push(`%${search.trim()}%`);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');
    const sortColumn = this.mapSortColumn(sortBy);
    const safeOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const countRows = await this.prisma.queryRaw<{ count: string }>(
      `SELECT COUNT(*)::bigint as count FROM platform.registration_requests r
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
      organization_name: string;
      slug: string;
      admin_name: string;
      admin_email: string;
      subscription_tier: string;
      max_users: number;
      email_verified: boolean;
      status: string;
      tenant_id: string | null;
      created_at: Date;
      verified_at: Date | null;
      provisioned_at: Date | null;
    }>(
      `SELECT r.id, r.organization_name, r.slug, r.admin_name, r.admin_email,
              r.subscription_tier, r.max_users, r.email_verified, r.status,
              r.tenant_id, r.created_at, r.verified_at, r.provisioned_at
       FROM platform.registration_requests r
       LEFT JOIN platform.tenants t ON r.tenant_id = t.id
       WHERE ${whereClause}
       ORDER BY r.${sortColumn} ${safeOrder}
       LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
      ...params,
    );

    const data = rows.map((r) => ({
      id: r.id,
      organizationName: r.organization_name,
      slug: r.slug,
      adminName: r.admin_name,
      adminEmail: r.admin_email,
      subscriptionTier: r.subscription_tier,
      maxUsers: r.max_users,
      emailVerified: r.email_verified,
      status: r.status,
      tenantId: r.tenant_id,
      createdAt: r.created_at,
      verifiedAt: r.verified_at,
      provisionedAt: r.provisioned_at,
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
      organization_name: 'organization_name',
      status: 'status',
    };
    return map[sortBy] ?? 'created_at';
  }

  async retry(id: string) {
    const rows = await this.prisma.queryRaw<{
      id: string;
      status: string;
      organization_name: string;
      slug: string;
      admin_name: string;
      admin_email: string;
      admin_password_hash: string;
      subscription_tier: string;
      max_users: number;
    }>(
      `SELECT id, status, organization_name, slug, admin_name, admin_email,
              admin_password_hash, subscription_tier, max_users
       FROM platform.registration_requests WHERE id = $1 LIMIT 1`,
      id,
    );

    if (rows.length === 0) {
      throw new NotFoundException('Registration request not found');
    }

    const reg = rows[0];
    if (reg.status !== 'failed') {
      throw new BadRequestException(
        'Only failed registrations can be retried',
      );
    }

    await this.prisma.executeRaw(
      `UPDATE platform.registration_requests SET status = 'verified' WHERE id = $1`,
      id,
    );

    try {
      const slugTaken = await this.checkSlugTakenInTenants(reg.slug);
      const finalSlug = slugTaken
        ? `${reg.slug}-${crypto.randomBytes(3).toString('hex')}`
        : reg.slug;
      if (slugTaken) {
        this.logger.log(`Slug race: ${reg.slug} taken, using ${finalSlug}`);
      }

      const result = await this.tenantProvisioning.provision({
        name: reg.organization_name,
        slug: finalSlug,
        billingEmail: reg.admin_email,
        subscriptionTier: reg.subscription_tier as 'standard' | 'with_recruitment',
        maxUsers: reg.max_users,
        registrationSource: 'self_service',
        adminName: reg.admin_name,
        adminEmail: reg.admin_email,
        adminPasswordHash: reg.admin_password_hash,
      });

      await this.prisma.executeRaw(
        `UPDATE platform.registration_requests
         SET status = 'provisioned', tenant_id = $1, provisioned_at = NOW()
         WHERE id = $2`,
        result.tenantId,
        id,
      );

      const frontendUrl = this.config.get<string>(
        'FRONTEND_URL',
        'http://localhost:3000',
      );
      const loginUrl = `${frontendUrl}/login`;

      const html = buildWelcomeEmailHtml({
        adminName: reg.admin_name,
        organizationName: reg.organization_name,
        loginUrl,
        username: reg.admin_email,
      });

      await this.platformEmail.send(
        reg.admin_email,
        `Welcome to HRMS Platform — ${reg.organization_name} is ready!`,
        html,
      );

      this.logger.log(
        `Provisioning retry successful: ${reg.slug} (${result.tenantId})`,
      );

      return {
        registrationId: id,
        tenantId: result.tenantId,
        status: 'provisioned',
        message: 'Provisioning retry successful. Welcome email sent.',
      };
    } catch (error) {
      this.logger.error(
        `Provisioning retry failed for ${reg.slug}: ${(error as Error).message}`,
      );
      await this.prisma.executeRaw(
        `UPDATE platform.registration_requests SET status = 'failed' WHERE id = $1`,
        id,
      );
      throw new BadRequestException({
        code: 'PROVISIONING_FAILED',
        message: `Provisioning retry failed: ${(error as Error).message}`,
      });
    }
  }

  private async checkSlugTakenInTenants(slug: string): Promise<boolean> {
    const rows = await this.prisma.queryRaw<{ n: number }>(
      `SELECT 1 as n FROM platform.tenants WHERE slug = $1 LIMIT 1`,
      slug,
    );
    return rows.length > 0;
  }

  async resendVerification(id: string) {
    const rows = await this.prisma.queryRaw<{
      id: string;
      status: string;
      admin_email: string;
      admin_name: string;
      organization_name: string;
    }>(
      `SELECT id, status, admin_email, admin_name, organization_name
       FROM platform.registration_requests WHERE id = $1 LIMIT 1`,
      id,
    );

    if (rows.length === 0) {
      throw new NotFoundException('Registration request not found');
    }

    const reg = rows[0];
    if (reg.status !== 'pending') {
      throw new BadRequestException(
        'Verification email can only be resent for pending registrations',
      );
    }

    const newToken = crypto.randomUUID();

    await this.prisma.executeRaw(
      `UPDATE platform.registration_requests
       SET email_verification_token = $1, created_at = NOW()
       WHERE id = $2`,
      newToken,
      id,
    );

    const frontendUrl = this.config.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );
    const verifyUrl = `${frontendUrl}/register/verify?token=${newToken}`;

    const html = `
      <div style="font-family: Inter, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #011552; margin-bottom: 16px;">Verify your email</h2>
        <p>Hi ${reg.admin_name},</p>
        <p>You registered <strong>${reg.organization_name}</strong> on the HRMS Platform. Click the button below to verify your email and activate your organization.</p>
        <div style="margin: 24px 0;">
          <a href="${verifyUrl}" style="display: inline-block; background: #011552; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">Verify Email Address</a>
        </div>
        <p style="font-size: 14px; color: #71717a;">Or copy this link: <a href="${verifyUrl}">${verifyUrl}</a></p>
        <p style="color: #71717a; font-size: 14px;">This link expires in 24 hours.</p>
      </div>
    `;

    await this.platformEmail.send(
      reg.admin_email,
      'Verify your email — HRMS Platform',
      html,
    );

    this.logger.log(`Verification email resent: ${reg.admin_email}`);

    return {
      message: `Verification email resent to ${reg.admin_email}`,
    };
  }
}
