import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantInfo } from '../../tenant/tenant.interface';
import { AdapterFactory } from '../adapters/adapter.factory';
import type { CreateTimeTrackerConfigDto } from './dto/create-config.dto';
import type { UpdateTimeTrackerConfigDto } from './dto/update-config.dto';

const SENSITIVE_KEYS = /key|secret|password|token/i;
const MASK = '***';

function sanitizeConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = SENSITIVE_KEYS.test(k) ? MASK : v;
  }
  return out;
}

function deepMergePreserveMask(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...existing };
  for (const [k, v] of Object.entries(updates)) {
    if (v === MASK || (typeof v === 'string' && v === MASK)) {
      continue;
    }
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      (out as Record<string, unknown>)[k] = deepMergePreserveMask(
        (existing[k] as Record<string, unknown>) ?? {},
        v as Record<string, unknown>,
      );
    } else {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

export interface TimeTrackerConfigRow {
  id: string;
  name: string;
  provider: string;
  isActive: boolean;
  syncFrequency: string;
  lastSyncAt: string | null;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class TimeTrackerConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenant: TenantInfo): Promise<TimeTrackerConfigRow[]> {
    const rows = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{
          id: string;
          name: string;
          provider: string;
          is_active: boolean;
          sync_frequency: string;
          last_sync_at: Date | null;
          config: unknown;
          created_at: Date;
          updated_at: Date;
        }>
      >(
        `SELECT id, name, provider, is_active, sync_frequency, last_sync_at, config, created_at, updated_at
         FROM time_tracker_config ORDER BY name`,
      );
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      provider: r.provider,
      isActive: r.is_active,
      syncFrequency: r.sync_frequency,
      lastSyncAt: r.last_sync_at ? r.last_sync_at.toISOString() : null,
      config: sanitizeConfig((r.config as Record<string, unknown>) ?? {}),
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    }));
  }

  async getById(tenant: TenantInfo, id: string): Promise<TimeTrackerConfigRow | null> {
    const rows = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{
          id: string;
          name: string;
          provider: string;
          is_active: boolean;
          sync_frequency: string;
          last_sync_at: Date | null;
          config: unknown;
          created_at: Date;
          updated_at: Date;
        }>
      >(
        `SELECT id, name, provider, is_active, sync_frequency, last_sync_at, config, created_at, updated_at
         FROM time_tracker_config WHERE id = $1::uuid`,
        id,
      );
    });
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      provider: r.provider,
      isActive: r.is_active,
      syncFrequency: r.sync_frequency,
      lastSyncAt: r.last_sync_at ? r.last_sync_at.toISOString() : null,
      config: sanitizeConfig((r.config as Record<string, unknown>) ?? {}),
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  }

  async create(
    tenant: TenantInfo,
    userId: string,
    dto: CreateTimeTrackerConfigDto,
  ): Promise<TimeTrackerConfigRow> {
    const id = crypto.randomUUID();
    const isActive = dto.isActive ?? true;
    const syncFrequency = dto.syncFrequency ?? 'hourly';

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const existing = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM time_tracker_config WHERE name = $1`,
        dto.name,
      );
      if (existing.length > 0) {
        throw new ConflictException('Name already exists');
      }
      await tx.$executeRawUnsafe(
        `INSERT INTO time_tracker_config (id, name, provider, config, is_active, sync_frequency, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4::jsonb, $5, $6, NOW(), NOW())`,
        id,
        dto.name,
        dto.provider,
        JSON.stringify(dto.config ?? {}),
        isActive,
        syncFrequency,
      );
      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'create',
        'time_tracker',
        'config',
        id,
        null,
        { name: dto.name, provider: dto.provider },
      );
    });

    const row = await this.getById(tenant, id);
    if (!row) throw new NotFoundException('Integration not found');
    return row;
  }

  async update(
    tenant: TenantInfo,
    userId: string,
    id: string,
    dto: UpdateTimeTrackerConfigDto,
  ): Promise<TimeTrackerConfigRow> {
    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const existing = await tx.$queryRawUnsafe<
        Array<{ name: string; config: unknown }>
      >(`SELECT name, config FROM time_tracker_config WHERE id = $1::uuid`, id);
      if (existing.length === 0) {
        throw new NotFoundException('Integration not found');
      }
      const current = existing[0];
      if (dto.name !== undefined && dto.name !== current.name) {
        const dup = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM time_tracker_config WHERE name = $1 AND id != $2::uuid`,
          dto.name,
          id,
        );
        if (dup.length > 0) {
          throw new ConflictException('Name already exists');
        }
      }

      let config = current.config as Record<string, unknown>;
      if (dto.config !== undefined) {
        config = deepMergePreserveMask(config, dto.config);
      }

      const updates: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (dto.name !== undefined) {
        updates.push(`name = $${idx++}`);
        params.push(dto.name);
      }
      if (dto.provider !== undefined) {
        updates.push(`provider = $${idx++}`);
        params.push(dto.provider);
      }
      if (dto.config !== undefined) {
        updates.push(`config = $${idx++}::jsonb`);
        params.push(JSON.stringify(config));
      }
      if (dto.isActive !== undefined) {
        updates.push(`is_active = $${idx++}`);
        params.push(dto.isActive);
      }
      if (dto.syncFrequency !== undefined) {
        updates.push(`sync_frequency = $${idx++}`);
        params.push(dto.syncFrequency);
      }
      if (updates.length > 0) {
        updates.push(`updated_at = NOW()`);
        params.push(id);
        await tx.$executeRawUnsafe(
          `UPDATE time_tracker_config SET ${updates.join(', ')} WHERE id = $${idx}::uuid`,
          ...params,
        );
      }
      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'update',
        'time_tracker',
        'config',
        id,
        { name: current.name },
        { name: dto.name ?? current.name, config: sanitizeConfig(config) },
      );
    });

    const row = await this.getById(tenant, id);
    if (!row) throw new NotFoundException('Integration not found');
    return row;
  }

  async delete(
    tenant: TenantInfo,
    userId: string,
    id: string,
  ): Promise<{ message: string }> {
    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const configRow = await tx.$queryRawUnsafe<
        Array<{ name: string }>
      >(`SELECT name FROM time_tracker_config WHERE id = $1::uuid`, id);
      if (configRow.length === 0) {
        throw new NotFoundException('Integration not found');
      }
      const count = await tx.$queryRawUnsafe<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS count FROM time_logs WHERE source = $1`,
        configRow[0].name,
      );
      if (Number(count[0]?.count ?? 0) > 0) {
        throw new BadRequestException(
          'Cannot delete integration with existing time logs. Deactivate it instead.',
        );
      }
      await tx.$executeRawUnsafe(
        `DELETE FROM time_tracker_config WHERE id = $1::uuid`,
        id,
      );
      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'delete',
        'time_tracker',
        'config',
        id,
        { name: configRow[0].name },
        null,
      );
    });
    return { message: 'Integration deleted' };
  }

  async testConnection(tenant: TenantInfo, configId: string): Promise<{ success: boolean; message: string }> {
    const raw = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{ id: string; provider: string; config: unknown }>
      >(`SELECT id, provider, config FROM time_tracker_config WHERE id = $1::uuid`, configId);
      return rows[0] ?? null;
    });
    if (!raw) throw new NotFoundException('Integration not found');
    const adapter = AdapterFactory.create(raw.provider, (raw.config as Record<string, unknown>) ?? {});
    try {
      return await adapter.testConnection();
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }
  }

  private async insertAuditLog(
    schemaName: string,
    userId: string,
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
        userId,
        action,
        module,
        entityType,
        entityId,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
      );
    });
  }
}
