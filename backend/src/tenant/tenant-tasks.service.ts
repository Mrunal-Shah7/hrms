import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformTenantsService } from '../platform/tenants/platform-tenants.service';

@Injectable()
export class TenantTasksService {
  private readonly logger = new Logger(TenantTasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformTenants: PlatformTenantsService,
  ) {}

  /**
   * Daily at 2:00 AM — recount users for all non-cancelled tenants to fix any drift.
   */
  @Cron('0 2 * * *')
  async handleDailyUserRecount() {
    this.logger.log('Starting daily user recount for all tenants');

    const tenants = await this.prisma.withPlatformSchema(async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{ id: string; name: string }>
      >(
        `SELECT id, name FROM tenants WHERE status NOT IN ('cancelled')`
      );
    });

    let success = 0;
    let failed = 0;

    for (const t of tenants) {
      try {
        await this.platformTenants.recountUsers(t.id);
        success++;
      } catch (err) {
        this.logger.error(
          `Recount failed for tenant ${t.name} (${t.id}): ${(err as Error).message}`,
        );
        failed++;
      }
    }

    this.logger.log(`Daily recount complete: ${success} succeeded, ${failed} failed`);
  }
}
