import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(configService: ConfigService) {
    const connectionString = configService.get<string>('DATABASE_URL');
    if (!connectionString) throw new Error('DATABASE_URL is required');
    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Set the PostgreSQL search_path for tenant-scoped queries.
   * This is called by TenantMiddleware on every tenant-level request.
   */
  async setSchema(schemaName: string): Promise<void> {
    await this.$executeRawUnsafe(`SET search_path TO "${schemaName}"`);
  }

  /**
   * Set search_path back to the platform schema.
   */
  async setPlatformSchema(): Promise<void> {
    await this.$executeRawUnsafe(`SET search_path TO "platform"`);
  }

  /**
   * Execute a callback within a transaction that has the correct
   * tenant schema set. This guarantees all queries in the callback
   * use the same connection with the correct search_path.
   */
  async withTenantSchema<T>(
    schemaName: string,
    callback: (tx: PrismaClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET search_path TO "${schemaName}"`);
      return callback(tx as unknown as PrismaClient);
    });
  }

  /**
   * Execute a callback within a transaction on the platform schema.
   */
  async withPlatformSchema<T>(
    callback: (tx: PrismaClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET search_path TO "platform"`);
      return callback(tx as unknown as PrismaClient);
    });
  }

  /**
   * Execute raw SQL — used by the provisioning pipeline.
   * Supports parameterized queries: executeRaw('DELETE FROM x WHERE id = $1', id).
   */
  async executeRaw(sql: string, ...params: unknown[]): Promise<void> {
    await this.$executeRawUnsafe(sql, ...params);
  }

  /**
   * Query raw SQL — used for platform schema queries where Prisma
   * models aren't mapped to the platform schema directly.
   */
  async queryRaw<T = unknown>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.$queryRawUnsafe<T[]>(sql, ...params);
  }
}
