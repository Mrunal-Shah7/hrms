import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantInfo } from '../../tenant/tenant.interface';
import { SyncService } from './sync.service';

@Injectable()
export class SyncCronService {
  private readonly logger = new Logger(SyncCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly syncService: SyncService,
  ) {}

  @Cron('5 * * * *')
  async runHourlySync() {
    await this.runSyncForFrequency('hourly');
  }

  @Cron('10 0 * * *')
  async runDailySync() {
    await this.runSyncForFrequency('daily');
  }

  private async runSyncForFrequency(frequency: 'hourly' | 'daily') {
    this.logger.log(`Starting time tracker sync (${frequency}) for all tenants`);
    const tenants = await this.prisma.withPlatformSchema(async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{ id: string; schema_name: string; name: string }>
      >(`SELECT id, schema_name, name FROM tenants WHERE status NOT IN ('cancelled')`);
    });

    for (const t of tenants) {
      const tenant = {
        id: t.id,
        name: t.name,
        slug: '',
        schemaName: t.schema_name,
        subscriptionTier: 'standard' as const,
        maxUsers: 0,
        currentUserCount: 0,
        status: 'active' as const,
        customDomain: null,
      } as TenantInfo;

      const configs = await this.prisma.withTenantSchema(t.schema_name, async (tx) => {
        return tx.$queryRawUnsafe<
          Array<{ id: string; name: string; provider: string }>
        >(
          `SELECT id, name, provider FROM time_tracker_config WHERE is_active = true AND sync_frequency = $1`,
          frequency,
        );
      });

      for (const config of configs) {
        try {
          const result = await this.syncService.sync(tenant, config.id);
          this.logger.log(
            `[${t.name}] ${config.name} (${config.provider}): inserted=${result.eventsInserted}, summaries=${result.summariesComputed}`,
          );
        } catch (err) {
          this.logger.warn(
            `[${t.name}] ${config.name} sync failed: ${(err as Error).message}`,
          );
        }
      }
    }
  }
}
