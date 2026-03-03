import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PlatformJwtPayload } from './strategies/platform-jwt.strategy';

@Injectable()
export class PlatformAuthService {
  private readonly logger = new Logger(PlatformAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string, deviceInfo: Record<string, unknown>) {
    const admins = await this.prisma.queryRaw<any>(
      `SELECT id, email, password_hash, name, is_active FROM platform.super_admins WHERE email = $1 LIMIT 1`,
      email,
    );

    if (admins.length === 0) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const admin = admins[0];

    if (!admin.is_active) {
      throw new UnauthorizedException('Your account has been deactivated');
    }

    const passwordValid = await bcrypt.compare(password, admin.password_hash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.generateTokens(admin.id);

    const refreshTokenHash = await bcrypt.hash(tokens.refreshToken, 10);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.executeRaw(
      `INSERT INTO platform.super_admin_sessions (id, super_admin_id, refresh_token_hash, device_info, expires_at, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3::jsonb, $4::timestamptz, NOW())`,
      admin.id,
      refreshTokenHash,
      JSON.stringify(deviceInfo),
      expiresAt.toISOString(),
    );

    await this.prisma.executeRaw(
      `UPDATE platform.super_admins SET last_login_at = NOW() WHERE id = $1`,
      admin.id,
    );

    this.logger.log(`Super admin logged in: ${email}`);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      superAdmin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
      },
    };
  }

  async refresh(refreshToken: string) {
    const sessions = await this.prisma.queryRaw<any>(
      `SELECT id, super_admin_id, refresh_token_hash FROM platform.super_admin_sessions WHERE expires_at > NOW()`,
    );

    let matchedSession: (typeof sessions)[0] | null = null;
    for (const session of sessions) {
      const isMatch = await bcrypt.compare(refreshToken, session.refresh_token_hash);
      if (isMatch) {
        matchedSession = session;
        break;
      }
    }

    if (!matchedSession) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const admins = await this.prisma.queryRaw<any>(
      `SELECT id, is_active FROM platform.super_admins WHERE id = $1 LIMIT 1`,
      matchedSession.super_admin_id,
    );

    if (admins.length === 0 || !admins[0].is_active) {
      await this.prisma.executeRaw(
        `DELETE FROM platform.super_admin_sessions WHERE id = $1`,
        matchedSession.id,
      );
      throw new UnauthorizedException('Account deactivated');
    }

    await this.prisma.executeRaw(
      `DELETE FROM platform.super_admin_sessions WHERE id = $1`,
      matchedSession.id,
    );

    const tokens = await this.generateTokens(matchedSession.super_admin_id);

    const newRefreshHash = await bcrypt.hash(tokens.refreshToken, 10);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.executeRaw(
      `INSERT INTO platform.super_admin_sessions (id, super_admin_id, refresh_token_hash, device_info, expires_at, created_at)
       VALUES (gen_random_uuid(), $1, $2, '{}'::jsonb, $3::timestamptz, NOW())`,
      matchedSession.super_admin_id,
      newRefreshHash,
      expiresAt.toISOString(),
    );

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async logout(superAdminId: string, refreshToken?: string) {
    if (refreshToken) {
      const sessions = await this.prisma.queryRaw<any>(
        `SELECT id, refresh_token_hash FROM platform.super_admin_sessions WHERE super_admin_id = $1`,
        superAdminId,
      );

      for (const session of sessions) {
        const isMatch = await bcrypt.compare(refreshToken, session.refresh_token_hash);
        if (isMatch) {
          await this.prisma.executeRaw(
            `DELETE FROM platform.super_admin_sessions WHERE id = $1`,
            session.id,
          );
          break;
        }
      }
    } else {
      await this.prisma.executeRaw(
        `DELETE FROM platform.super_admin_sessions WHERE super_admin_id = $1`,
        superAdminId,
      );
    }

    this.logger.log(`Super admin logged out: ${superAdminId}`);
  }

  async forgotPassword(email: string) {
    const admins = await this.prisma.queryRaw<any>(
      `SELECT id, email, name FROM platform.super_admins WHERE email = $1 AND is_active = TRUE LIMIT 1`,
      email,
    );

    if (admins.length === 0) {
      this.logger.warn(`Forgot password attempted for non-existent/inactive email: ${email}`);
      return { message: 'If an account exists with this email, an OTP has been sent.' };
    }

    const admin = admins[0];

    await this.prisma.executeRaw(
      `UPDATE platform.super_admin_otps SET used = TRUE WHERE super_admin_id = $1 AND used = FALSE`,
      admin.id,
    );

    const otp = this.generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.prisma.executeRaw(
      `INSERT INTO platform.super_admin_otps (id, super_admin_id, otp_hash, expires_at, used, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3::timestamptz, FALSE, NOW())`,
      admin.id,
      otpHash,
      expiresAt.toISOString(),
    );

    await this.sendOtpEmail(admin.email, admin.name, otp);

    this.logger.log(`OTP sent to super admin: ${email}`);

    return { message: 'If an account exists with this email, an OTP has been sent.' };
  }

  async verifyOtp(email: string, otp: string) {
    const admins = await this.prisma.queryRaw<any>(
      `SELECT id FROM platform.super_admins WHERE email = $1 AND is_active = TRUE LIMIT 1`,
      email,
    );

    if (admins.length === 0) {
      throw new BadRequestException('Invalid OTP');
    }

    const adminId = admins[0].id;

    const otps = await this.prisma.queryRaw<any>(
      `SELECT id, otp_hash FROM platform.super_admin_otps
       WHERE super_admin_id = $1 AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 5`,
      adminId,
    );

    let matchedOtp: (typeof otps)[0] | null = null;
    for (const record of otps) {
      const isMatch = await bcrypt.compare(otp, record.otp_hash);
      if (isMatch) {
        matchedOtp = record;
        break;
      }
    }

    if (!matchedOtp) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    await this.prisma.executeRaw(
      `UPDATE platform.super_admin_otps SET used = TRUE WHERE id = $1`,
      matchedOtp.id,
    );

    const resetToken = this.jwtService.sign(
      { superAdminId: adminId, purpose: 'password_reset', type: 'platform' } as object,
      {
        secret: this.config.getOrThrow<string>('PLATFORM_JWT_ACCESS_SECRET'),
        expiresIn: '15m',
      },
    );

    return { resetToken };
  }

  async resetPassword(resetToken: string, newPassword: string) {
    let payload: { superAdminId?: string; purpose?: string; type?: string };
    try {
      payload = this.jwtService.verify(resetToken, {
        secret: this.config.getOrThrow<string>('PLATFORM_JWT_ACCESS_SECRET'),
      }) as typeof payload;
    } catch {
      throw new BadRequestException('Invalid or expired reset token');
    }

    if (payload.purpose !== 'password_reset' || payload.type !== 'platform') {
      throw new BadRequestException('Invalid reset token');
    }

    const adminId = payload.superAdminId;
    if (!adminId) throw new BadRequestException('Invalid reset token');

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.executeRaw(
      `UPDATE platform.super_admins SET password_hash = $1 WHERE id = $2`,
      passwordHash,
      adminId,
    );

    await this.prisma.executeRaw(
      `DELETE FROM platform.super_admin_sessions WHERE super_admin_id = $1`,
      adminId,
    );

    await this.prisma.executeRaw(
      `UPDATE platform.super_admin_otps SET used = TRUE WHERE super_admin_id = $1 AND used = FALSE`,
      adminId,
    );

    this.logger.log(`Password reset completed for super admin: ${adminId}`);

    return {
      message: 'Password reset successfully. Please log in with your new password.',
    };
  }

  async getCurrentAdmin(superAdminId: string) {
    const admins = await this.prisma.queryRaw<any>(
      `SELECT id, email, name, is_active, last_login_at, created_at FROM platform.super_admins WHERE id = $1 LIMIT 1`,
      superAdminId,
    );

    if (admins.length === 0) {
      throw new UnauthorizedException('Admin not found');
    }

    return admins[0];
  }

  private async generateTokens(superAdminId: string) {
    const payload: PlatformJwtPayload = {
      superAdminId,
      type: 'platform',
    };

    const accessToken = this.jwtService.sign(
      payload as object,
      {
        secret: this.config.getOrThrow<string>('PLATFORM_JWT_ACCESS_SECRET'),
        expiresIn: this.config.get('JWT_ACCESS_EXPIRY') ?? '15m',
      },
    );

    const refreshToken = this.jwtService.sign(
      { ...payload, tokenType: 'refresh' } as object,
      {
        secret: this.config.getOrThrow<string>('PLATFORM_JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRY') ?? '7d',
      },
    );

    return { accessToken, refreshToken };
  }

  private generateOtp(): string {
    return crypto.randomInt(100000, 999999).toString();
  }

  private async sendOtpEmail(to: string, name: string, otp: string): Promise<void> {
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
      subject: 'HRMS Platform — Password Reset OTP',
      html: `
        <div style="font-family: Inter, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #011552; margin-bottom: 16px;">Password Reset</h2>
          <p>Hi ${name},</p>
          <p>You requested a password reset for your HRMS Platform admin account. Use the OTP below to proceed:</p>
          <div style="background: #f4f4f5; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #011552;">${otp}</span>
          </div>
          <p style="color: #71717a; font-size: 14px;">This OTP expires in <strong>10 minutes</strong>. If you didn't request this, please ignore this email.</p>
        </div>
      `,
    });
  }
}
