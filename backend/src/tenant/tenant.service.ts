import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantInfo } from './tenant.interface';

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  private cache = new Map<string, { data: TenantInfo; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async findBySlug(slug: string): Promise<TenantInfo | null> {
    const cacheKey = `slug:${slug}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const rows = await this.prisma.queryRaw<Record<string, unknown>>(
      `SELECT id, name, slug, schema_name, subscription_tier, max_users,
              current_user_count, status, custom_domain
       FROM platform.tenants WHERE slug = $1 LIMIT 1`,
      slug,
    );

    if (rows.length === 0) return null;
    const tenant = this.mapRowToTenantInfo(rows[0]);
    this.setCache(cacheKey, tenant);
    return tenant;
  }

  async findByCustomDomain(domain: string): Promise<TenantInfo | null> {
    const cacheKey = `domain:${domain}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const rows = await this.prisma.queryRaw<Record<string, unknown>>(
      `SELECT id, name, slug, schema_name, subscription_tier, max_users,
              current_user_count, status, custom_domain
       FROM platform.tenants WHERE custom_domain = $1 LIMIT 1`,
      domain,
    );

    if (rows.length === 0) return null;
    const tenant = this.mapRowToTenantInfo(rows[0]);
    this.setCache(cacheKey, tenant);
    return tenant;
  }

  async findById(id: string): Promise<TenantInfo | null> {
    const cacheKey = `id:${id}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const rows = await this.prisma.queryRaw<Record<string, unknown>>(
      `SELECT id, name, slug, schema_name, subscription_tier, max_users,
              current_user_count, status, custom_domain
       FROM platform.tenants WHERE id = $1 LIMIT 1`,
      id,
    );

    if (rows.length === 0) return null;
    const tenant = this.mapRowToTenantInfo(rows[0]);
    this.setCache(cacheKey, tenant);
    return tenant;
  }

  invalidateCache(slug?: string, domain?: string, id?: string): void {
    if (slug) this.cache.delete(`slug:${slug}`);
    if (domain) this.cache.delete(`domain:${domain}`);
    if (id) this.cache.delete(`id:${id}`);
  }

  clearCache(): void {
    this.cache.clear();
  }

  private mapRowToTenantInfo(row: Record<string, unknown>): TenantInfo {
    return {
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      schemaName: row.schema_name as string,
      subscriptionTier: row.subscription_tier as 'standard' | 'with_recruitment',
      maxUsers: row.max_users as number,
      currentUserCount: row.current_user_count as number,
      status: row.status as 'active' | 'suspended' | 'cancelled' | 'trial',
      customDomain: row.custom_domain as string | null,
    };
  }

  private getFromCache(key: string): TenantInfo | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  private setCache(key: string, data: TenantInfo): void {
    this.cache.set(key, { data, expiresAt: Date.now() + this.CACHE_TTL_MS });
  }
}
