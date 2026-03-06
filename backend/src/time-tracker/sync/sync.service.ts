import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantInfo } from '../../tenant/tenant.interface';
import { AdapterFactory } from '../adapters/adapter.factory';
import type { StandardPunchEvent } from '../adapters/adapter.interface';
import { SummaryService } from '../summary/summary.service';

export interface SyncResult {
  configId: string;
  configName: string;
  provider: string;
  syncWindow: { from: Date; to: Date };
  eventsFetched: number;
  eventsInserted: number;
  eventsDuplicate: number;
  unmatchedEvents: number;
  summariesComputed: number;
  warnings: string[];
  duration: number;
}

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaryService: SummaryService,
  ) {}

  async sync(
    tenant: TenantInfo,
    configId: string,
    sinceOverride?: Date,
    userId?: string,
  ): Promise<SyncResult> {
    const start = Date.now();
    const warnings: string[] = [];

    const result = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const configRows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          name: string;
          provider: string;
          config: unknown;
          is_active: boolean;
          last_sync_at: Date | null;
        }>
      >(`SELECT id, name, provider, config, is_active, last_sync_at FROM time_tracker_config WHERE id = $1::uuid`, configId);

      if (configRows.length === 0) {
        throw new NotFoundException('Integration not found');
      }
      const configRow = configRows[0];
      if (!configRow.is_active) {
        throw new BadRequestException('Integration is inactive');
      }

      const config = (configRow.config as Record<string, unknown>) ?? {};
      const adapter = AdapterFactory.create(configRow.provider, config);

      let since: Date;
      if (sinceOverride) {
        since = sinceOverride;
      } else if (configRow.last_sync_at) {
        since = new Date(configRow.last_sync_at);
      } else {
        since = new Date();
        since.setDate(since.getDate() - 30);
      }
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      if (since < ninetyDaysAgo) {
        since = ninetyDaysAgo;
        warnings.push('Sync window capped at 90 days');
      }
      const to = new Date();

      const rawEvents = await adapter.fetchLogs(since, { tx });
      const standardEvents = adapter.mapToStandardFormat(rawEvents);

      const employeeMatchField = (config.employeeMatchField as string) ?? 'employee_id';
      const employeeMap = await this.buildEmployeeMap(tx, employeeMatchField);

      let eventsInserted = 0;
      let eventsDuplicate = 0;
      const unmatched: StandardPunchEvent[] = [];
      const affectedUserDates = new Set<string>();

      for (const ev of standardEvents) {
        const userId = employeeMap.get(ev.employeeIdentifier);
        if (!userId) {
          unmatched.push(ev);
          continue;
        }

        const existing = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM time_logs WHERE user_id = $1::uuid AND punch_type = $2 AND punch_time = $3::timestamp LIMIT 1`,
          userId,
          ev.punchType,
          ev.punchTime,
        );
        if (existing.length > 0) {
          eventsDuplicate++;
          continue;
        }

        await tx.$executeRawUnsafe(
          `INSERT INTO time_logs (id, user_id, punch_type, punch_time, source, raw_data)
           VALUES (gen_random_uuid(), $1::uuid, $2, $3::timestamp, $4, $5::jsonb)`,
          userId,
          ev.punchType,
          ev.punchTime,
          configRow.name,
          ev.rawData ? JSON.stringify(ev.rawData) : null,
        );
        eventsInserted++;
        const dateKey = ev.punchTime instanceof Date ? ev.punchTime.toISOString().slice(0, 10) : String(ev.punchTime).slice(0, 10);
        affectedUserDates.add(`${userId}:${dateKey}`);
      }

      if (unmatched.length > 0) {
        warnings.push(`${unmatched.length} events could not be matched to employees`);
      }

      let summariesComputed = 0;
      for (const key of affectedUserDates) {
        const [uid, dateStr] = key.split(':');
        await this.summaryService.computeDailySummary(tx, uid, new Date(dateStr), tenant.schemaName);
        summariesComputed++;
      }

      await tx.$executeRawUnsafe(
        `UPDATE time_tracker_config SET last_sync_at = NOW(), updated_at = NOW() WHERE id = $1::uuid`,
        configId,
      );

      return {
        configId,
        configName: configRow.name,
        provider: configRow.provider,
        syncWindow: { from: since, to },
        eventsFetched: standardEvents.length,
        eventsInserted,
        eventsDuplicate,
        unmatchedEvents: unmatched.length,
        summariesComputed,
        warnings,
        duration: Date.now() - start,
      } as SyncResult;
    });

    if (userId) {
      await this.insertAuditLog(tenant.schemaName, userId, configId, result as SyncResult);
    }
    return result as SyncResult;
  }

  private async insertAuditLog(
    schemaName: string,
    userId: string,
    configId: string,
    result: SyncResult,
  ) {
    await this.prisma.withTenantSchema(schemaName, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO audit_logs (id, user_id, action, module, entity_type, entity_id, old_value, new_value, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NULL, $6::jsonb, NOW())`,
        userId,
        'execute',
        'time_tracker',
        'sync',
        configId,
        JSON.stringify({
          configName: result.configName,
          eventsInserted: result.eventsInserted,
          summariesComputed: result.summariesComputed,
        }),
      );
    });
  }

  private async buildEmployeeMap(
    tx: PrismaClient,
    matchField: string,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (matchField === 'email') {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string; email: string }>>(
        `SELECT id, email FROM users WHERE status = 'active'`,
      );
      for (const r of rows) {
        if (r.email) map.set(r.email, r.id);
      }
    } else {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string; employee_id: string | null }>>(
        `SELECT id, employee_id FROM users WHERE status = 'active'`,
      );
      for (const r of rows) {
        if (r.employee_id) map.set(r.employee_id, r.id);
      }
    }
    return map;
  }
}
