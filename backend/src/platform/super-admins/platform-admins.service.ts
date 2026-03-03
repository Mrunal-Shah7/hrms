import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformEmailService } from '../../core/email/platform-email.service';
import { buildWelcomeEmailHtml } from '../../core/email/templates/welcome-email.template';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';

@Injectable()
export class PlatformAdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly platformEmail: PlatformEmailService,
  ) {}

  async list() {
    const rows = await this.prisma.queryRaw<{
      id: string;
      email: string;
      name: string;
      is_active: boolean;
      last_login_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, email, name, is_active, last_login_at, created_at
       FROM platform.super_admins
       ORDER BY created_at ASC`,
    );

    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      isActive: r.is_active,
      lastLoginAt: r.last_login_at,
      createdAt: r.created_at,
    }));
  }

  async create(dto: CreateAdminDto) {
    const existing = await this.prisma.queryRaw<{ id: string }>(
      `SELECT id FROM platform.super_admins WHERE email = $1 LIMIT 1`,
      dto.email,
    );
    if (existing.length > 0) {
      throw new ConflictException(
        'A super admin with this email already exists',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const rows = await this.prisma.queryRaw<{
      id: string;
      email: string;
      name: string;
      is_active: boolean;
      created_at: Date;
    }>(
      `INSERT INTO platform.super_admins (id, email, password_hash, name, is_active, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, TRUE, NOW())
       RETURNING id, email, name, is_active, created_at`,
      dto.email,
      passwordHash,
      dto.name,
    );

    const admin = rows[0];
    const frontendUrl = this.config.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );
    const loginUrl = `${frontendUrl}/platform/login`;

    const html = buildWelcomeEmailHtml({
      adminName: dto.name,
      organizationName: 'Platform Admin',
      loginUrl,
      username: dto.email,
      temporaryPassword: dto.password,
    });

    await this.platformEmail.send(
      dto.email,
      'Welcome to HRMS Platform Admin',
      html,
    );

    return {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      isActive: admin.is_active,
      createdAt: admin.created_at,
    };
  }

  async update(
    id: string,
    dto: UpdateAdminDto,
    currentSuperAdminId: string,
  ) {
    const rows = await this.prisma.queryRaw<{
      id: string;
      email: string;
      name: string;
      is_active: boolean;
      last_login_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, email, name, is_active, last_login_at, created_at
       FROM platform.super_admins WHERE id = $1 LIMIT 1`,
      id,
    );

    if (rows.length === 0) {
      throw new NotFoundException('Super admin not found');
    }

    const admin = rows[0];

    if (dto.isActive === false) {
      if (currentSuperAdminId === id) {
        throw new BadRequestException('Cannot deactivate your own account');
      }
      const activeCount = await this.prisma.queryRaw<{ count: string }>(
        `SELECT COUNT(*)::bigint as count FROM platform.super_admins WHERE is_active = TRUE`,
      );
      const count = parseInt(activeCount[0]?.count ?? '0', 10);
      if (count <= 1) {
        throw new BadRequestException(
          'Cannot deactivate the last active super admin',
        );
      }

      await this.prisma.executeRaw(
        `DELETE FROM platform.super_admin_sessions WHERE super_admin_id = $1`,
        id,
      );
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (dto.name !== undefined) {
      updates.push(`name = $${idx++}`);
      params.push(dto.name);
    }
    if (dto.isActive !== undefined) {
      updates.push(`is_active = $${idx++}`);
      params.push(dto.isActive);
    }

    if (updates.length === 0) {
      return {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        isActive: admin.is_active,
        lastLoginAt: admin.last_login_at,
        createdAt: admin.created_at,
      };
    }

    params.push(id);
    await this.prisma.executeRaw(
      `UPDATE platform.super_admins SET ${updates.join(', ')} WHERE id = $${idx}`,
      ...params,
    );

    const updated = await this.prisma.queryRaw<{
      id: string;
      email: string;
      name: string;
      is_active: boolean;
      last_login_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, email, name, is_active, last_login_at, created_at
       FROM platform.super_admins WHERE id = $1 LIMIT 1`,
      id,
    );

    const u = updated[0];
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      isActive: u.is_active,
      lastLoginAt: u.last_login_at,
      createdAt: u.created_at,
    };
  }

  async deactivate(id: string, currentSuperAdminId: string) {
    const rows = await this.prisma.queryRaw<{ id: string }>(
      `SELECT id FROM platform.super_admins WHERE id = $1 LIMIT 1`,
      id,
    );

    if (rows.length === 0) {
      throw new NotFoundException('Super admin not found');
    }

    if (currentSuperAdminId === id) {
      throw new BadRequestException('Cannot deactivate your own account');
    }

    const activeCount = await this.prisma.queryRaw<{ count: string }>(
      `SELECT COUNT(*)::bigint as count FROM platform.super_admins WHERE is_active = TRUE`,
    );
    const count = parseInt(activeCount[0]?.count ?? '0', 10);
    if (count <= 1) {
      throw new BadRequestException(
        'Cannot deactivate the last active super admin',
      );
    }

    await this.prisma.executeRaw(
      `UPDATE platform.super_admins SET is_active = FALSE WHERE id = $1`,
      id,
    );
    await this.prisma.executeRaw(
      `DELETE FROM platform.super_admin_sessions WHERE super_admin_id = $1`,
      id,
    );

    return { message: 'Super admin deactivated' };
  }
}
