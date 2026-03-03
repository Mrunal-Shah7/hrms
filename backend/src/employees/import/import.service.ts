import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../core/email/email.service';
import { NotificationService } from '../../core/notification/notification.service';
import { TenantInfo } from '../../tenant/tenant.interface';
import {
  type EmployeeImportRow,
  type ValidationError,
  type ImportLookupMaps,
  validateHeaders,
  validateEmployeeRow,
  parseRowToEmployee,
  getNormalizedHeaders,
  mapCsvRecordToRow,
} from './import-validator';

/** Simple alphanumeric password (no special chars) to avoid copy/paste issues in emails. */
function generateTempPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  const digits = '23456789';
  const pool = letters + digits;
  let pwd = '';
  for (let i = 0; i < 10; i++) {
    pwd += pool[Math.floor(Math.random() * pool.length)];
  }
  return pwd;
}

const TEMPLATE_HEADERS = [
  'employee_id',
  'first_name',
  'last_name',
  'email',
  'phone',
  'department_code',
  'designation_code',
  'employment_type',
  'date_of_joining',
  'date_of_birth',
  'reports_to_email',
  'emergency_contact_name',
  'emergency_contact_phone',
  'role',
];

const SAMPLE_ROW = [
  '',
  'John',
  'Doe',
  'john@acme.com',
  '+911234567890',
  'ENG',
  'SR-ENG',
  'permanent',
  '2026-03-01',
  '1990-05-15',
  'manager@acme.com',
  'Jane Doe',
  '+919876543210',
  'Employee',
];

