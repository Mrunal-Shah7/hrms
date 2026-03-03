import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TenantInfo } from '../tenant/tenant.interface';
import { TenantJwtPayload } from './strategies/tenant-jwt.strategy';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(
    tenant: TenantInfo,
    email: string,
    password: string,
    deviceInfo: Record<string, unknown>,
  ) {
    const trimmedEmail = email?.trim() ?? '';
    const trimmedPassword = password?.trim() ?? '';
    if (!trimmedEmail || !trimmedPassword) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const users = await tx.$queryRawUnsafe<
        { id: string; email: string; password_hash: string; first_name: string; last_name: string; display_name: string | null; photo_url: string | null; email_domain_type: string; status: string; must_reset_password: boolean }[]
      >(
        `SELECT id, email, password_hash, first_name, last_name, display_name, photo_url, email_domain_type, status, must_reset_password
         FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        trimmedEmail,
      );

      if (users.length === 0) {
        throw new UnauthorizedException('Invalid email or password');
      }

      const user = users[0];

      if (user.status !== 'active') {
        throw new UnauthorizedException('Your account is not active. Please contact your administrator.');
      }

      const passwordValid = await bcrypt.compare(trimmedPassword, user.password_hash);
      if (!passwordValid) {
        throw new UnauthorizedException('Invalid email or password');
      }

      const [roles, permissions] = await Promise.all([
        this.loadUserRoles(tx, user.id),
        this.loadUserPermissions(tx, user.id),
      ]);

      const sessionId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const payload: TenantJwtPayload = {
        userId: user.id,
        tenantId: tenant.id,
        schemaName: tenant.schemaName,
        sessionId,
        subscriptionTier: tenant.subscriptionTier,
        roles,
        permissions,
        type: 'tenant',
      };

      const accessToken = this.jwtService.sign(payload as object, {
        secret: this.config.getOrThrow<string>('TENANT_JWT_ACCESS_SECRET'),
        expiresIn: this.config.get('JWT_ACCESS_EXPIRY') ?? '15m',
      });

      const refreshToken = this.jwtService.sign(
        { ...payload, tokenType: 'refresh' } as object,
        {
          secret: this.config.getOrThrow<string>('TENANT_JWT_REFRESH_SECRET'),
          expiresIn: this.config.get('JWT_REFRESH_EXPIRY') ?? '7d',
        },
      );

      const refreshHash = await bcrypt.hash(refreshToken, 10);

      await tx.$executeRawUnsafe(
        `INSERT INTO user_sessions (id, user_id, refresh_token_hash, device_info, expires_at, created_at)
         VALUES ($1::uuid, $2, $3, $4::jsonb, $5::timestamptz, NOW())`,
        sessionId,
        user.id,
        refreshHash,
        JSON.stringify(deviceInfo),
        expiresAt.toISOString(),
      );

      await tx.$executeRawUnsafe(
        `UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
        user.id,
      );

      this.logger.log(`Tenant user logged in: ${email} (${tenant.slug})`);

      return {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          displayName: user.display_name || `${user.first_name} ${user.last_name}`,
          photoUrl: user.photo_url,
          emailDomainType: user.email_domain_type as 'company' | 'external',
          roles,
          permissions,
          mustResetPassword: user.must_reset_password,
        },
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          schemaName: tenant.schemaName,
          subscriptionTier: tenant.subscriptionTier,
        },
      };
    });
  }

  async refresh(tenant: TenantInfo, refreshToken: string) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const sessions = await tx.$queryRawUnsafe<
        { id: string; user_id: string; refresh_token_hash: string }[]
      >(`SELECT id, user_id, refresh_token_hash FROM user_sessions WHERE expires_at > NOW()`);

      let matched: (typeof sessions)[0] | null = null;
      for (const s of sessions) {
        if (await bcrypt.compare(refreshToken, s.refresh_token_hash)) {
          matched = s;
          break;
        }
      }

      if (!matched) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      const users = await tx.$queryRawUnsafe<{ id: string; status: string }[]>(
        `SELECT id, status FROM users WHERE id = $1 LIMIT 1`,
        matched.user_id,
      );

      if (users.length === 0 || users[0].status !== 'active') {
        await tx.$executeRawUnsafe(`DELETE FROM user_sessions WHERE id = $1`, matched.id);
        throw new UnauthorizedException('Account not active');
      }

      await tx.$executeRawUnsafe(`DELETE FROM user_sessions WHERE id = $1`, matched.id);

      const [roles, permissions] = await Promise.all([
        this.loadUserRoles(tx, matched.user_id),
        this.loadUserPermissions(tx, matched.user_id),
      ]);

      const refreshHash = await bcrypt.hash(
        this.jwtService.sign(
          {
            userId: matched.user_id,
            tenantId: tenant.id,
            schemaName: tenant.schemaName,
            roles,
            permissions,
            tokenType: 'refresh',
            type: 'tenant',
          } as object,
          {
            secret: this.config.getOrThrow<string>('TENANT_JWT_REFRESH_SECRET'),
            expiresIn: this.config.get('JWT_REFRESH_EXPIRY') ?? '7d',
          },
        ),
        10,
      );
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const newSessionRows = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO user_sessions (id, user_id, refresh_token_hash, device_info, expires_at, created_at)
         VALUES (gen_random_uuid(), $1, $2, '{}'::jsonb, $3::timestamptz, NOW())
         RETURNING id`,
        matched.user_id,
        refreshHash,
        expiresAt.toISOString(),
      );
      const sessionId = newSessionRows[0].id;

      const payload: TenantJwtPayload = {
        userId: matched.user_id,
        tenantId: tenant.id,
        schemaName: tenant.schemaName,
        sessionId,
        subscriptionTier: tenant.subscriptionTier,
        roles,
        permissions,
        type: 'tenant',
      };

      const accessToken = this.jwtService.sign(payload as object, {
        secret: this.config.getOrThrow<string>('TENANT_JWT_ACCESS_SECRET'),
        expiresIn: this.config.get('JWT_ACCESS_EXPIRY') ?? '15m',
      });

      const newRefresh = this.jwtService.sign({ ...payload, tokenType: 'refresh' } as object, {
        secret: this.config.getOrThrow<string>('TENANT_JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRY') ?? '7d',
      });

      const newRefreshHash = await bcrypt.hash(newRefresh, 10);
      await tx.$executeRawUnsafe(
        `UPDATE user_sessions SET refresh_token_hash = $1 WHERE id = $2`,
        newRefreshHash,
        sessionId,
      );

      return { accessToken, refreshToken: newRefresh };
    });
  }

  async logout(tenant: TenantInfo, userId: string, refreshToken?: string) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      if (refreshToken) {
        const sessions = await tx.$queryRawUnsafe<
          { id: string; refresh_token_hash: string }[]
        >(`SELECT id, refresh_token_hash FROM user_sessions WHERE user_id = $1`, userId);

        for (const s of sessions) {
          if (await bcrypt.compare(refreshToken, s.refresh_token_hash)) {
            await tx.$executeRawUnsafe(`DELETE FROM user_sessions WHERE id = $1`, s.id);
            break;
          }
        }
      } else {
        await tx.$executeRawUnsafe(`DELETE FROM user_sessions WHERE user_id = $1`, userId);
      }
      this.logger.log(`Tenant user logged out: ${userId}`);
    });
  }

  async forgotPassword(tenant: TenantInfo, email: string) {
    const trimmedEmail = email?.trim() ?? '';
    if (!trimmedEmail) {
      throw new BadRequestException('Email is required.');
    }

    const message = { message: 'If an account exists with this email, an OTP has been sent.' as const };
    type EmailPayload = { to: string; firstName: string; orgName: string; otp: string };

    const emailPayload = await this.prisma.withTenantSchema(
      tenant.schemaName,
      async (tx): Promise<EmailPayload | null> => {
        const users = await tx.$queryRawUnsafe<
          { id: string; email: string; first_name: string }[]
        >(`SELECT id, email, first_name FROM users WHERE LOWER(email) = LOWER($1) AND status = 'active' LIMIT 1`, trimmedEmail);

        if (users.length === 0) {
          return null;
        }

        const user = users[0];

        await tx.$executeRawUnsafe(
          `UPDATE password_reset_otps SET used = TRUE WHERE user_id = $1 AND used = FALSE`,
          user.id,
        );

        const otp = crypto.randomInt(100000, 999999).toString();
        const otpHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await tx.$executeRawUnsafe(
          `INSERT INTO password_reset_otps (id, user_id, otp_hash, expires_at, used, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3::timestamptz, FALSE, NOW())`,
          user.id,
          otpHash,
          expiresAt.toISOString(),
        );

        return { to: user.email, firstName: user.first_name, orgName: tenant.name, otp };
      },
    );

    if (!emailPayload) {
      throw new BadRequestException(
        'No account found with this email for this organization. Please check the email and organization slug.',
      );
    }

    await this.sendOtpEmail(emailPayload.to, emailPayload.firstName, emailPayload.orgName, emailPayload.otp);
    this.logger.log(`OTP sent to tenant user: ${trimmedEmail}`);

    return message;
  }

  async verifyOtp(tenant: TenantInfo, email: string, otp: string) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const users = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM users WHERE email = $1 AND status = 'active' LIMIT 1`,
        email,
      );

      if (users.length === 0) {
        throw new BadRequestException('Invalid OTP');
      }

      const userId = users[0].id;

      const otps = await tx.$queryRawUnsafe<{ id: string; otp_hash: string }[]>(
        `SELECT id, otp_hash FROM password_reset_otps
         WHERE user_id = $1 AND used = FALSE AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 5`,
        userId,
      );

      let matched: (typeof otps)[0] | null = null;
      for (const o of otps) {
        if (await bcrypt.compare(otp, o.otp_hash)) {
          matched = o;
          break;
        }
      }

      if (!matched) {
        throw new BadRequestException('Invalid or expired OTP');
      }

      await tx.$executeRawUnsafe(
        `UPDATE password_reset_otps SET used = TRUE WHERE id = $1`,
        matched.id,
      );

      const resetToken = this.jwtService.sign(
        {
          userId,
          tenantId: tenant.id,
          schemaName: tenant.schemaName,
          purpose: 'password_reset',
          type: 'tenant',
        } as object,
        {
          secret: this.config.getOrThrow<string>('TENANT_JWT_ACCESS_SECRET'),
          expiresIn: '15m',
        },
      );

      return { resetToken };
    });
  }

  async resetPassword(resetToken: string, newPassword: string) {
    let payload: { userId?: string; tenantId?: string; schemaName?: string; purpose?: string; type?: string };
    try {
      payload = this.jwtService.verify(resetToken, {
        secret: this.config.getOrThrow<string>('TENANT_JWT_ACCESS_SECRET'),
      }) as typeof payload;
    } catch {
      throw new BadRequestException('Invalid or expired reset token');
    }

    if (payload.purpose !== 'password_reset' || payload.type !== 'tenant') {
      throw new BadRequestException('Invalid reset token');
    }

    const { userId, schemaName } = payload;
    if (!userId || !schemaName) throw new BadRequestException('Invalid reset token');

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.withTenantSchema(schemaName, async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE users SET password_hash = $1, must_reset_password = FALSE, updated_at = NOW() WHERE id = $2`,
        passwordHash,
        userId,
      );

      await tx.$executeRawUnsafe(`DELETE FROM user_sessions WHERE user_id = $1`, userId);

      await tx.$executeRawUnsafe(
        `UPDATE password_reset_otps SET used = TRUE WHERE user_id = $1 AND used = FALSE`,
        userId,
      );
    });

    this.logger.log(`Password reset completed for tenant user: ${userId}`);

    return { message: 'Password reset successfully. Please log in.' };
  }

  async forceChangePassword(tenant: TenantInfo, userId: string, newPassword: string) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const users = await tx.$queryRawUnsafe<{ must_reset_password: boolean }[]>(
        `SELECT must_reset_password FROM users WHERE id = $1 LIMIT 1`,
        userId,
      );

      if (users.length === 0) {
        throw new UnauthorizedException('User not found');
      }

      if (!users[0].must_reset_password) {
        throw new BadRequestException('Password change not required');
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);

      await tx.$executeRawUnsafe(
        `UPDATE users SET password_hash = $1, must_reset_password = FALSE, updated_at = NOW() WHERE id = $2`,
        passwordHash,
        userId,
      );

      this.logger.log(`Forced password change completed for: ${userId}`);

      return { message: 'Password updated successfully.' };
    });
  }

  async reAuthenticate(tenant: TenantInfo, userId: string, password: string) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const users = await tx.$queryRawUnsafe<{ password_hash: string }[]>(
        `SELECT password_hash FROM users WHERE id = $1 LIMIT 1`,
        userId,
      );

      if (users.length === 0) {
        throw new UnauthorizedException('User not found');
      }

      const valid = await bcrypt.compare(password, users[0].password_hash);
      if (!valid) {
        throw new UnauthorizedException('Invalid password');
      }

      const compensationToken = this.jwtService.sign(
        {
          userId,
          tenantId: tenant.id,
          schemaName: tenant.schemaName,
          purpose: 'compensation_access',
          type: 'tenant',
        } as object,
        {
          secret: this.config.getOrThrow<string>('TENANT_JWT_ACCESS_SECRET'),
          expiresIn: '5m',
        },
      );

      return { compensationAccessToken: compensationToken, expiresIn: 300 };
    });
  }

  async getMe(tenant: TenantInfo, userId: string) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const users = await tx.$queryRawUnsafe<
        { id: string; email: string; first_name: string; last_name: string; display_name: string | null; phone: string | null; photo_url: string | null; email_domain_type: string; status: string; must_reset_password: boolean; last_login_at: Date | null }[]
      >(
        `SELECT id, email, first_name, last_name, display_name, phone, photo_url, email_domain_type, status, must_reset_password, last_login_at
         FROM users WHERE id = $1 LIMIT 1`,
        userId,
      );

      if (users.length === 0) {
        throw new UnauthorizedException('User not found');
      }

      const user = users[0];
      const [roles, permissions] = await Promise.all([
        this.loadUserRoles(tx, user.id),
        this.loadUserPermissions(tx, user.id),
      ]);

      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          displayName: user.display_name || `${user.first_name} ${user.last_name}`,
          phone: user.phone,
          photoUrl: user.photo_url,
          emailDomainType: user.email_domain_type as 'company' | 'external',
          status: user.status,
          mustResetPassword: user.must_reset_password,
          lastLoginAt: user.last_login_at,
          roles,
          permissions,
        },
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          schemaName: tenant.schemaName,
          subscriptionTier: tenant.subscriptionTier,
        },
      };
    });
  }

  private async loadUserRoles(tx: { $queryRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown[]> }, userId: string): Promise<string[]> {
    const rows = (await tx.$queryRawUnsafe(
      `SELECT r.name FROM roles r
       JOIN user_roles ur ON r.id = ur.role_id
       WHERE ur.user_id = $1`,
      userId,
    )) as { name: string }[];
    return rows.map((r) => r.name);
  }

  private async loadUserPermissions(tx: { $queryRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown[]> }, userId: string): Promise<string[]> {
    const rows = (await tx.$queryRawUnsafe(
      `SELECT DISTINCT p.module || ':' || p.action || ':' || p.resource as permission_key
       FROM permissions p
       JOIN role_permissions rp ON p.id = rp.permission_id
       JOIN user_roles ur ON rp.role_id = ur.role_id
       WHERE ur.user_id = $1`,
      userId,
    )) as { permission_key: string }[];
    return rows.map((r) => r.permission_key);
  }

  private async sendOtpEmail(to: string, firstName: string, orgName: string, otp: string): Promise<void> {
    const nodemailer = require('nodemailer');

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
      to,
      subject: `Password Reset OTP — ${orgName}`,
      html: `
        <div style="font-family: Inter, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #011552; margin-bottom: 16px;">Password Reset</h2>
          <p>Hi ${firstName},</p>
          <p>You requested a password reset for your ${orgName} account. Use the OTP below to proceed:</p>
          <div style="background: #f4f4f5; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #011552;">${otp}</span>
          </div>
          <p style="color: #71717a; font-size: 14px;">This OTP expires in <strong>10 minutes</strong>. If you didn't request this, please ignore this email.</p>
        </div>
      `,
    });
  }
}
