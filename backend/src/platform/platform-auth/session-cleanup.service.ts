import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

/** Schema names must match tenant schema pattern (e.g. tenant_acme_corp) for safety */
const TENANT_SCHEMA_REGEX = /^tenant_[a-z0-9_]+$/;

@Injectable()
export class SessionCleanupService {
  private readonly logger = new Logger(SessionCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanExpiredSessions() {
    try {
      // Platform sessions & OTPs
      await this.prisma.executeRaw(
        `DELETE FROM platform.super_admin_sessions WHERE expires_at < NOW()`,
      );

      await this.prisma.executeRaw(
        `DELETE FROM platform.super_admin_otps WHERE expires_at < NOW() OR used = TRUE`,
      );

      this.logger.log('Expired platform sessions and OTPs cleaned up');

      // Tenant sessions & OTPs across all active tenant schemas
      const tenants = (await this.prisma.queryRaw(
        `SELECT schema_name FROM platform.tenants WHERE status != 'cancelled'`,
      )) as { schema_name: string }[];

      let totalSessions = 0;
      let totalOtps = 0;

      for (const t of tenants) {
        const schema = t.schema_name;
        if (!TENANT_SCHEMA_REGEX.test(schema)) {
          this.logger.warn(`Skipping invalid schema name: ${schema}`);
          continue;
        }
        const quoted = `"${schema}"`;
        try {
          const sessionsResult = await this.prisma.$executeRawUnsafe(
            `DELETE FROM ${quoted}.user_sessions WHERE expires_at < NOW()`,
          );
          const otpsResult = await this.prisma.$executeRawUnsafe(
            `DELETE FROM ${quoted}.password_reset_otps WHERE expires_at < NOW() OR used = TRUE`,
          );
          totalSessions += Number(sessionsResult);
          totalOtps += Number(otpsResult);
        } catch (schemaErr) {
          const err = schemaErr as Error;
          this.logger.warn(`Cleanup failed for schema ${schema}: ${err.message}`);
        }
      }

      if (tenants.length > 0) {
        this.logger.log(
          `Tenant cleanup: ${totalSessions} sessions, ${totalOtps} OTPs removed across ${tenants.length} schemas`,
        );
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Session cleanup failed: ${err.message}`);
    }
  }
}