const COMMENT_ROW =
  '# employee_id is auto-generated if blank. department_code and designation_code must match existing records. employment_type: permanent|contract|intern|freelance. Dates: YYYY-MM-DD. role: role name (default Employee). Multiple roles separated by semicolons.';

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
  ) {}

  getTemplateCsv(): Buffer {
    const bom = '\uFEFF';
    const headerLine = TEMPLATE_HEADERS.join(',');
    const sampleLine = SAMPLE_ROW.map((c) => (c.includes(',') ? `"${c}"` : c)).join(',');
    const content = `${bom}${headerLine}\n${sampleLine}\n${COMMENT_ROW}\n`;
    return Buffer.from(content, 'utf-8');
  }

  private async loadLookupMaps(
    schemaName: string,
    tenantId: string,
  ): Promise<{ maps: ImportLookupMaps; currentUserCount: number; maxUsers: number }> {
    const [deptRows, desigRows, emailRows, empIdRows, userRows, roleRows, orgRows, tenantRows] = await Promise.all([
      this.prisma.withTenantSchema(schemaName, (tx) =>
        tx.$queryRawUnsafe<Array<{ id: string; code: string }>>(`SELECT id, code FROM departments`),
      ),
      this.prisma.withTenantSchema(schemaName, (tx) =>
        tx.$queryRawUnsafe<Array<{ id: string; code: string }>>(`SELECT id, code FROM designations`),
      ),
      this.prisma.withTenantSchema(schemaName, (tx) =>
        tx.$queryRawUnsafe<Array<{ email: string }>>(`SELECT email FROM users`),
      ),
      this.prisma.withTenantSchema(schemaName, (tx) =>
        tx.$queryRawUnsafe<Array<{ employee_id: string }>>(
          `SELECT employee_id FROM users WHERE employee_id IS NOT NULL`,
        ),
      ),
      this.prisma.withTenantSchema(schemaName, (tx) =>
        tx.$queryRawUnsafe<Array<{ id: string; email: string }>>(
          `SELECT id, email FROM users WHERE status = 'active'`,
        ),
      ),
      this.prisma.withTenantSchema(schemaName, (tx) =>
        tx.$queryRawUnsafe<Array<{ id: string; name: string }>>(`SELECT id, name FROM roles`),
      ),
      this.prisma.withTenantSchema(schemaName, (tx) =>
        tx.$queryRawUnsafe<Array<{ company_email_domain: string | null }>>(
          `SELECT company_email_domain FROM organization_settings LIMIT 1`,
        ),
      ),
      this.prisma.withPlatformSchema((tx) =>
        tx.$queryRawUnsafe<Array<{ current_user_count: number; max_users: number }>>(
          `SELECT current_user_count, max_users FROM tenants WHERE id = $1::uuid`,
          tenantId,
        ),
      ),
    ]);

    const departmentsByCode = new Map<string, string>();
    for (const r of deptRows) {
      departmentsByCode.set((r.code ?? '').toUpperCase().trim(), r.id);
    }
    const designationsByCode = new Map<string, string>();
    for (const r of desigRows) {
      designationsByCode.set((r.code ?? '').toUpperCase().trim(), r.id);
    }
    const existingEmails = new Set<string>();
    for (const r of emailRows) {
      existingEmails.add((r.email ?? '').toLowerCase());
    }
    const existingEmployeeIds = new Set<string>();
    for (const r of empIdRows) {
      if (r.employee_id) existingEmployeeIds.add(r.employee_id);
    }
    const usersByEmail = new Map<string, string>();
    for (const r of userRows) {
      usersByEmail.set((r.email ?? '').toLowerCase(), r.id);
    }
    const rolesByName = new Map<string, string>();
    for (const r of roleRows) {
      rolesByName.set((r.name ?? '').toLowerCase(), r.id);
    }
    const companyEmailDomain = orgRows[0]?.company_email_domain ?? null;
    const { current_user_count: currentUserCount, max_users: maxUsers } = tenantRows[0] ?? {
      current_user_count: 0,
      max_users: 999,
    };

    const maps: ImportLookupMaps = {
      departmentsByCode,
      designationsByCode,
      existingEmails,
      existingEmployeeIds,
      usersByEmail,
      rolesByName,
      companyEmailDomain,
    };

    return { maps, currentUserCount, maxUsers };
  }

  async importEmployees(
    tenant: TenantInfo,
    userId: string,
    file: { buffer: Buffer; originalname?: string; size?: number },
    sendWelcomeEmails: boolean,
    dryRun: boolean,
  ): Promise<{
    summary: { totalRows: number; imported?: number; skipped?: number; errors: number; wouldImport?: number; wouldSkip?: number };
    imported?: Array<{ row: number; employeeId: string; email: string; name: string }>;
    errors: ValidationError[];
    dryRun?: boolean;
  }> {
    const MAX_SIZE = 5 * 1024 * 1024;
    if (!file?.buffer) {
      throw new BadRequestException('No file uploaded');
    }
    if ((file.size ?? 0) > MAX_SIZE) {
      throw new BadRequestException('File size exceeds 5MB');
    }
    const ext = (file.originalname ?? '').toLowerCase();
    if (!ext.endsWith('.csv')) {
      throw new BadRequestException('File must be a CSV');
    }

    let records: Record<string, string>[];
    try {
      records = parse(file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });
    } catch (err) {
      throw new BadRequestException(`Invalid CSV: ${(err as Error).message}`);
    }

    if (records.length === 0) {
      throw new BadRequestException('CSV file is empty or has no data rows');
    }

    const rawHeaders = Object.keys(records[0] ?? {});
    const normalizedHeaders = getNormalizedHeaders(rawHeaders);
    const headerMap = new Map<string, string>();
    for (let i = 0; i < rawHeaders.length; i++) {
      headerMap.set(rawHeaders[i], normalizedHeaders[i] ?? rawHeaders[i]);
    }

    const headerCheck = validateHeaders(normalizedHeaders);
    if (!headerCheck.valid) {
      throw new BadRequestException({
        success: false,
        error: 'INVALID_TEMPLATE',
        message: `Missing required columns: ${headerCheck.missing?.join(', ')}`,
      });
    }

    const dataRows: Record<string, string>[] = [];
    for (const rec of records) {
      const firstVal = Object.values(rec)[0] ?? '';
      if (typeof firstVal === 'string' && firstVal.trim().startsWith('#')) continue;
      dataRows.push(rec);
    }

    const rowCount = dataRows.length;
    const { maps, currentUserCount, maxUsers } = await this.loadLookupMaps(
      tenant.schemaName,
      tenant.id,
    );

    const availableSeats = Math.max(0, maxUsers - currentUserCount);
    if (rowCount > availableSeats) {
      throw new BadRequestException({
        success: false,
        error: 'SEAT_LIMIT_EXCEEDED',
        message: `Import would exceed seat limit. You have ${availableSeats} seats remaining but the file contains ${rowCount} employees.`,
      });
    }

    const seenEmails = new Map<string, number>();
    const seenEmployeeIds = new Map<string, number>();
    const allErrors: ValidationError[] = [];
    const validRows: { row: EmployeeImportRow; rowIndex: number }[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const rowIndex = i + 2;
      const mapped = mapCsvRecordToRow(dataRows[i], headerMap);
      const row = parseRowToEmployee(mapped);

      const rowErrors = validateEmployeeRow(
        row,
        rowIndex,
        maps,
        seenEmails,
        seenEmployeeIds,
      );

      if (rowErrors.length > 0) {
        allErrors.push(...rowErrors);
      } else {
        validRows.push({ row, rowIndex });
      }
    }

    if (dryRun) {
      const wouldImport = validRows.length;
      const wouldSkip = dataRows.length - wouldImport;
      return {
        dryRun: true,
        summary: {
          totalRows: dataRows.length,
          wouldImport,
          wouldSkip,
          errors: allErrors.length,
        },
        errors: allErrors,
      };
    }

    if (validRows.length === 0) {
      return {
        summary: {
          totalRows: dataRows.length,
          imported: 0,
          skipped: dataRows.length,
          errors: allErrors.length,
        },
        imported: [],
        errors: allErrors,
      };
    }

    const orgName = tenant.name;
    const imported: Array<{ row: number; employeeId: string; email: string; name: string }> = [];

    const lastEmp = await this.prisma.withTenantSchema(tenant.schemaName, (tx) =>
      tx.$queryRawUnsafe<Array<{ employee_id: string }>>(
        `SELECT employee_id FROM users WHERE employee_id LIKE 'EMP-%' ORDER BY employee_id DESC LIMIT 1`,
      ),
    );
    let nextEmpNum = 1;
    if (lastEmp.length > 0) {
      const match = lastEmp[0].employee_id?.match(/EMP-(\d+)/);
      if (match) nextEmpNum = parseInt(match[1], 10) + 1;
    }

    const empRoleRows = await this.prisma.withTenantSchema(tenant.schemaName, (tx) =>
      tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM roles WHERE name = 'Employee' LIMIT 1`),
    );
    const defaultRoleId = empRoleRows[0]?.id ?? null;

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      for (const { row, rowIndex } of validRows) {
        let employeeId = row.employee_id?.trim();
        if (!employeeId) {
          employeeId = `EMP-${String(nextEmpNum++).padStart(4, '0')}`;
        }

        const companyDomain = maps.companyEmailDomain?.toLowerCase();
        const emailDomain = row.email.split('@')[1]?.toLowerCase();
        const emailDomainType =
          companyDomain && emailDomain && companyDomain === emailDomain ? 'company' : 'external';

        const tempPassword = generateTempPassword();
        const passwordHash = await bcrypt.hash(tempPassword, 12);
        const userUuid = crypto.randomUUID();
        const displayName = `${row.first_name} ${row.last_name}`.trim();

        const deptCode = row.department_code.toUpperCase().trim();
        const desigCode = row.designation_code.toUpperCase().trim();
        const departmentId = maps.departmentsByCode.get(deptCode);
        const designationId = maps.designationsByCode.get(desigCode);

        if (!departmentId || !designationId) {
          continue;
        }

        let reportsTo: string | null = null;
        if (row.reports_to_email) {
          reportsTo = maps.usersByEmail.get(row.reports_to_email.toLowerCase().trim()) ?? null;
        }

        let roleIds: string[] = [];
        if (row.role?.trim()) {
          const roles = row.role.split(';').map((r) => r.trim()).filter(Boolean);
          for (const r of roles) {
            const rid = maps.rolesByName.get(r.toLowerCase());
            if (rid) roleIds.push(rid);
          }
        }
        if (roleIds.length === 0 && defaultRoleId) {
          roleIds = [defaultRoleId];
        }

        await tx.$executeRawUnsafe(
          `INSERT INTO users (id, employee_id, email, password_hash, first_name, last_name, display_name,
            phone, email_domain_type, status, must_reset_password, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', TRUE, NOW(), NOW())`,
          userUuid,
          employeeId,
          row.email,
          passwordHash,
          row.first_name,
          row.last_name,
          displayName,
          row.phone || null,
          emailDomainType,
        );

        await tx.$executeRawUnsafe(
          `INSERT INTO employee_profiles (id, user_id, department_id, designation_id, reports_to,
            employment_type, date_of_joining, date_of_birth, emergency_contact_name, emergency_contact_phone,
            created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::date, $7::date, $8, $9, NOW(), NOW())`,
          userUuid,
          departmentId,
          designationId,
          reportsTo,
          row.employment_type.toLowerCase(),
          row.date_of_joining,
          row.date_of_birth || null,
          row.emergency_contact_name || null,
          row.emergency_contact_phone || null,
        );

        await tx.$executeRawUnsafe(
          `INSERT INTO user_preferences (id, user_id, date_format, timezone, language, profile_picture_visibility, new_sign_in_alert, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, NULL, NULL, 'en', 'everyone', TRUE, NOW(), NOW())`,
          userUuid,
        );

        for (const rid of roleIds) {
          await tx.$executeRawUnsafe(
            `INSERT INTO user_roles (id, user_id, role_id, assigned_by, assigned_at)
             VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
            userUuid,
            rid,
            userId,
          );
        }

        maps.existingEmails.add(row.email.toLowerCase());
        maps.existingEmployeeIds.add(employeeId);
        maps.usersByEmail.set(row.email.toLowerCase(), userUuid);

        imported.push({
          row: rowIndex,
          employeeId,
          email: row.email,
          name: displayName,
        });

        if (sendWelcomeEmails) {
          const platformDomain = this.config.get<string>('PLATFORM_DOMAIN', 'localhost:3000');
          const isLocalhost = platformDomain.includes('localhost') || platformDomain.includes('127.0.0.1');
          const loginUrl = tenant.slug
            ? isLocalhost
              ? `https://${platformDomain}/login?slug=${encodeURIComponent(tenant.slug)}`
              : `https://${tenant.slug}.${platformDomain}/login`
            : `https://${platformDomain}/login?slug=${encodeURIComponent(tenant.slug ?? '')}`;
          const escapedPassword = tempPassword
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
          const html = `
            <div style="font-family: Inter, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
              <h2 style="color: #011552; margin-bottom: 16px;">Welcome to ${orgName}</h2>
              <p>Hello ${row.first_name},</p>
              <p>Your account at ${orgName} has been created. Here are your login details:</p>
              <p><strong>Login URL:</strong> <a href="${loginUrl}">${loginUrl}</a></p>
              <p><strong>Email (username):</strong> ${row.email}</p>
              <p><strong>Temporary Password:</strong> <code style="background:#f4f4f5;padding:4px 8px;border-radius:4px;">${escapedPassword}</code></p>
              <p>For security, you will be required to change your password on your first login.</p>
            </div>
          `;
          setImmediate(() => {
            this.emailService
              .send(row.email, `Welcome to ${orgName} — Your HRMS Account`, html, tenant.schemaName)
              .catch((err: unknown) => console.warn('Import welcome email failed:', err));
          });
        }

        setImmediate(() => {
          this.notificationService
            .create(
              userUuid,
              'employee_account_created',
              `Welcome to ${orgName}`,
              'Your account has been created. Please log in and change your password.',
              tenant.schemaName,
            )
            .catch((err: unknown) => console.warn('Import notification failed:', err));
        });
      }

      await this.prisma.withPlatformSchema(async (ptx) => {
        await ptx.$executeRawUnsafe(
          `UPDATE tenants SET current_user_count = current_user_count + $1, updated_at = NOW() WHERE id = $2::uuid`,
          validRows.length,
          tenant.id,
        );
      });

      await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO audit_logs (id, user_id, action, module, entity_type, entity_id, old_value, new_value, created_at)
           VALUES (gen_random_uuid(), $1, 'import', 'employee_management', 'employees', NULL, NULL, $2::jsonb, NOW())`,
          userId,
          JSON.stringify({
            importedCount: validRows.length,
            skippedCount: dataRows.length - validRows.length,
            totalRows: dataRows.length,
            fileName: file.originalname ?? 'import.csv',
          }),
        );
      });
    });

    return {
      summary: {
        totalRows: dataRows.length,
        imported: validRows.length,
        skipped: dataRows.length - validRows.length,
        errors: allErrors.length,
      },
      imported,
      errors: allErrors,
    };
  }
}
