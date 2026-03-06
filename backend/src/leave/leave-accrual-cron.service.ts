import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { BalanceEngineService } from './balances/balance-engine.service';

/**
 * Runs on the 1st of every month at 00:05 AM.
 * Recomputes leave balances for the current leave year for all tenants,
 * which applies monthly/quarterly accrual increments. Annual policies are idempotent.
 */
@Injectable()
export class LeaveAccrualCronService {
  private readonly logger = new Logger(LeaveAccrualCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly balanceEngine: BalanceEngineService,
  ) {}

  @Cron('5 0 1 * *')
  async runAccrual() {
    this.logger.log('Starting leave accrual for all tenants');
    const tenants = await this.prisma.withPlatformSchema(async (tx) => {
      return tx.$queryRawUnsafe<Array<{ id: string; schema_name: string; name: string }>>(
        `SELECT id, schema_name, name FROM tenants WHERE status NOT IN ('cancelled')`,
      );
    });
    let success = 0;
    let failed = 0;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    for (const t of tenants) {
      try {
        const fyRows = await this.prisma.withTenantSchema(t.schema_name, async (tx) => {
          return tx.$queryRawUnsafe<Array<{ financial_year_start_month: number }>>(
            `SELECT financial_year_start_month FROM organization_settings LIMIT 1`,
          );
        });
        const fyMonth = fyRows[0]?.financial_year_start_month ?? 1;
        const currentLeaveYear = month >= fyMonth ? year : year - 1;
        await this.balanceEngine.generateBalancesForYear(t.schema_name, currentLeaveYear, {});
        success++;
      } catch (err) {
        this.logger.warn(
          `Leave accrual failed for tenant ${t.name} (${t.id}): ${(err as Error).message}`,
        );
        failed++;
      }
    }
    this.logger.log(`Leave accrual complete: ${success} succeeded, ${failed} failed`);
  }
}
