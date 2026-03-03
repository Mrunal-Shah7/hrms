import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TenantProvisioningService } from '../tenant/tenant-provisioning.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tenantProvisioning: TenantProvisioningService,
  ) {}

  async register(data: {
    organizationName: string;
    slug: string;
    adminName: string;
    adminEmail: string;
    password: string;
    subscriptionTier: 'standard' | 'with_recruitment';
    maxUsers: number;
  }) {
    const slugAvailable = await this.checkSlugAvailability(data.slug);
    if (!slugAvailable) {
      throw new ConflictException('This organization slug is already taken. Please choose another.');
    }

    const emailAvailable = await this.checkEmailAvailability(data.adminEmail);
    if (!emailAvailable) {
      throw new ConflictException('This email is already in use. Please use a different email.');
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const emailVerificationToken = crypto.randomUUID();

    const rows = await this.prisma.queryRaw<{ id: string }>(
      `INSERT INTO platform.registration_requests (
        id, organization_name, slug, admin_name, admin_email, admin_password_hash,
        subscription_tier, max_users, email_verification_token, email_verified, status, created_at
      ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, FALSE, 'pending', NOW())
      RETURNING id`,
      data.organizationName,
      data.slug,
      data.adminName,
      data.adminEmail,
      passwordHash,
      data.subscriptionTier,
      data.maxUsers,
      emailVerificationToken,
    );

    const registrationId = rows[0].id;

    await this.sendVerificationEmail({
      adminName: data.adminName,
      adminEmail: data.adminEmail,
      organizationName: data.organizationName,
      token: emailVerificationToken,
    });

    this.logger.log(`Registration created: ${data.slug} (${data.adminEmail})`);

    return {
      message: 'Verification email sent. Please check your inbox to activate your organization.',
      registrationId,
    };
  }

  async verifyEmail(token: string) {
    const rows = await this.prisma.queryRaw<
      { id: string; status: string; created_at: Date; organization_name: string; slug: string; admin_name: string; admin_email: string; admin_password_hash: string; subscription_tier: string; max_users: number }
    >(
      `SELECT id, status, created_at, organization_name, slug, admin_name, admin_email, admin_password_hash, subscription_tier, max_users
       FROM platform.registration_requests WHERE email_verification_token = $1 LIMIT 1`,
      token,
    );

    if (rows.length === 0) {
      throw new NotFoundException('Invalid verification token');
    }

    const reg = rows[0];

    if (reg.status === 'provisioned') {
      const tenantRows = await this.prisma.queryRaw<{ slug: string; tenant_id: string }>(
        `SELECT slug, tenant_id FROM platform.registration_requests WHERE id = $1`,
        reg.id,
      );
      const t = tenantRows[0];
      return {
        status: 'already_provisioned' as const,
        message: 'Your organization was already set up.',
        slug: t?.slug,
        tenantId: t?.tenant_id,
      };
    }

    if (reg.status === 'verified') {
      return {
        status: 'already_verified' as const,
        message: 'Email already verified. Setup may still be in progress.',
      };
    }

    const created = new Date(reg.created_at);
    const expiresAt = new Date(created.getTime() + 24 * 60 * 60 * 1000);
    if (new Date() > expiresAt) {
      throw new BadRequestException('Verification token has expired. Please request a new verification email.');
    }

    await this.prisma.executeRaw(
      `UPDATE platform.registration_requests
       SET email_verified = TRUE, status = 'verified', verified_at = NOW()
       WHERE id = $1`,
      reg.id,
    );

    let finalSlug = reg.slug;
    const slugTaken = await this.checkSlugTakenInTenants(reg.slug);
    if (slugTaken) {
      finalSlug = `${reg.slug}-${crypto.randomBytes(3).toString('hex')}`;
      this.logger.log(`Slug race condition: ${reg.slug} taken, using ${finalSlug}`);
    }

    try {
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
        reg.id,
      );

      await this.sendWelcomeEmail({
        adminName: reg.admin_name,
        adminEmail: reg.admin_email,
        organizationName: reg.organization_name,
      });

      this.logger.log(`Tenant provisioned: ${finalSlug} (${result.tenantId})`);

      return {
        status: 'provisioned' as const,
        message: 'Your organization is ready! You can now log in.',
        slug: finalSlug,
        tenantId: result.tenantId,
      };
    } catch (error) {
      this.logger.error(`Provisioning failed for ${reg.slug}: ${(error as Error).message}`);
      await this.prisma.executeRaw(
        `UPDATE platform.registration_requests SET status = 'failed' WHERE id = $1`,
        reg.id,
      );
      return {
        status: 'failed' as const,
        message: 'Something went wrong while setting up your organization. Our team has been notified. Please try again or contact support.',
      };
    }
  }

  async resendVerification(email: string) {
    const rows = await this.prisma.queryRaw<
      { id: string; admin_name: string; organization_name: string }
    >(
      `SELECT id, admin_name, organization_name FROM platform.registration_requests
       WHERE admin_email = $1 AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      email,
    );

    if (rows.length === 0) {
      return {
        message: 'If a pending registration exists, a new verification email has been sent.',
      };
    }

    const reg = rows[0];
    const newToken = crypto.randomUUID();

    await this.prisma.executeRaw(
      `UPDATE platform.registration_requests
       SET email_verification_token = $1, created_at = NOW()
       WHERE id = $2`,
      newToken,
      reg.id,
    );

    await this.sendVerificationEmail({
      adminName: reg.admin_name,
      adminEmail: email,
      organizationName: reg.organization_name,
      token: newToken,
    });

    this.logger.log(`Verification email resent: ${email}`);

    return {
      message: 'If a pending registration exists, a new verification email has been sent.',
    };
  }

  async checkSlug(slug: string): Promise<{ available: boolean }> {
    const available = await this.checkSlugAvailability(slug);
    return { available };
  }

  async checkEmail(email: string): Promise<{ available: boolean }> {
    const available = await this.checkEmailAvailability(email);
    return { available };
  }

  async updateEmail(registrationId: string, currentEmail: string, newEmail: string) {
    if (newEmail === currentEmail) {
      throw new BadRequestException('New email must be different');
    }

    const rows = (await this.prisma.queryRaw(
      `SELECT id, admin_name, organization_name FROM platform.registration_requests
       WHERE id = $1 AND admin_email = $2 AND status = 'pending' LIMIT 1`,
      registrationId,
      currentEmail,
    )) as { id: string; admin_name: string; organization_name: string }[];

    if (rows.length === 0) {
      throw new NotFoundException('Registration not found or already verified');
    }

    const available = await this.checkEmailAvailability(newEmail);
    if (!available) {
      throw new ConflictException('This email address is already in use');
    }

    const newToken = crypto.randomUUID();
    const reg = rows[0];

    await this.prisma.executeRaw(
      `UPDATE platform.registration_requests
       SET admin_email = $1, email_verification_token = $2, created_at = NOW()
       WHERE id = $3`,
      newEmail,
      newToken,
      reg.id,
    );

    await this.sendVerificationEmail({
      adminName: reg.admin_name,
      adminEmail: newEmail,
      organizationName: reg.organization_name,
      token: newToken,
    });

    this.logger.log(`Registration email updated: ${currentEmail} → ${newEmail}`);

    return { message: 'Verification email sent to new address.' };
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
    if (inReg.length > 0) return false;

    return true;
  }

  private async checkSlugTakenInTenants(slug: string): Promise<boolean> {
    const rows = await this.prisma.queryRaw<{ n: number }>(
      `SELECT 1 as n FROM platform.tenants WHERE slug = $1 LIMIT 1`,
      slug,
    );
    return rows.length > 0;
  }

  private async checkEmailAvailability(email: string): Promise<boolean> {
    const inSuperAdmins = await this.prisma.queryRaw<{ n: number }>(
      `SELECT 1 as n FROM platform.super_admins WHERE email = $1 LIMIT 1`,
      email,
    );
    if (inSuperAdmins.length > 0) return false;

    const inReg = await this.prisma.queryRaw<{ n: number }>(
      `SELECT 1 as n FROM platform.registration_requests
       WHERE admin_email = $1 AND status IN ('pending', 'verified') LIMIT 1`,
      email,
    );
    if (inReg.length > 0) return false;

    // TODO: Optimize — consider a platform.global_emails lookup table for O(1) checks
    const tenants = await this.prisma.queryRaw<{ schema_name: string }>(
      `SELECT schema_name FROM platform.tenants WHERE status != 'cancelled'`,
    );

    for (const t of tenants) {
      try {
        const userRows = await this.prisma.queryRaw<{ n: number }>(
          `SELECT 1 as n FROM "${t.schema_name}".users WHERE email = $1 LIMIT 1`,
          email,
        );
        if (userRows.length > 0) return false;
      } catch {
        continue;
      }
    }

    return true;
  }

  private async sendVerificationEmail(params: {
    adminName: string;
    adminEmail: string;
    organizationName: string;
    token: string;
  }): Promise<void> {
    const nodemailer = require('nodemailer');
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const verifyUrl = `${frontendUrl}/register/verify?token=${params.token}`;

    const transporter = nodemailer.createTransport({
      host: this.config.get<string>('MAIL_HOST'),
      port: parseInt(this.config.get<string>('MAIL_PORT', '587'), 10),
      secure: this.config.get<string>('MAIL_SECURE') === 'true',
      auth: {
        user: this.config.get<string>('MAIL_USER'),
        pass: this.config.get<string>('MAIL_PASSWORD'),
      },
    });

    await transporter.sendMail({
      from: `"HRMS Platform" <${this.config.get<string>('MAIL_FROM')}>`,
      to: params.adminEmail,
      subject: 'Verify your email — HRMS Platform',
      html: `
        <div style="font-family: Inter, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #011552; margin-bottom: 16px;">Verify your email</h2>
          <p>Hi ${params.adminName},</p>
          <p>You registered <strong>${params.organizationName}</strong> on the HRMS Platform. Click the button below to verify your email and activate your organization.</p>
          <div style="margin: 24px 0;">
            <a href="${verifyUrl}" style="display: inline-block; background: #011552; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">Verify Email Address</a>
          </div>
          <p style="font-size: 14px; color: #71717a;">Or copy this link: <a href="${verifyUrl}">${verifyUrl}</a></p>
          <p style="color: #71717a; font-size: 14px;">This link expires in 24 hours.</p>
        </div>
      `,
    });
  }

  private async sendWelcomeEmail(params: {
    adminName: string;
    adminEmail: string;
    organizationName: string;
  }): Promise<void> {
    const nodemailer = require('nodemailer');
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const loginUrl = `${frontendUrl}/login`;

    const transporter = nodemailer.createTransport({
      host: this.config.get<string>('MAIL_HOST'),
      port: parseInt(this.config.get<string>('MAIL_PORT', '587'), 10),
      secure: this.config.get<string>('MAIL_SECURE') === 'true',
      auth: {
        user: this.config.get<string>('MAIL_USER'),
        pass: this.config.get<string>('MAIL_PASSWORD'),
      },
    });

    await transporter.sendMail({
      from: `"HRMS Platform" <${this.config.get<string>('MAIL_FROM')}>`,
      to: params.adminEmail,
      subject: `Welcome to HRMS Platform — ${params.organizationName} is ready!`,
      html: `
        <div style="font-family: Inter, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #011552; margin-bottom: 16px;">Welcome to HRMS Platform!</h2>
          <p>Hi ${params.adminName},</p>
          <p><strong>${params.organizationName}</strong> is now set up and ready to use.</p>
          <p><strong>Login URL:</strong> <a href="${loginUrl}">${loginUrl}</a></p>
          <p><strong>Username:</strong> ${params.adminEmail}</p>
          <p style="color: #71717a; font-size: 14px;">You'll be asked to set a new password on your first login.</p>
          <div style="margin: 24px 0;">
            <a href="${loginUrl}" style="display: inline-block; background: #011552; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">Go to Login</a>
          </div>
        </div>
      `,
    });
  }
}
