import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantInfo } from '../tenant/tenant.interface';
import type { CreateRoleDto } from './dto/create-role.dto';
import type { UpdateRoleDto } from './dto/update-role.dto';

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  is_system_role: boolean;
  is_custom: boolean;
  created_at: Date;
  updated_at: Date;
}

interface PermissionRow {
  id: string;
  module: string;
  action: string;
  resource: string;
  description: string | null;
}

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  async listRoles(tenant: TenantInfo) {
    const rows = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe<RoleRow[]>(
        `SELECT id, name, description, is_system_role, is_custom, created_at, updated_at
         FROM roles ORDER BY is_system_role DESC, name ASC`,
      );
    })) as RoleRow[];

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystemRole: r.is_system_role,
      isCustom: r.is_custom,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async createRole(tenant: TenantInfo, dto: CreateRoleDto) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const existing = (await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM roles WHERE name = $1 LIMIT 1`,
        dto.name,
      )) as { id: string }[];
      if (existing.length > 0) {
        throw new ConflictException('A role with this name already exists');
      }

      const placeholders = dto.permissionIds.map((_, i) => `$${i + 1}`).join(', ');
      const permCount = (await tx.$queryRawUnsafe<{ n: number }[]>(
        `SELECT COUNT(*)::int as n FROM permissions WHERE id IN (${placeholders})`,
        ...dto.permissionIds,
      )) as { n: number }[];
      if (permCount[0]?.n !== dto.permissionIds.length) {
        throw new BadRequestException('One or more permission IDs are invalid');
      }

      const inserted = (await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO roles (id, name, description, is_system_role, is_custom, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, FALSE, TRUE, NOW(), NOW())
         RETURNING id`,
        dto.name,
        dto.description ?? null,
      )) as { id: string }[];
      const roleId = inserted[0].id;

      for (const pid of dto.permissionIds) {
        await tx.$executeRawUnsafe(
          `INSERT INTO role_permissions (id, role_id, permission_id)
           VALUES (gen_random_uuid(), $1, $2)
           ON CONFLICT (role_id, permission_id) DO NOTHING`,
          roleId,
          pid,
        );
      }

      return this.getRoleWithPermissions(tx, roleId);
    });
  }

  async updateRole(tenant: TenantInfo, roleId: string, dto: UpdateRoleDto) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const roles = (await tx.$queryRawUnsafe<RoleRow[]>(
        `SELECT id, name, description, is_system_role, is_custom FROM roles WHERE id = $1`,
        roleId,
      )) as RoleRow[];
      if (roles.length === 0) throw new NotFoundException('Role not found');
      const role = roles[0];

      if (dto.name !== undefined && dto.name !== role.name) {
        if (role.is_system_role) {
          throw new BadRequestException('Cannot rename system roles');
        }
        const existing = (await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM roles WHERE name = $1 AND id != $2 LIMIT 1`,
          dto.name,
          roleId,
        )) as { id: string }[];
        if (existing.length > 0) {
          throw new ConflictException('A role with this name already exists');
        }
      }

      const updates: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (dto.name !== undefined && !role.is_system_role) {
        updates.push(`name = $${i++}`);
        params.push(dto.name);
      }
      if (dto.description !== undefined) {
        updates.push(`description = $${i++}`);
        params.push(dto.description);
      }
      if (updates.length > 0) {
        updates.push(`updated_at = NOW()`);
        params.push(roleId);
        await tx.$executeRawUnsafe(
          `UPDATE roles SET ${updates.join(', ')} WHERE id = $${i}`,
          ...params,
        );
      }

      if (dto.permissionIds !== undefined) {
        const placeholders = dto.permissionIds.map((_, i) => `$${i + 1}`).join(', ');
        const permCount = (await tx.$queryRawUnsafe<{ n: number }[]>(
          `SELECT COUNT(*)::int as n FROM permissions WHERE id IN (${placeholders})`,
          ...dto.permissionIds,
        )) as { n: number }[];
        if (permCount[0]?.n !== dto.permissionIds.length) {
          throw new BadRequestException('One or more permission IDs are invalid');
        }
        await tx.$executeRawUnsafe(
          `DELETE FROM role_permissions WHERE role_id = $1`,
          roleId,
        );
        for (const pid of dto.permissionIds) {
          await tx.$executeRawUnsafe(
            `INSERT INTO role_permissions (id, role_id, permission_id)
             VALUES (gen_random_uuid(), $1, $2)
             ON CONFLICT (role_id, permission_id) DO NOTHING`,
            roleId,
            pid,
          );
        }
      }

      return this.getRoleWithPermissions(tx, roleId);
    });
  }

  async deleteRole(tenant: TenantInfo, roleId: string) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const roles = (await tx.$queryRawUnsafe<{ is_system_role: boolean }[]>(
        `SELECT is_system_role FROM roles WHERE id = $1`,
        roleId,
      )) as { is_system_role: boolean }[];
      if (roles.length === 0) throw new NotFoundException('Role not found');
      if (roles[0].is_system_role) {
        throw new BadRequestException('System roles cannot be deleted');
      }

      const count = (await tx.$queryRawUnsafe<{ count: string }[]>(
        `SELECT COUNT(*)::text as count FROM user_roles WHERE role_id = $1`,
        roleId,
      )) as { count: string }[];
      const n = parseInt(count[0]?.count ?? '0', 10);
      if (n > 0) {
        throw new BadRequestException(
          `Cannot delete role — it is assigned to ${n} user(s). Remove the role from all users first.`,
        );
      }

      await tx.$executeRawUnsafe(
        `DELETE FROM role_permissions WHERE role_id = $1`,
        roleId,
      );
      await tx.$executeRawUnsafe(`DELETE FROM roles WHERE id = $1`, roleId);
      return { message: 'Role deleted successfully' };
    });
  }

  async getRolePermissions(tenant: TenantInfo, roleId: string) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const roles = (await tx.$queryRawUnsafe<RoleRow[]>(
        `SELECT id, name, description, is_system_role, is_custom FROM roles WHERE id = $1`,
        roleId,
      )) as RoleRow[];
      if (roles.length === 0) throw new NotFoundException('Role not found');

      const perms = (await tx.$queryRawUnsafe<PermissionRow[]>(
        `SELECT p.id, p.module, p.action, p.resource, p.description
         FROM permissions p
         JOIN role_permissions rp ON p.id = rp.permission_id
         WHERE rp.role_id = $1
         ORDER BY p.module, p.action, p.resource`,
        roleId,
      )) as PermissionRow[];

      return {
        role: {
          id: roles[0].id,
          name: roles[0].name,
          description: roles[0].description,
          isSystemRole: roles[0].is_system_role,
          isCustom: roles[0].is_custom,
        },
        permissions: perms.map((p) => ({
          id: p.id,
          module: p.module,
          action: p.action,
          resource: p.resource,
          description: p.description,
        })),
      };
    });
  }

  async listPermissionsGrouped(tenant: TenantInfo) {
    const rows = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe<PermissionRow[]>(
        `SELECT id, module, action, resource, description
         FROM permissions ORDER BY module, action, resource`,
      );
    })) as PermissionRow[];

    const grouped: Record<string, Array<{ id: string; action: string; resource: string; description: string | null }>> = {};
    for (const p of rows) {
      if (!grouped[p.module]) grouped[p.module] = [];
      grouped[p.module].push({
        id: p.id,
        action: p.action,
        resource: p.resource,
        description: p.description,
      });
    }
    return grouped;
  }

  async getUserRoles(tenant: TenantInfo, userId: string) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const userExists = (await tx.$queryRawUnsafe<{ n: number }[]>(
        `SELECT 1 as n FROM users WHERE id = $1 LIMIT 1`,
        userId,
      )) as { n: number }[];
      if (userExists.length === 0) throw new NotFoundException('User not found');

      const roleRows = (await tx.$queryRawUnsafe<
        { id: string; name: string; description: string | null; is_system_role: boolean; is_custom: boolean; assigned_by: string | null; assigned_at: Date }[]
      >(
        `SELECT r.id, r.name, r.description, r.is_system_role, r.is_custom, ur.assigned_by, ur.assigned_at
         FROM roles r
         JOIN user_roles ur ON r.id = ur.role_id
         WHERE ur.user_id = $1
         ORDER BY r.name`,
        userId,
      )) as { id: string; name: string; description: string | null; is_system_role: boolean; is_custom: boolean; assigned_by: string | null; assigned_at: Date }[];

      return roleRows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isSystemRole: r.is_system_role,
        isCustom: r.is_custom,
        assignedBy: r.assigned_by,
        assignedAt: r.assigned_at,
      }));
    });
  }

  async assignRolesToUser(
    tenant: TenantInfo,
    userId: string,
    roleIds: string[],
    assignedBy: string,
  ) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const userExists = (await tx.$queryRawUnsafe<{ n: number }[]>(
        `SELECT 1 as n FROM users WHERE id = $1 LIMIT 1`,
        userId,
      )) as { n: number }[];
      if (userExists.length === 0) throw new NotFoundException('User not found');

      const rolePlaceholders = roleIds.map((_, i) => `$${i + 1}`).join(', ');
      const roleCount = (await tx.$queryRawUnsafe<{ n: number }[]>(
        `SELECT COUNT(*)::int as n FROM roles WHERE id IN (${rolePlaceholders})`,
        ...roleIds,
      )) as { n: number }[];
      if (roleCount[0]?.n !== roleIds.length) {
        throw new BadRequestException('One or more role IDs are invalid');
      }

      for (const roleId of roleIds) {
        await tx.$executeRawUnsafe(
          `INSERT INTO user_roles (id, user_id, role_id, assigned_by, assigned_at)
           VALUES (gen_random_uuid(), $1, $2, $3, NOW())
           ON CONFLICT (user_id, role_id) DO NOTHING`,
          userId,
          roleId,
          assignedBy,
        );
      }

      return this.getUserRoles(tenant, userId);
    });
  }

  async removeRoleFromUser(
    tenant: TenantInfo,
    userId: string,
    roleId: string,
  ) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const exists = (await tx.$queryRawUnsafe<{ n: number }[]>(
        `SELECT 1 as n FROM user_roles WHERE user_id = $1 AND role_id = $2 LIMIT 1`,
        userId,
        roleId,
      )) as { n: number }[];
      if (exists.length === 0) {
        throw new NotFoundException('This role is not assigned to this user');
      }

      await tx.$executeRawUnsafe(
        `DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`,
        userId,
        roleId,
      );
      return { message: 'Role removed from user' };
    });
  }

  private async getRoleWithPermissions(
    tx: { $queryRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown> },
    roleId: string,
  ) {
    const roles = (await tx.$queryRawUnsafe(
      `SELECT id, name, description, is_system_role, is_custom, created_at, updated_at
       FROM roles WHERE id = $1`,
      roleId,
    )) as RoleRow[];
    if (roles.length === 0) throw new NotFoundException('Role not found');

    const perms = (await tx.$queryRawUnsafe(
      `SELECT p.id, p.module, p.action, p.resource, p.description
       FROM permissions p
       JOIN role_permissions rp ON p.id = rp.permission_id
       WHERE rp.role_id = $1
       ORDER BY p.module, p.action, p.resource`,
      roleId,
    )) as unknown as PermissionRow[];

    return {
      id: roles[0].id,
      name: roles[0].name,
      description: roles[0].description,
      isSystemRole: roles[0].is_system_role,
      isCustom: roles[0].is_custom,
      createdAt: roles[0].created_at,
      updatedAt: roles[0].updated_at,
      permissions: perms.map((p) => ({
        id: p.id,
        module: p.module,
        action: p.action,
        resource: p.resource,
        description: p.description,
      })),
    };
  }
}
