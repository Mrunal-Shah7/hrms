import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorageService } from '../core/file-storage/file-storage.service';
import { TenantInfo } from '../tenant/tenant.interface';
import * as bcrypt from 'bcrypt';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileStorage: FileStorageService,
  ) {}

  async getProfile(tenant: TenantInfo, userId: string) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const users = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          email: string;
          first_name: string;
          last_name: string;
          display_name: string | null;
          phone: string | null;
          photo_url: string | null;
          email_domain_type: string;
          status: string;
          created_at: Date;
          gender: string | null;
          date_of_birth: Date | null;
          marital_status: string | null;
          date_format: string | null;
          timezone: string | null;
          language: string | null;
          profile_picture_visibility: string | null;
        }>
      >(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.display_name, u.phone, u.photo_url,
                u.email_domain_type, u.status, u.created_at,
                ep.gender, ep.date_of_birth, ep.marital_status,
                up.date_format, up.timezone, up.language, up.profile_picture_visibility
         FROM users u
         LEFT JOIN employee_profiles ep ON u.id = ep.user_id
         LEFT JOIN user_preferences up ON u.id = up.user_id
         WHERE u.id = $1`,
        userId,
      );

      if (users.length === 0) throw new NotFoundException('User not found');
      const u = users[0];

      const orgRows = await tx.$queryRawUnsafe<
        Array<{ date_format: string; default_timezone: string; default_currency: string }>
      >(`SELECT date_format, default_timezone, default_currency FROM organization_settings LIMIT 1`);

      const orgDefaults = orgRows[0] ?? {
        date_format: 'DD-MMM-YYYY',
        default_timezone: 'UTC',
        default_currency: 'USD',
      };

      return {
        id: u.id,
        email: u.email,
        firstName: u.first_name,
        lastName: u.last_name,
        displayName: u.display_name,
        phone: u.phone,
        photoUrl: u.photo_url,
        emailDomainType: u.email_domain_type,
        status: u.status,
        createdAt: u.created_at,
        personal: {
          gender: u.gender,
          dateOfBirth: u.date_of_birth,
          maritalStatus: u.marital_status,
        },
        preferences: {
          dateFormat: u.date_format,
          timezone: u.timezone,
          language: u.language ?? 'en',
          profilePictureVisibility: u.profile_picture_visibility ?? 'everyone',
        },
        orgDefaults: {
          dateFormat: orgDefaults.date_format,
          timezone: orgDefaults.default_timezone,
          currency: orgDefaults.default_currency,
        },
      };
    });
  }

  async updateProfile(
    tenant: TenantInfo,
    userId: string,
    dto: {
      firstName?: string;
      lastName?: string;
      displayName?: string;
      phone?: string;
      gender?: string;
      dateOfBirth?: string;
      maritalStatus?: string;
    },
  ) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const updates: string[] = [];
      const params: unknown[] = [];
      let p = 1;

      if (dto.firstName !== undefined) {
        updates.push(`first_name = $${p++}`);
        params.push(dto.firstName);
      }
      if (dto.lastName !== undefined) {
        updates.push(`last_name = $${p++}`);
        params.push(dto.lastName);
      }
      if (dto.displayName !== undefined) {
        updates.push(`display_name = $${p++}`);
        params.push(dto.displayName);
      }
      if (dto.phone !== undefined) {
        updates.push(`phone = $${p++}`);
        params.push(dto.phone);
      }

      if (updates.length > 0) {
        params.push(userId);
        await tx.$executeRawUnsafe(
          `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${p}`,
          ...params,
        );
      }

      const epFields: string[] = [];
      const epParams: unknown[] = [];
      let ep = 1;
      if (dto.gender !== undefined) {
        epFields.push(`gender = $${ep++}`);
        epParams.push(dto.gender);
      }
      if (dto.dateOfBirth !== undefined) {
        epFields.push(`date_of_birth = $${ep++}::date`);
        epParams.push(dto.dateOfBirth);
      }
      if (dto.maritalStatus !== undefined) {
        epFields.push(`marital_status = $${ep++}`);
        epParams.push(dto.maritalStatus);
      }

      if (epFields.length > 0) {
        const exists = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM employee_profiles WHERE user_id = $1`,
          userId,
        );
        if (exists.length > 0) {
          epParams.push(userId);
          await tx.$executeRawUnsafe(
            `UPDATE employee_profiles SET ${epFields.join(', ')}, updated_at = NOW() WHERE user_id = $${ep}`,
            ...epParams,
          );
        }
      }

      return this.getProfile(tenant, userId);
    });
  }

  async uploadPhoto(
    tenant: TenantInfo,
    userId: string,
    file: { buffer: Buffer; mimetype: string; size: number; originalname?: string },
  ): Promise<{ photoUrl: string }> {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file provided');
    }
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Only image files (JPEG, PNG, WebP) are allowed');
    }
    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      throw new BadRequestException('File exceeds maximum size of 5MB');
    }

    const users = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{ photo_url: string | null }>
      >(`SELECT photo_url FROM users WHERE id = $1`, userId);
    });
    if (users.length === 0) throw new NotFoundException('User not found');
    const oldUrl = users[0].photo_url;

    const { url } = await this.fileStorage.upload(
      file.buffer,
      {
        fileName: `profile-${userId}.${this.getExt(file.mimetype)}`,
        originalName: file.originalname ?? 'photo',
        mimeType: file.mimetype,
        fileSize: file.size,
        uploadedBy: userId,
        context: 'profile_photo',
        contextId: userId,
      },
      tenant.schemaName,
    );

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE users SET photo_url = $1, updated_at = NOW() WHERE id = $2`,
        url,
        userId,
      );
    });

    if (oldUrl) {
      const id = this.extractFileIdFromUrl(oldUrl);
      if (id) {
        try {
          await this.fileStorage.delete(id, tenant.schemaName);
        } catch {
          // ignore if file already removed
        }
      }
    }

    return { photoUrl: url };
  }

  async deletePhoto(tenant: TenantInfo, userId: string): Promise<{ message: string }> {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const users = await tx.$queryRawUnsafe<
        Array<{ photo_url: string | null }>
      >(`SELECT photo_url FROM users WHERE id = $1`, userId);
      if (users.length === 0) throw new NotFoundException('User not found');

      const photoUrl = users[0].photo_url;
      if (!photoUrl) {
        throw new BadRequestException('No profile photo to delete');
      }

      const id = this.extractFileIdFromUrl(photoUrl);
      if (id) {
        try {
          await this.fileStorage.delete(id, tenant.schemaName);
        } catch {
          // continue to null the url even if storage delete fails
        }
      }

      await tx.$executeRawUnsafe(
        `UPDATE users SET photo_url = NULL, updated_at = NOW() WHERE id = $1`,
        userId,
      );

      return { message: 'Profile photo deleted' };
    });
  }

  async changePassword(
    tenant: TenantInfo,
    userId: string,
    sessionId: string | undefined,
    dto: { currentPassword: string; newPassword: string },
  ): Promise<{ message: string }> {
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must be different from current password');
    }

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const users = await tx.$queryRawUnsafe<
        Array<{ password_hash: string }>
      >(`SELECT password_hash FROM users WHERE id = $1`, userId);
      if (users.length === 0) throw new NotFoundException('User not found');

      const valid = await bcrypt.compare(dto.currentPassword, users[0].password_hash);
      if (!valid) {
        throw new BadRequestException('Current password is incorrect');
      }

      const hash = await bcrypt.hash(dto.newPassword, 12);

      await tx.$executeRawUnsafe(
        `UPDATE users SET password_hash = $1, must_reset_password = FALSE, updated_at = NOW() WHERE id = $2`,
        hash,
        userId,
      );

      if (sessionId) {
        await tx.$executeRawUnsafe(
          `DELETE FROM user_sessions WHERE user_id = $1 AND id != $2::uuid`,
          userId,
          sessionId,
        );
      } else {
        await tx.$executeRawUnsafe(`DELETE FROM user_sessions WHERE user_id = $1`, userId);
      }

      return {
        message: 'Password changed successfully. Other sessions have been signed out.',
      };
    });
  }

  async getSessions(
    tenant: TenantInfo,
    userId: string,
    currentSessionId: string | undefined,
  ) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          device_info: unknown;
          created_at: Date;
          expires_at: Date;
        }>
      >(
        `SELECT id, device_info, created_at, expires_at
         FROM user_sessions
         WHERE user_id = $1 AND expires_at > NOW()
         ORDER BY created_at DESC`,
        userId,
      );

      const deviceInfo = (d: unknown) => {
        if (d && typeof d === 'object' && 'browser' in d) return d as Record<string, unknown>;
        return {};
      };

      return rows.map((r) => ({
        id: r.id,
        deviceInfo: deviceInfo(r.device_info) ?? {},
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        isCurrent: currentSessionId ? r.id === currentSessionId : false,
      }));
    });
  }

  async revokeSession(
    tenant: TenantInfo,
    userId: string,
    sessionId: string,
    currentSessionId: string | undefined,
  ): Promise<{ message: string }> {
    if (sessionId === currentSessionId) {
      throw new BadRequestException(
        'Cannot revoke your current session. Use logout instead.',
      );
    }

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM user_sessions WHERE id = $1::uuid AND user_id = $2`,
        sessionId,
        userId,
      );
      if (rows.length === 0) {
        throw new NotFoundException('Session not found');
      }

      await tx.$executeRawUnsafe(`DELETE FROM user_sessions WHERE id = $1::uuid`, sessionId);
      return { message: 'Session revoked' };
    });
  }

  async getPreferences(tenant: TenantInfo, userId: string) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const prefs = await tx.$queryRawUnsafe<
        Array<{
          date_format: string | null;
          timezone: string | null;
          language: string | null;
          profile_picture_visibility: string | null;
          new_sign_in_alert: boolean | null;
        }>
      >(
        `SELECT date_format, timezone, language, profile_picture_visibility, new_sign_in_alert
         FROM user_preferences WHERE user_id = $1`,
        userId,
      );

      const orgRows = await tx.$queryRawUnsafe<
        Array<{ date_format: string; default_timezone: string }>
      >(`SELECT date_format, default_timezone FROM organization_settings LIMIT 1`);

      const orgDefaults = orgRows[0] ?? {
        date_format: 'DD-MMM-YYYY',
        default_timezone: 'UTC',
      };

      const p = prefs[0];
      return {
        preferences: {
          dateFormat: p?.date_format ?? null,
          timezone: p?.timezone ?? null,
          language: p?.language ?? 'en',
          profilePictureVisibility: p?.profile_picture_visibility ?? 'everyone',
          newSignInAlert: p?.new_sign_in_alert ?? true,
        },
        orgDefaults: {
          dateFormat: orgDefaults.date_format,
          timezone: orgDefaults.default_timezone,
        },
      };
    });
  }

  async updatePreferences(
    tenant: TenantInfo,
    userId: string,
    dto: {
      dateFormat?: string | null;
      timezone?: string | null;
      language?: string;
      profilePictureVisibility?: string;
      newSignInAlert?: boolean;
    },
  ) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const exists = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM user_preferences WHERE user_id = $1`,
        userId,
      );

      const updates: string[] = [];
      const params: unknown[] = [];
      let p = 1;

      if (dto.dateFormat !== undefined) {
        updates.push(`date_format = $${p++}`);
        params.push(dto.dateFormat);
      }
      if (dto.timezone !== undefined) {
        updates.push(`timezone = $${p++}`);
        params.push(dto.timezone);
      }
      if (dto.language !== undefined) {
        updates.push(`language = $${p++}`);
        params.push(dto.language);
      }
      if (dto.profilePictureVisibility !== undefined) {
        updates.push(`profile_picture_visibility = $${p++}`);
        params.push(dto.profilePictureVisibility);
      }
      if (dto.newSignInAlert !== undefined) {
        updates.push(`new_sign_in_alert = $${p++}`);
        params.push(dto.newSignInAlert);
      }

      if (updates.length === 0) {
        return this.getPreferences(tenant, userId);
      }

      updates.push(`updated_at = NOW()`);

      if (exists.length > 0) {
        params.push(userId);
        await tx.$executeRawUnsafe(
          `UPDATE user_preferences SET ${updates.join(', ')} WHERE user_id = $${p}`,
          ...params,
        );
      } else {
        await tx.$executeRawUnsafe(
          `INSERT INTO user_preferences (id, user_id, date_format, timezone, language, profile_picture_visibility, new_sign_in_alert, created_at, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, $5, $6, NOW(), NOW())`,
          userId,
          dto.dateFormat ?? null,
          dto.timezone ?? null,
          dto.language ?? 'en',
          dto.profilePictureVisibility ?? 'everyone',
          dto.newSignInAlert ?? true,
        );
      }

      return this.getPreferences(tenant, userId);
    });
  }

  async getOrganization(tenant: TenantInfo) {
    const [orgRows, tenantRows] = await Promise.all([
      this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
        return tx.$queryRawUnsafe<
          Array<{
            org_name: string;
            custom_domain: string | null;
            company_email_domain: string | null;
            default_timezone: string;
            date_format: string;
            financial_year_start_month: number;
            default_currency: string;
          }>
        >(
          `SELECT org_name, custom_domain, company_email_domain, default_timezone, date_format, financial_year_start_month, default_currency
           FROM organization_settings LIMIT 1`,
        );
      }),
      this.prisma.withPlatformSchema(async (tx) => {
        return tx.$queryRawUnsafe<
          Array<{
            name: string;
            slug: string;
            custom_domain: string | null;
            subscription_tier: string;
            max_users: number;
            current_user_count: number;
            status: string;
            trial_ends_at: Date | null;
          }>
        >(
          `SELECT name, slug, custom_domain, subscription_tier, max_users, current_user_count, status, trial_ends_at
           FROM tenants WHERE id = $1::uuid`,
          tenant.id,
        );
      }),
    ]);

    const org = orgRows[0];
    const t = tenantRows[0];

    if (!org || !t) {
      throw new NotFoundException('Organization not found');
    }

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];

    return {
      organization: {
        name: t.name,
        slug: t.slug,
        customDomain: t.custom_domain ?? org.custom_domain,
        companyEmailDomain: org.company_email_domain ?? null,
        defaultTimezone: org.default_timezone,
        dateFormat: org.date_format,
        financialYearStartMonth: org.financial_year_start_month,
        defaultCurrency: org.default_currency,
      },
      subscription: {
        tier: t.subscription_tier,
        maxUsers: t.max_users,
        currentUserCount: t.current_user_count,
        status: t.status,
        trialEndsAt: t.trial_ends_at,
      },
    };
  }

  async updateOrganization(
    tenant: TenantInfo,
    userId: string,
    permissions: string[],
    dto: {
      orgName?: string;
      companyEmailDomain?: string;
      defaultTimezone?: string;
      dateFormat?: string;
      financialYearStartMonth?: number;
      defaultCurrency?: string;
    },
  ) {
    const key = 'settings:edit:organization';
    if (!permissions.includes(key)) {
      throw new ForbiddenException({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'You do not have permission to perform this action.',
          details: { required: key },
        },
      });
    }

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const updates: string[] = [];
      const params: unknown[] = [];
      let p = 1;

      if (dto.orgName !== undefined) {
        updates.push(`org_name = $${p++}`);
        params.push(dto.orgName);
      }
      if (dto.companyEmailDomain !== undefined) {
        updates.push(`company_email_domain = $${p++}`);
        params.push(dto.companyEmailDomain);
      }
      if (dto.defaultTimezone !== undefined) {
        updates.push(`default_timezone = $${p++}`);
        params.push(dto.defaultTimezone);
      }
      if (dto.dateFormat !== undefined) {
        updates.push(`date_format = $${p++}`);
        params.push(dto.dateFormat);
      }
      if (dto.financialYearStartMonth !== undefined) {
        updates.push(`financial_year_start_month = $${p++}`);
        params.push(dto.financialYearStartMonth);
      }
      if (dto.defaultCurrency !== undefined) {
        updates.push(`default_currency = $${p++}`);
        params.push(dto.defaultCurrency);
      }

      if (updates.length === 0) {
        return this.getOrganization(tenant);
      }

      await tx.$executeRawUnsafe(
        `UPDATE organization_settings SET ${updates.join(', ')}`,
        ...params,
      );

      if (dto.orgName !== undefined) {
        await this.prisma.withPlatformSchema(async (platformTx) => {
          await platformTx.$executeRawUnsafe(
            `UPDATE tenants SET name = $1, updated_at = NOW() WHERE id = $2::uuid`,
            dto.orgName,
            tenant.id,
          );
        });
      }

      return this.getOrganization(tenant);
    });
  }

  private extractFileIdFromUrl(url: string): string | null {
    const match = /\/api\/files\/download\/([a-f0-9-]+)/i.exec(url);
    return match ? match[1] : null;
  }

  private getExt(mime: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    return map[mime] ?? 'jpg';
  }
}
