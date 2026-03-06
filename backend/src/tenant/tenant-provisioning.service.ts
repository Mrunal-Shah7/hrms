import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ProvisionTenantInput,
  ProvisionTenantResult,
} from './tenant.interface';
import {
  DEFAULT_PERMISSIONS,
  DEFAULT_ROLES,
  DEFAULT_LEAVE_TYPES,
  DEFAULT_WORK_SCHEDULE,
  DEFAULT_CANDIDATE_STAGES,
  DEFAULT_NOTIFICATION_SETTINGS,
} from './tenant-seed-data';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);
  private tenantDDL: string;

  constructor(private readonly prisma: PrismaService) {
    this.tenantDDL = fs.readFileSync(
      path.join(process.cwd(), 'prisma', 'tenant-schema.sql'),
      'utf8',
    );
  }

  async provision(input: ProvisionTenantInput): Promise<ProvisionTenantResult> {
    const schemaName = this.sanitizeSchemaName(input.slug);

    this.logger.log(
      `Starting provisioning for: ${input.name} (schema: ${schemaName})`,
    );

    const tenantRows = await this.prisma.queryRaw<{ id: string }>(
      `INSERT INTO platform.tenants (id, name, slug, schema_name, subscription_tier, max_users, billing_email, status, registration_source, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'active', $7, NOW(), NOW())
       RETURNING id`,
      input.name,
      input.slug,
      schemaName,
      input.subscriptionTier,
      input.maxUsers,
      input.billingEmail,
      input.registrationSource,
    );
    const tenantId = tenantRows[0].id;
    this.logger.log(`Step 1: Tenant record created (id: ${tenantId})`);

    try {
      await this.prisma.$transaction(async (tx) => {
        const ddl = this.tenantDDL.replace(/__SCHEMA_NAME__/g, schemaName);
        const sqlWithoutComments = ddl
          .split('\n')
          .filter((line) => !line.trim().startsWith('--'))
          .join('\n');
        const statements = sqlWithoutComments
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        for (const statement of statements) {
          await tx.$executeRawUnsafe(statement + ';');
        }
      });
      this.logger.log(`Step 2-3: Schema "${schemaName}" created with all tables`);

      await this.seedPermissions(schemaName);
      this.logger.log(`Step 4a: Permissions seeded`);

      await this.seedRoles(schemaName);
      this.logger.log(`Step 4b: Roles seeded with permission mappings`);

      await this.seedLeaveTypes(schemaName);
      this.logger.log(`Step 4c: Leave types seeded`);

      await this.seedWorkSchedule(schemaName);
      this.logger.log(`Step 4d: Work schedule seeded`);

      await this.seedTimeTrackerMockConfig(schemaName);
      this.logger.log(`Step 4d2: Time tracker mock integration seeded`);

      await this.seedCandidateStages(schemaName);
      this.logger.log(`Step 4e: Candidate pipeline stages seeded`);

      await this.seedNotificationSettings(schemaName);
      this.logger.log(`Step 4f: Notification settings seeded`);

      await this.seedOrganizationSettings(
        schemaName,
        input.name,
        input.customDomain || null,
        input.adminEmail,
      );
      this.logger.log(`Step 4f: Organization settings seeded`);

      const adminUserId = await this.createAdminUser(
        schemaName,
        input.adminName,
        input.adminEmail,
        input.adminPasswordHash,
      );
      this.logger.log(`Step 5: Admin user created (id: ${adminUserId})`);

      await this.prisma.queryRaw(
        `UPDATE platform.tenants SET current_user_count = 1, updated_at = NOW() WHERE id = $1`,
        tenantId,
      );

      // Step 6: Send welcome email to admin with login credentials
      // TODO (Sprint 1G): Wire EmailService here to send welcome email
      // emailService.sendWelcomeEmail({
      //   to: input.adminEmail,
      //   name: input.adminName,
      //   loginUrl: `${configService.get('FRONTEND_URL')}/login`,
      //   tempPassword: '<original plaintext password passed from caller>',
      // });
      this.logger.warn(
        `⚠️ Welcome email to ${input.adminEmail} skipped — EmailService not yet available (Sprint 1G)`,
      );

      this.logger.log(`✅ Provisioning complete for ${input.name}`);

      return { tenantId, schemaName, adminUserId, slug: input.slug };
    } catch (error) {
      this.logger.error(
        `❌ Provisioning failed for ${input.name}: ${(error as Error).message}`,
      );
      try {
        await this.prisma.executeRaw(
          `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
        );
        await this.prisma.queryRaw(
          `DELETE FROM platform.tenants WHERE id = $1`,
          tenantId,
        );
      } catch (cleanupError) {
        this.logger.error(
          `Cleanup also failed: ${(cleanupError as Error).message}`,
        );
      }
      throw error;
    }
  }

  private async seedPermissions(schemaName: string): Promise<void> {
    for (const perm of DEFAULT_PERMISSIONS) {
      const desc = (perm.description || '').replace(/'/g, "''");
      await this.prisma.executeRaw(
        `INSERT INTO "${schemaName}".permissions (id, module, action, resource, description, created_at)
         VALUES (gen_random_uuid(), '${perm.module}', '${perm.action}', '${perm.resource}', '${desc}', NOW())`,
      );
    }
  }

  private async seedRoles(schemaName: string): Promise<void> {
    for (const roleDef of DEFAULT_ROLES) {
      const desc = (roleDef.description || '').replace(/'/g, "''");
      const roleRows = await this.prisma.queryRaw<{ id: string }>(
        `INSERT INTO "${schemaName}".roles (id, name, description, is_system_role, is_custom, created_at, updated_at)
         VALUES (gen_random_uuid(), '${roleDef.name}', '${desc}', TRUE, FALSE, NOW(), NOW())
         RETURNING id`,
      );
      const roleId = roleRows[0].id;

      if (roleDef.permissions === 'all') {
        await this.prisma.executeRaw(
          `INSERT INTO "${schemaName}".role_permissions (id, role_id, permission_id)
           SELECT gen_random_uuid(), '${roleId}', id FROM "${schemaName}".permissions`,
        );
      } else {
        for (const perm of roleDef.permissions) {
          await this.prisma.executeRaw(
            `INSERT INTO "${schemaName}".role_permissions (id, role_id, permission_id)
             SELECT gen_random_uuid(), '${roleId}', id FROM "${schemaName}".permissions
             WHERE module = '${perm.module}' AND action = '${perm.action}' AND resource = '${perm.resource}'`,
          );
        }
      }
    }
  }

  private async seedLeaveTypes(schemaName: string): Promise<void> {
    for (const lt of DEFAULT_LEAVE_TYPES) {
      const maxDays = lt.maxConsecutiveDays ?? 'NULL';
      await this.prisma.executeRaw(
        `INSERT INTO "${schemaName}".leave_types (id, name, code, color, icon, is_paid, max_consecutive_days, created_at, updated_at)
         VALUES (gen_random_uuid(), '${lt.name}', '${lt.code}', '${lt.color}', '${lt.icon}', ${lt.isPaid}, ${maxDays}, NOW(), NOW())`,
      );
    }
  }

  private async seedWorkSchedule(schemaName: string): Promise<void> {
    const ws = DEFAULT_WORK_SCHEDULE;
    const workingDaysJson = JSON.stringify(ws.workingDays);
    await this.prisma.executeRaw(
      `INSERT INTO "${schemaName}".work_schedule (id, name, start_time, end_time, working_days, grace_period_minutes, min_hours_full_day, min_hours_half_day, overtime_threshold_hours, is_default, created_at, updated_at)
       VALUES (gen_random_uuid(), '${ws.name}', '${ws.startTime}', '${ws.endTime}', '${workingDaysJson}', ${ws.gracePeriodMinutes}, ${ws.minHoursFullDay}, ${ws.minHoursHalfDay}, ${ws.overtimeThresholdHours}, ${ws.isDefault}, NOW(), NOW())`,
    );
  }

  private async seedTimeTrackerMockConfig(schemaName: string): Promise<void> {
    const configJson = JSON.stringify({
      daysToGenerate: 30,
      punchVarianceMinutes: 30,
      missedPunchRate: 0.05,
      absentRate: 0.03,
      overtimeRate: 0.1,
      lateArrivalRate: 0.15,
      employeeMatchField: 'employee_id',
    }).replace(/'/g, "''");
    await this.prisma.executeRaw(
      `INSERT INTO "${schemaName}".time_tracker_config (id, name, provider, config, is_active, sync_frequency, last_sync_at, created_at, updated_at)
       VALUES (gen_random_uuid(), 'Mock Tracker (Development)', 'mock', '${configJson}'::jsonb, true, 'daily', NULL, NOW(), NOW())`,
    );
  }

  private async seedCandidateStages(schemaName: string): Promise<void> {
    for (const stage of DEFAULT_CANDIDATE_STAGES) {
      await this.prisma.executeRaw(
        `INSERT INTO "${schemaName}".candidate_stages (id, name, order_index, color, is_default)
         VALUES (gen_random_uuid(), '${stage.name}', ${stage.orderIndex}, '${stage.color}', ${stage.isDefault})`,
      );
    }
  }

  private async seedNotificationSettings(schemaName: string): Promise<void> {
    const values = DEFAULT_NOTIFICATION_SETTINGS.map(
      (s) =>
        `('${s.notificationType.replace(/'/g, "''")}', ${s.inAppEnabled}, ${s.emailEnabled})`,
    ).join(',\n');
    await this.prisma.executeRaw(
      `INSERT INTO "${schemaName}".notification_settings (notification_type, in_app_enabled, email_enabled)
       VALUES ${values}
       ON CONFLICT (notification_type) DO NOTHING`,
    );
  }

  private async seedOrganizationSettings(
    schemaName: string,
    orgName: string,
    customDomain: string | null,
    adminEmail: string,
  ): Promise<void> {
    const safeName = orgName.replace(/'/g, "''");
    const domainVal = customDomain ? `'${customDomain.replace(/'/g, "''")}'` : 'NULL';
    const companyDomain = adminEmail.includes('@')
      ? adminEmail.split('@')[1]?.replace(/'/g, "''") ?? null
      : null;
    const companyDomainVal = companyDomain ? `'${companyDomain}'` : 'NULL';
    await this.prisma.executeRaw(
      `INSERT INTO "${schemaName}".organization_settings (id, org_name, custom_domain, company_email_domain, default_timezone, date_format, financial_year_start_month, default_currency)
       VALUES (gen_random_uuid(), '${safeName}', ${domainVal}, ${companyDomainVal}, 'UTC', 'DD-MMM-YYYY', 1, 'USD')`,
    );
  }

  private async createAdminUser(
    schemaName: string,
    name: string,
    email: string,
    passwordHash: string,
  ): Promise<string> {
    const nameParts = name.split(' ');
    const firstName = (nameParts[0] || name).replace(/'/g, "''");
    const lastName = (nameParts.slice(1).join(' ') || '').replace(/'/g, "''");
    const displayName = name.replace(/'/g, "''");
    const safeEmail = email.replace(/'/g, "''");
    const safeHash = passwordHash.replace(/'/g, "''");

    const userRows = await this.prisma.queryRaw<{ id: string }>(
      `INSERT INTO "${schemaName}".users (id, email, password_hash, first_name, last_name, display_name, email_domain_type, status, must_reset_password, created_at, updated_at)
       VALUES (gen_random_uuid(), '${safeEmail}', '${safeHash}', '${firstName}', '${lastName}', '${displayName}', 'company', 'active', TRUE, NOW(), NOW())
       RETURNING id`,
    );
    const userId = userRows[0].id;

    const adminRoleRows = await this.prisma.queryRaw<{ id: string }>(
      `SELECT id FROM "${schemaName}".roles WHERE name = 'Admin' LIMIT 1`,
    );
    if (adminRoleRows.length > 0) {
      await this.prisma.executeRaw(
        `INSERT INTO "${schemaName}".user_roles (id, user_id, role_id, assigned_at)
         VALUES (gen_random_uuid(), '${userId}', '${adminRoleRows[0].id}', NOW())`,
      );
    }

    await this.prisma.executeRaw(
      `INSERT INTO "${schemaName}".user_preferences (user_id) VALUES ('${userId}')`,
    );

    return userId;
  }

  private sanitizeSchemaName(slug: string): string {
    return `tenant_${slug
      .toLowerCase()
      .replace(/-/g, '_')
      .replace(/[^a-z0-9_]/g, '')}`;
  }
}
