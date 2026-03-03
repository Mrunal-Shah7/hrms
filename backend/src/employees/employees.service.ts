import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../core/email/email.service';
import { NotificationService } from '../core/notification/notification.service';
import { ExportService } from '../core/export/export.service';
import { TenantInfo } from '../tenant/tenant.interface';
import * as bcrypt from 'bcrypt';
import type { CreateEmployeeDto } from './dto/create-employee.dto';
import type { UpdateEmployeeDto } from './dto/update-employee.dto';
import type { ListEmployeesQueryDto } from './dto/list-employees-query.dto';

type DataScope = 'ALL' | 'REPORTEES' | 'SELF';

function getDataScope(roles: string[]): DataScope {
  if (roles.includes('Admin') || roles.includes('HR Admin') || roles.includes('HR Manager')) {
    return 'ALL';
  }
  if (roles.includes('Manager / Team Lead')) {
    return 'REPORTEES';
  }
  return 'SELF';
}

/** Generates a simple alphanumeric password (no special chars) to avoid copy/paste issues in emails. */
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

function mapAddressToJson(addr?: { addressLine1?: string; addressLine2?: string; city?: string; state?: string; country?: string; postalCode?: string }): Record<string, string> | null {
  if (!addr || !addr.addressLine1) return null;
  return {
    addressLine1: addr.addressLine1 ?? '',
    addressLine2: addr.addressLine2 ?? '',
    city: addr.city ?? '',
    state: addr.state ?? '',
    country: addr.country ?? '',
    postalCode: addr.postalCode ?? '',
  };
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
    private readonly exportService: ExportService,
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
    query: ListEmployeesQueryDto,
  ) {
    const scope = getDataScope(roles);
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const offset = (page - 1) * limit;
    const statusFilter = query.status === 'all' ? undefined : (query.status ?? 'active');
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const sortColMap: Record<string, string> = {
      employeeId: 'u.employee_id',
      firstName: 'u.first_name',
      lastName: 'u.last_name',
      email: 'u.email',
      departmentName: 'd.name',
      designationName: 'des.name',
      employmentType: 'ep.employment_type',
      dateOfJoining: 'ep.date_of_joining',
      status: 'u.status',
      createdAt: 'u.created_at',
    };
    const orderCol = sortColMap[sortBy] ?? 'u.created_at';

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let p = 1;

      if (scope === 'SELF') {
        conditions.push(`u.id = $${p++}`);
        params.push(userId);
      } else if (scope === 'REPORTEES') {
        conditions.push(`ep.reports_to = $${p++}`);
        params.push(userId);
      }

      if (statusFilter) {
        conditions.push(`u.status = $${p++}`);
        params.push(statusFilter);
      } else {
        conditions.push(`u.status IN ('active', 'inactive', 'archived')`);
      }

      if (query.dateOfJoiningFrom) {
        conditions.push(`ep.date_of_joining >= $${p++}`);
        params.push(query.dateOfJoiningFrom);
      }
      if (query.dateOfJoiningTo) {
        conditions.push(`ep.date_of_joining <= $${p++}`);
        params.push(query.dateOfJoiningTo);
      }

      if (query.search?.trim()) {
        const searchTerm = `%${query.search.trim()}%`;
        conditions.push(
          `(u.employee_id ILIKE $${p} OR u.first_name ILIKE $${p} OR u.last_name ILIKE $${p} OR u.email ILIKE $${p} OR CONCAT(u.first_name, ' ', u.last_name) ILIKE $${p})`,
        );
        params.push(searchTerm);
        p++;
      }
      if (query.departmentId) {
        conditions.push(`ep.department_id = $${p++}`);
        params.push(query.departmentId);
      }
      if (query.designationId) {
        conditions.push(`ep.designation_id = $${p++}`);
        params.push(query.designationId);
      }
      if (query.employmentType) {
        conditions.push(`ep.employment_type = $${p++}`);
        params.push(query.employmentType);
      }
      if (query.emailDomainType) {
        conditions.push(`u.email_domain_type = $${p++}`);
        params.push(query.emailDomainType);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countResult = await tx.$queryRawUnsafe<{ count: string }[]>(
        `SELECT COUNT(*)::text as count FROM users u
         LEFT JOIN employee_profiles ep ON u.id = ep.user_id
         LEFT JOIN departments d ON ep.department_id = d.id
         LEFT JOIN designations des ON ep.designation_id = des.id
         ${whereClause}`,
        ...params,
      );
      const total = parseInt(countResult[0]?.count ?? '0', 10);

      const rows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          employee_id: string | null;
          first_name: string;
          last_name: string;
          display_name: string | null;
          email: string;
          phone: string | null;
          photo_url: string | null;
          email_domain_type: string;
          status: string;
          employment_type: string | null;
          date_of_joining: Date | null;
          department_id: string | null;
          designation_id: string | null;
          reports_to: string | null;
          department_name: string | null;
          designation_name: string | null;
          created_at: Date;
        }>
      >(
        `SELECT u.id, u.employee_id, u.first_name, u.last_name, u.display_name, u.email, u.phone,
                u.photo_url, u.email_domain_type, u.status, u.created_at,
                ep.employment_type, ep.date_of_joining, ep.department_id, ep.designation_id, ep.reports_to,
                d.name AS department_name, des.name AS designation_name
         FROM users u
         LEFT JOIN employee_profiles ep ON u.id = ep.user_id
         LEFT JOIN departments d ON ep.department_id = d.id
         LEFT JOIN designations des ON ep.designation_id = des.id
         ${whereClause}
         ORDER BY ${orderCol} ${sortOrder}
         LIMIT $${p} OFFSET $${p + 1}`,
        ...params,
        limit,
        offset,
      );

      const data = rows.map((r) => ({
        id: r.id,
        employeeId: r.employee_id,
        firstName: r.first_name,
        lastName: r.last_name,
        displayName: r.display_name ?? `${r.first_name} ${r.last_name}`,
        email: r.email,
        phone: r.phone,
        photoUrl: r.photo_url,
        emailDomainType: r.email_domain_type as 'company' | 'external',
        status: r.status,
        employmentType: r.employment_type ?? 'permanent',
        dateOfJoining: r.date_of_joining,
        department: r.department_id
          ? { id: r.department_id, name: r.department_name ?? '' }
          : null,
        designation: r.designation_id
          ? { id: r.designation_id, name: r.designation_name ?? '' }
          : null,
        reportsTo: r.reports_to,
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
    });
  }

  async create(
    tenant: TenantInfo,
    userId: string,
    dto: CreateEmployeeDto,
  ): Promise<{ id: string; employeeId: string; temporaryPassword?: string; [key: string]: unknown }> {
    const sendWelcomeEmail = dto.sendWelcomeEmail !== false;
    const orgName = tenant.name;

    let tempPasswordForEmail: string | null = null;
    const result = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const deptRows = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM departments WHERE id = $1`,
        dto.departmentId,
      );
      if (deptRows.length === 0) {
        throw new NotFoundException('Department not found');
      }

      const desigRows = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM designations WHERE id = $1`,
        dto.designationId,
      );
      if (desigRows.length === 0) {
        throw new NotFoundException('Designation not found');
      }

      if (dto.reportsTo) {
        const reportRows = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM users WHERE id = $1 AND status = 'active'`,
          dto.reportsTo,
        );
        if (reportRows.length === 0) {
          throw new BadRequestException('Reports-to user not found or inactive');
        }
      }

      const existingEmail = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM users WHERE email = $1`,
        dto.email,
      );
      if (existingEmail.length > 0) {
        throw new ConflictException('An employee with this email already exists');
      }

      let employeeId: string;
      if (dto.employeeId?.trim()) {
        const existingEmp = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM users WHERE employee_id = $1`,
          dto.employeeId.trim(),
        );
        if (existingEmp.length > 0) {
          throw new ConflictException('Employee ID already exists');
        }
        employeeId = dto.employeeId.trim();
      } else {
        const lastEmp = await tx.$queryRawUnsafe<{ employee_id: string }[]>(
          `SELECT employee_id FROM users WHERE employee_id LIKE 'EMP-%' ORDER BY employee_id DESC LIMIT 1`,
        );
        let nextNum = 1;
        if (lastEmp.length > 0) {
          const match = lastEmp[0].employee_id?.match(/EMP-(\d+)/);
          if (match) nextNum = parseInt(match[1], 10) + 1;
        }
        employeeId = `EMP-${String(nextNum).padStart(4, '0')}`;
      }

      const orgRows = await tx.$queryRawUnsafe<{ company_email_domain: string | null }[]>(
        `SELECT company_email_domain FROM organization_settings LIMIT 1`,
      );
      const companyDomain = orgRows[0]?.company_email_domain?.toLowerCase();
      const emailDomain = dto.email.split('@')[1]?.toLowerCase();
      const emailDomainType =
        companyDomain && emailDomain && companyDomain === emailDomain ? 'company' : 'external';

      const tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, 12);

      const userUuid = crypto.randomUUID();
      const displayName = dto.displayName?.trim() || `${dto.firstName} ${dto.lastName}`;

      await tx.$executeRawUnsafe(
        `INSERT INTO users (id, employee_id, email, password_hash, first_name, last_name, display_name,
          phone, email_domain_type, status, must_reset_password, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', TRUE, NOW(), NOW())`,
        userUuid,
        employeeId,
        dto.email,
        passwordHash,
        dto.firstName,
        dto.lastName,
        displayName,
        dto.phone ?? null,
        emailDomainType,
      );

      const presentAddr = mapAddressToJson(dto.presentAddress);
      let permanentAddr = mapAddressToJson(dto.permanentAddress);
      if (dto.sameAsPresentAddress && presentAddr) permanentAddr = presentAddr;

      const epUuid = crypto.randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO employee_profiles (id, user_id, department_id, designation_id, reports_to,
          employment_type, date_of_joining, date_of_birth, gender, marital_status, blood_group,
          emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
          present_address, permanent_address, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb, NOW(), NOW())`,
        epUuid,
        userUuid,
        dto.departmentId,
        dto.designationId,
        dto.reportsTo ?? null,
        dto.employmentType,
        dto.dateOfJoining,
        dto.dateOfBirth ?? null,
        dto.gender ?? null,
        dto.maritalStatus ?? null,
        dto.bloodGroup ?? null,
        dto.emergencyContactName ?? null,
        dto.emergencyContactPhone ?? null,
        dto.emergencyContactRelation ?? null,
        presentAddr ? JSON.stringify(presentAddr) : null,
        permanentAddr ? JSON.stringify(permanentAddr) : null,
      );

      await tx.$executeRawUnsafe(
        `INSERT INTO user_preferences (id, user_id, date_format, timezone, language, profile_picture_visibility, new_sign_in_alert, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, NULL, NULL, 'en', 'everyone', TRUE, NOW(), NOW())`,
        userUuid,
      );

      const roleIds = dto.roleIds && dto.roleIds.length > 0 ? dto.roleIds : [];
      let finalRoleIds = roleIds;
      if (finalRoleIds.length === 0) {
        const empRole = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM roles WHERE name = 'Employee' LIMIT 1`,
        );
        if (empRole.length > 0) finalRoleIds = [empRole[0].id];
      }
      for (const rid of finalRoleIds) {
        await tx.$executeRawUnsafe(
          `INSERT INTO user_roles (id, user_id, role_id, assigned_by, assigned_at)
           VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
          userUuid,
          rid,
          userId,
        );
      }

      await this.prisma.withPlatformSchema(async (ptx) => {
        await ptx.$executeRawUnsafe(
          `UPDATE tenants SET current_user_count = current_user_count + 1, updated_at = NOW() WHERE id = $1`,
          tenant.id,
        );
      });

      const newEmployee = {
        id: userUuid,
        employeeId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        emailDomainType,
        departmentId: dto.departmentId,
        designationId: dto.designationId,
      };
      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'create',
        'employee_management',
        'users',
        userUuid,
        null,
        newEmployee,
      );

      const deptNameRows = await tx.$queryRawUnsafe<{ name: string }[]>(
        `SELECT name FROM departments WHERE id = $1`,
        dto.departmentId,
      );
      const desigNameRows = await tx.$queryRawUnsafe<{ name: string }[]>(
        `SELECT name FROM designations WHERE id = $1`,
        dto.designationId,
      );

      const result: Record<string, unknown> = {
        id: userUuid,
        employeeId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        displayName: dto.displayName ?? `${dto.firstName} ${dto.lastName}`,
        email: dto.email,
        phone: dto.phone,
        photoUrl: null,
        emailDomainType,
        status: 'active',
        employmentType: dto.employmentType,
        dateOfJoining: dto.dateOfJoining,
        department: { id: dto.departmentId, name: deptNameRows[0]?.name ?? '' },
        designation: { id: dto.designationId, name: desigNameRows[0]?.name ?? '' },
        reportsTo: dto.reportsTo ?? null,
        createdAt: new Date(),
      };
      if (!sendWelcomeEmail) {
        result.temporaryPassword = tempPassword;
      }
      return result as { id: string; employeeId: string; temporaryPassword?: string; [key: string]: unknown };
    });

    // Create notification after transaction commits (user must exist for FK)
    try {
      await this.notificationService.create(
        result.id,
        'employee_account_created',
        `Welcome to ${orgName}`,
        'Your account has been created. Please log in and change your password.',
        tenant.schemaName,
      );
    } catch (err) {
      console.warn('Failed to create welcome notification:', (err as Error).message);
    }

    return result;
  }

  async findOne(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    id: string,
  ) {
    const scope = getDataScope(roles);
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      if (scope === 'SELF' && id !== userId) {
        throw new ForbiddenException('You can only view your own profile');
      }
      if (scope === 'REPORTEES') {
        const isReportee = await tx.$queryRawUnsafe<{ n: number }[]>(
          `SELECT 1 as n FROM employee_profiles WHERE user_id = $1 AND reports_to = $2`,
          id,
          userId,
        );
        if (isReportee.length === 0 && id !== userId) {
          throw new ForbiddenException('You can only view your reportees');
        }
      }

      const rows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          employee_id: string | null;
          first_name: string;
          last_name: string;
          display_name: string | null;
          email: string;
          phone: string | null;
          photo_url: string | null;
          email_domain_type: string;
          status: string;
          must_reset_password: boolean;
          last_login_at: Date | null;
          created_at: Date;
          updated_at: Date;
          employment_type: string;
          date_of_joining: Date;
          date_of_birth: Date | null;
          gender: string | null;
          marital_status: string | null;
          blood_group: string | null;
          emergency_contact_name: string | null;
          emergency_contact_phone: string | null;
          emergency_contact_relation: string | null;
          present_address: unknown;
          permanent_address: unknown;
          department_id: string | null;
          designation_id: string | null;
          reports_to: string | null;
          dept_name: string | null;
          dept_code: string | null;
          desig_name: string | null;
          desig_code: string | null;
          mgr_id: string | null;
          mgr_first_name: string | null;
          mgr_last_name: string | null;
          mgr_employee_id: string | null;
        }>
      >(
        `SELECT u.id, u.employee_id, u.first_name, u.last_name, u.display_name, u.email, u.phone,
                u.photo_url, u.email_domain_type, u.status, u.must_reset_password, u.last_login_at,
                u.created_at, u.updated_at,
                ep.employment_type, ep.date_of_joining, ep.date_of_birth, ep.gender, ep.marital_status,
                ep.blood_group, ep.emergency_contact_name, ep.emergency_contact_phone,
                ep.emergency_contact_relation, ep.present_address, ep.permanent_address,
                ep.department_id, ep.designation_id, ep.reports_to,
                d.name AS dept_name, d.code AS dept_code,
                des.name AS desig_name, des.code AS desig_code,
                mgr.id AS mgr_id, mgr.first_name AS mgr_first_name, mgr.last_name AS mgr_last_name,
                mgr.employee_id AS mgr_employee_id
         FROM users u
         LEFT JOIN employee_profiles ep ON u.id = ep.user_id
         LEFT JOIN departments d ON ep.department_id = d.id
         LEFT JOIN designations des ON ep.designation_id = des.id
         LEFT JOIN users mgr ON ep.reports_to = mgr.id
         WHERE u.id = $1`,
        id,
      );

      if (rows.length === 0) {
        throw new NotFoundException('Employee not found');
      }

      const r = rows[0];
      const roleRows = await tx.$queryRawUnsafe<{ id: string; name: string }[]>(
        `SELECT r.id, r.name FROM roles r
         JOIN user_roles ur ON r.id = ur.role_id
         WHERE ur.user_id = $1`,
        id,
      );

      return {
        id: r.id,
        employeeId: r.employee_id,
        firstName: r.first_name,
        lastName: r.last_name,
        displayName: r.display_name ?? `${r.first_name} ${r.last_name}`,
        email: r.email,
        phone: r.phone,
        photoUrl: r.photo_url,
        emailDomainType: r.email_domain_type as 'company' | 'external',
        status: r.status,
        mustResetPassword: r.must_reset_password,
        lastLoginAt: r.last_login_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        profile: {
          employmentType: r.employment_type,
          dateOfJoining: r.date_of_joining,
          dateOfBirth: r.date_of_birth,
          gender: r.gender,
          maritalStatus: r.marital_status,
          bloodGroup: r.blood_group,
          emergencyContact: {
            name: r.emergency_contact_name,
            phone: r.emergency_contact_phone,
            relation: r.emergency_contact_relation,
          },
          presentAddress: r.present_address as Record<string, string> | null,
          permanentAddress: r.permanent_address as Record<string, string> | null,
        },
        department: r.department_id
          ? { id: r.department_id, name: r.dept_name ?? '', code: r.dept_code ?? '' }
          : null,
        designation: r.designation_id
          ? { id: r.designation_id, name: r.desig_name ?? '', code: r.desig_code ?? '' }
          : null,
        reportsTo: r.mgr_id
          ? {
              id: r.mgr_id,
              employeeId: r.mgr_employee_id,
              firstName: r.mgr_first_name ?? '',
              lastName: r.mgr_last_name ?? '',
            }
          : null,
        roles: roleRows.map((rr) => ({ id: rr.id, name: rr.name })),
      };
    });
  }

  async update(
    tenant: TenantInfo,
    userId: string,
    id: string,
    dto: UpdateEmployeeDto,
  ) {
    const existing = await this.findOne(tenant, userId, ['Admin', 'HR Admin', 'HR Manager'], id);
    const oldValue = { ...existing };

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      if (dto.email && dto.email !== existing.email) {
        const dup = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM users WHERE email = $1 AND id != $2`,
          dto.email,
          id,
        );
        if (dup.length > 0) {
          throw new ConflictException('An employee with this email already exists');
        }
      }
      if (dto.employeeId && dto.employeeId !== existing.employeeId) {
        const dup = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM users WHERE employee_id = $1 AND id != $2`,
          dto.employeeId,
          id,
        );
        if (dup.length > 0) {
          throw new ConflictException('Employee ID already exists');
        }
      }
      if (dto.reportsTo === id) {
        throw new BadRequestException('Employee cannot report to themselves');
      }
      if (dto.reportsTo) {
        const r = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM users WHERE id = $1 AND status = 'active'`,
          dto.reportsTo,
        );
        if (r.length === 0) {
          throw new BadRequestException('Reports-to user not found or inactive');
        }
      }

      const orgRows = await tx.$queryRawUnsafe<{ company_email_domain: string | null }[]>(
        `SELECT company_email_domain FROM organization_settings LIMIT 1`,
      );
      const companyDomain = orgRows[0]?.company_email_domain?.toLowerCase();

      let emailDomainType = existing.emailDomainType;
      if (dto.email) {
        const emailDomain = dto.email.split('@')[1]?.toLowerCase();
        emailDomainType =
          companyDomain && emailDomain && companyDomain === emailDomain ? 'company' : 'external';
      }

      const userUpdates: string[] = [];
      const userParams: unknown[] = [];
      let up = 1;
      if (dto.firstName !== undefined) {
        userUpdates.push(`first_name = $${up++}`);
        userParams.push(dto.firstName);
      }
      if (dto.lastName !== undefined) {
        userUpdates.push(`last_name = $${up++}`);
        userParams.push(dto.lastName);
      }
      if (dto.displayName !== undefined) {
        userUpdates.push(`display_name = $${up++}`);
        userParams.push(dto.displayName);
      }
      if (dto.email !== undefined) {
        userUpdates.push(`email = $${up++}`);
        userParams.push(dto.email);
      }
      if (dto.phone !== undefined) {
        userUpdates.push(`phone = $${up++}`);
        userParams.push(dto.phone);
      }
      userUpdates.push(`email_domain_type = $${up++}`);
      userParams.push(emailDomainType);
      if (dto.employeeId !== undefined) {
        userUpdates.push(`employee_id = $${up++}`);
        userParams.push(dto.employeeId);
      }
      if (dto.status !== undefined) {
        userUpdates.push(`status = $${up++}`);
        userParams.push(dto.status);
      }
      userUpdates.push(`updated_at = NOW()`);

      if (userUpdates.length > 1) {
        await tx.$executeRawUnsafe(
          `UPDATE users SET ${userUpdates.join(', ')} WHERE id = $${up}`,
          ...userParams,
          id,
        );
      }

      const prevStatus = existing.status;
      if (dto.status === 'inactive' && prevStatus === 'active') {
        await tx.$executeRawUnsafe(`DELETE FROM user_sessions WHERE user_id = $1`, id);
        await this.prisma.withPlatformSchema(async (ptx) => {
          await ptx.$executeRawUnsafe(
            `UPDATE tenants SET current_user_count = GREATEST(0, current_user_count - 1), updated_at = NOW() WHERE id = $1`,
            tenant.id,
          );
        });
      } else if (dto.status === 'active' && prevStatus === 'inactive') {
        await this.prisma.withPlatformSchema(async (ptx) => {
          await ptx.$executeRawUnsafe(
            `UPDATE tenants SET current_user_count = current_user_count + 1, updated_at = NOW() WHERE id = $1`,
            tenant.id,
          );
        });
      }

      const epUpdates: string[] = [];
      const epParams: unknown[] = [];
      let ep = 1;
      const epFields: [string, unknown][] = [
        ['department_id', dto.departmentId],
        ['designation_id', dto.designationId],
        ['reports_to', dto.reportsTo],
        ['employment_type', dto.employmentType],
        ['date_of_joining', dto.dateOfJoining],
        ['date_of_birth', dto.dateOfBirth],
        ['gender', dto.gender],
        ['marital_status', dto.maritalStatus],
        ['blood_group', dto.bloodGroup],
        ['emergency_contact_name', dto.emergencyContactName],
        ['emergency_contact_phone', dto.emergencyContactPhone],
        ['emergency_contact_relation', dto.emergencyContactRelation],
      ];
      for (const [col, v] of epFields) {
        if (v !== undefined) {
          epUpdates.push(`${col} = $${ep++}`);
          epParams.push(v);
        }
      }
      if (dto.presentAddress !== undefined) {
        epUpdates.push(`present_address = $${ep++}::jsonb`);
        epParams.push(dto.presentAddress ? JSON.stringify(mapAddressToJson(dto.presentAddress)) : null);
      }
      if (dto.permanentAddress !== undefined) {
        epUpdates.push(`permanent_address = $${ep++}::jsonb`);
        epParams.push(dto.permanentAddress ? JSON.stringify(mapAddressToJson(dto.permanentAddress)) : null);
      }
      if (dto.sameAsPresentAddress && dto.presentAddress) {
        epUpdates.push(`permanent_address = $${ep++}::jsonb`);
        epParams.push(JSON.stringify(mapAddressToJson(dto.presentAddress)));
      }
      if (epUpdates.length > 0) {
        epUpdates.push(`updated_at = NOW()`);
        await tx.$executeRawUnsafe(
          `UPDATE employee_profiles SET ${epUpdates.join(', ')} WHERE user_id = $${ep}`,
          ...epParams,
          id,
        );
      }

      if (dto.roleIds !== undefined) {
        await tx.$executeRawUnsafe(`DELETE FROM user_roles WHERE user_id = $1`, id);
        for (const rid of dto.roleIds) {
          await tx.$executeRawUnsafe(
            `INSERT INTO user_roles (id, user_id, role_id, assigned_by, assigned_at)
             VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
            id,
            rid,
            userId,
          );
        }
      }

      const newValue = await this.findOne(tenant, userId, ['Admin'], id);
      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'update',
        'employee_management',
        'users',
        id,
        oldValue,
        newValue,
      );

      return newValue;
    });
  }

  async archive(tenant: TenantInfo, userId: string, id: string) {
    if (id === userId) {
      throw new BadRequestException('You cannot archive your own account');
    }

    const existing = await this.findOne(tenant, userId, ['Admin', 'HR Admin', 'HR Manager'], id);

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const adminCount = await tx.$queryRawUnsafe<{ count: string }[]>(
        `SELECT COUNT(*)::text as count FROM user_roles ur
         JOIN roles r ON ur.role_id = r.id
         WHERE r.name = 'Admin'`,
      );
      const adminUserIds = await tx.$queryRawUnsafe<{ user_id: string }[]>(
        `SELECT ur.user_id FROM user_roles ur
         JOIN roles r ON ur.role_id = r.id
         WHERE r.name = 'Admin'`,
      );
      const isLastAdmin = parseInt(adminCount[0]?.count ?? '0', 10) === 1 && adminUserIds.some((a) => a.user_id === id);
      if (isLastAdmin) {
        throw new BadRequestException('Cannot archive the last administrator');
      }

      await tx.$executeRawUnsafe(
        `UPDATE users SET status = 'archived', updated_at = NOW() WHERE id = $1`,
        id,
      );
      await tx.$executeRawUnsafe(`DELETE FROM user_sessions WHERE user_id = $1`, id);

      await this.prisma.withPlatformSchema(async (ptx) => {
        await ptx.$executeRawUnsafe(
          `UPDATE tenants SET current_user_count = GREATEST(0, current_user_count - 1), updated_at = NOW() WHERE id = $1`,
          tenant.id,
        );
      });

      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'delete',
        'employee_management',
        'users',
        id,
        existing,
        { status: 'archived' },
      );

      return { message: 'Employee archived successfully' };
    });
  }

  async getReportees(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    managerId: string,
  ) {
    const scope = getDataScope(roles);
    if (scope === 'SELF') {
      throw new ForbiddenException('Access denied');
    }
    if (scope === 'REPORTEES' && managerId !== userId) {
      throw new ForbiddenException('You can only view your own reportees');
    }

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          employee_id: string | null;
          first_name: string;
          last_name: string;
          email: string;
          photo_url: string | null;
          email_domain_type: string;
          status: string;
          employment_type: string | null;
          department_id: string | null;
          designation_id: string | null;
          department_name: string | null;
          designation_name: string | null;
        }>
      >(
        `SELECT u.id, u.employee_id, u.first_name, u.last_name, u.email, u.photo_url, u.email_domain_type, u.status,
                ep.employment_type, ep.department_id, ep.designation_id,
                d.name AS department_name, des.name AS designation_name
         FROM users u
         JOIN employee_profiles ep ON u.id = ep.user_id
         LEFT JOIN departments d ON ep.department_id = d.id
         LEFT JOIN designations des ON ep.designation_id = des.id
         WHERE ep.reports_to = $1 AND u.status = 'active'
         ORDER BY u.first_name ASC`,
        managerId,
      );

      return rows.map((r) => ({
        id: r.id,
        employeeId: r.employee_id,
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
        photoUrl: r.photo_url,
        emailDomainType: r.email_domain_type,
        status: r.status,
        employmentType: r.employment_type,
        department: r.department_id ? { id: r.department_id, name: r.department_name ?? '' } : null,
        designation: r.designation_id ? { id: r.designation_id, name: r.designation_name ?? '' } : null,
      }));
    });
  }

  async getDepartmentOptions(tenant: TenantInfo) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string; name: string; code: string }>>(
        `SELECT id, name, code FROM departments ORDER BY name ASC`,
      );
      return rows;
    });
  }

  async getDesignationOptions(tenant: TenantInfo) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string; name: string; code: string }>>(
        `SELECT id, name, code FROM designations ORDER BY name ASC`,
      );
      return rows;
    });
  }

  async lookup(
    tenant: TenantInfo,
    search: string,
    limit = 10,
    excludeId?: string,
  ) {
    if (!search || search.length < 2) {
      return [];
    }
    const lim = Math.min(Math.max(limit, 1), 20);
    const term = `%${search}%`;

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      let sql: string;
      let params: unknown[];
      if (excludeId) {
        sql = `SELECT u.id, u.employee_id, u.first_name, u.last_name, u.email, u.photo_url,
               d.name AS department_name
               FROM users u
               LEFT JOIN employee_profiles ep ON u.id = ep.user_id
               LEFT JOIN departments d ON ep.department_id = d.id
               WHERE u.status = 'active' AND u.id != $2
               AND (u.employee_id ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1 OR u.email ILIKE $1)
               ORDER BY u.first_name, u.last_name
               LIMIT $3`;
        params = [term, excludeId, lim];
      } else {
        sql = `SELECT u.id, u.employee_id, u.first_name, u.last_name, u.email, u.photo_url,
               d.name AS department_name
               FROM users u
               LEFT JOIN employee_profiles ep ON u.id = ep.user_id
               LEFT JOIN departments d ON ep.department_id = d.id
               WHERE u.status = 'active'
               AND (u.employee_id ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1 OR u.email ILIKE $1)
               ORDER BY u.first_name, u.last_name
               LIMIT $2`;
        params = [term, lim];
      }
      const rows = await tx.$queryRawUnsafe<
        Array<{ id: string; employee_id: string | null; first_name: string; last_name: string; email: string; photo_url: string | null; department_name: string | null }>
      >(sql, ...params);

      return rows.map((r) => ({
        id: r.id,
        employeeId: r.employee_id,
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
        photoUrl: r.photo_url,
        department: r.department_name ? { name: r.department_name } : null,
      }));
    });
  }

  async getTimeline(tenant: TenantInfo, userId: string, permissions: string[], employeeId: string) {
    const canViewAudit = permissions.includes('settings:view:audit_logs');
    if (!canViewAudit) {
      return { data: [] };
    }

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          action: string;
          user_id: string | null;
          old_value: unknown;
          new_value: unknown;
          created_at: Date;
          actor_first_name: string | null;
          actor_last_name: string | null;
        }>
      >(
        `SELECT al.id, al.action, al.user_id, al.old_value, al.new_value, al.created_at,
                u.first_name AS actor_first_name, u.last_name AS actor_last_name
         FROM audit_logs al
         LEFT JOIN users u ON al.user_id = u.id
         WHERE al.entity_type = 'users' AND al.entity_id = $1
         ORDER BY al.created_at DESC
         LIMIT 100`,
        employeeId,
      );

      return {
        data: rows.map((r) => ({
          id: r.id,
          action: r.action,
          actor: r.actor_first_name || r.actor_last_name
            ? `${r.actor_first_name ?? ''} ${r.actor_last_name ?? ''}`.trim()
            : 'System',
          oldValue: r.old_value,
          newValue: r.new_value,
          createdAt: r.created_at,
        })),
      };
    });
  }

  async export(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    format: 'csv' | 'xlsx' | 'pdf',
    query: ListEmployeesQueryDto,
  ): Promise<Buffer> {
    const listResult = await this.list(tenant, userId, roles, { ...query, limit: 10000, page: 1 });
    const data = listResult.data as Record<string, unknown>[];

    const columns = [
      { key: 'employeeId', header: 'Employee ID' },
      { key: 'firstName', header: 'First Name' },
      { key: 'lastName', header: 'Last Name' },
      { key: 'email', header: 'Email' },
      {
        key: 'phone',
        header: 'Phone',
        format: (v: unknown) => String(v ?? ''),
      },
      {
        key: 'department',
        header: 'Department',
        format: (v: unknown) => (v && typeof v === 'object' && 'name' in v ? String((v as { name: string }).name) : ''),
      },
      {
        key: 'designation',
        header: 'Designation',
        format: (v: unknown) => (v && typeof v === 'object' && 'name' in v ? String((v as { name: string }).name) : ''),
      },
      { key: 'employmentType', header: 'Employment Type' },
      {
        key: 'dateOfJoining',
        header: 'Date of Joining',
        format: (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : ''),
      },
      { key: 'status', header: 'Status' },
      { key: 'emailDomainType', header: 'Email Type' },
    ];

    const exportData = data.map((row) => ({
      ...row,
      department: row.department && typeof row.department === 'object' && 'name' in row.department
        ? (row.department as { name: string }).name
        : '',
      designation: row.designation && typeof row.designation === 'object' && 'name' in row.designation
        ? (row.designation as { name: string }).name
        : '',
    }));

    if (format === 'csv') {
      return this.exportService.toCsv(exportData, columns);
    }
    if (format === 'xlsx') {
      return this.exportService.toXlsx(exportData, columns, { sheetName: 'Employees' });
    }
    return this.exportService.toPdf(exportData, columns, { title: 'Employees' });
  }

  async getOrgChart(
    tenant: TenantInfo,
    userId: string,
    roles: string[],
    rootEmployeeId?: string,
  ) {
    const scope = getDataScope(roles);

    const rows = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe(
        `SELECT u.id, u.employee_id, u.first_name, u.last_name, u.display_name, u.email, u.photo_url,
                u.email_domain_type, ep.reports_to, ep.department_id, ep.designation_id,
                d.name AS department_name, des.name AS designation_name
         FROM users u
         JOIN employee_profiles ep ON u.id = ep.user_id
         LEFT JOIN departments d ON ep.department_id = d.id
         LEFT JOIN designations des ON ep.designation_id = des.id
         WHERE u.status = 'active'`,
      );
    })) as Array<{
      id: string;
      employee_id: string | null;
      first_name: string;
      last_name: string;
      display_name: string | null;
      email: string;
      photo_url: string | null;
      email_domain_type: string;
      reports_to: string | null;
      department_id: string | null;
      designation_id: string | null;
      department_name: string | null;
      designation_name: string | null;
    }>;

    type NodeType = {
      id: string;
      employeeId: string | null;
      firstName: string;
      lastName: string;
      displayName: string;
      email: string;
      photoUrl: string | null;
      emailDomainType: string;
      department: { id: string; name: string } | null;
      designation: { id: string; name: string } | null;
      reportsTo: string | null;
      directReports: NodeType[];
      isOrphan: boolean;
    };

    const byId = new Map<string, NodeType>();

    const activeIds = new Set(rows.map((r) => r.id));
    for (const r of rows) {
      byId.set(r.id, {
        id: r.id,
        employeeId: r.employee_id,
        firstName: r.first_name,
        lastName: r.last_name,
        displayName: r.display_name ?? `${r.first_name} ${r.last_name}`,
        email: r.email,
        photoUrl: r.photo_url,
        emailDomainType: r.email_domain_type,
        department: r.department_id ? { id: r.department_id, name: r.department_name ?? '' } : null,
        designation: r.designation_id ? { id: r.designation_id, name: r.designation_name ?? '' } : null,
        reportsTo: r.reports_to,
        directReports: [],
        isOrphan: false,
      });
    }

    const roots: NodeType[] = [];

    for (const r of rows) {
      const node = byId.get(r.id)!;
      if (r.reports_to == null) {
        roots.push(node);
      } else if (!activeIds.has(r.reports_to)) {
        node.isOrphan = true;
        roots.push(node);
      } else {
        const parent = byId.get(r.reports_to);
        if (parent) parent.directReports.push(node);
        else {
          node.isOrphan = true;
          roots.push(node);
        }
      }
    }

    const toTreeNode = (n: NodeType): Record<string, unknown> => ({
      id: n.id,
      employeeId: n.employeeId,
      firstName: n.firstName,
      lastName: n.lastName,
      displayName: n.displayName,
      email: n.email,
      photoUrl: n.photoUrl,
      emailDomainType: n.emailDomainType,
      department: n.department,
      designation: n.designation,
      directReports: n.directReports.map((c) => toTreeNode(c)),
      isOrphan: n.isOrphan,
    });

    let result = roots.map(toTreeNode);

    if (scope === 'SELF') {
      const self = byId.get(userId);
      if (!self) return [];
      result = [toTreeNode(self)];
    } else if (scope === 'REPORTEES') {
      const self = byId.get(userId);
      if (!self) return [];
      result = [toTreeNode(self)];
    }

    if (rootEmployeeId) {
      const rootNode = byId.get(rootEmployeeId);
      if (!rootNode) return [];
      result = [toTreeNode(rootNode)];
    }

    return result;
  }
}
