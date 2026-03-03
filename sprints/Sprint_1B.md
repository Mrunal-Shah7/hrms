# Sprint 1B — Multi-Tenancy Engine

## Goal
Build the schema-per-tenant isolation layer: TenantMiddleware that resolves tenants from incoming requests, dynamic Prisma `search_path` switching per request, the full tenant provisioning pipeline (create PostgreSQL schema → create all ~65 tables → seed default data → create admin user), and platform/public route bypass logic. By the end of this sprint, you should be able to programmatically provision a new tenant and have its schema fully ready with default roles, permissions, leave types, work schedule, candidate stages, and organization settings.

---

## 1. Overview of What Gets Built

| Component | Location | Purpose |
|---|---|---|
| `TenantModule` | `backend/src/tenant/tenant.module.ts` | NestJS module encapsulating all tenant logic |
| `TenantService` | `backend/src/tenant/tenant.service.ts` | Resolves tenants from DB, caches lookups |
| `TenantMiddleware` | `backend/src/common/middleware/tenant.middleware.ts` | Runs on every request, resolves tenant, sets `search_path` |
| `TenantProvisioningService` | `backend/src/tenant/tenant-provisioning.service.ts` | Creates schema, tables, seeds defaults, creates admin |
| `@TenantContext()` decorator | `backend/src/common/decorators/tenant.decorator.ts` | Injects resolved tenant info into controller handlers |
| `TenantInfo` interface | `backend/src/tenant/tenant.interface.ts` | TypeScript type for tenant context |
| Tenant SQL DDL | `backend/prisma/tenant-schema.sql` | Full DDL for all ~65 tenant tables |
| Tenant seed data | `backend/prisma/tenant-seed-data.ts` | Default roles, permissions, leave types, etc. |

---

## 2. Tenant Interfaces & Types

### 2.1 Create `backend/src/tenant/tenant.interface.ts`

```typescript
export interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  schemaName: string;
  subscriptionTier: 'standard' | 'with_recruitment';
  maxUsers: number;
  currentUserCount: number;
  status: 'active' | 'suspended' | 'cancelled' | 'trial';
  customDomain: string | null;
}

export interface ProvisionTenantInput {
  name: string;
  slug: string;
  billingEmail: string;
  subscriptionTier: 'standard' | 'with_recruitment';
  maxUsers: number;
  customDomain?: string;
  registrationSource: 'self_service' | 'super_admin';
  adminName: string;
  adminEmail: string;
  adminPasswordHash: string;
}

export interface ProvisionTenantResult {
  tenantId: string;
  schemaName: string;
  adminUserId: string;
  slug: string;
}
```

---

## 3. Enhance PrismaService for Request-Scoped Schema Switching

### 3.1 Important: Prisma Connection Pooling Caveat

Prisma uses a connection pool internally. When we call `SET search_path TO 'tenant_xyz'`, that only affects the specific connection from the pool used for that call. Subsequent queries in the same request might get a different connection with a different `search_path`.

**Solution:** We use `$transaction` to ensure all queries in a single request go through the same connection with the correct schema. Alternatively, for simpler cases, we call `setSchema()` before each service method. In practice, the most reliable approach is to:

1. Call `setSchema()` in the middleware for every request.
2. For critical multi-query operations, wrap them in a `$transaction`.
3. Accept that each individual Prisma call in a request should be preceded by a schema set OR use the `$transaction` API.

Since Prisma doesn't support request-scoped clients cleanly, we'll implement a pragmatic approach: **the middleware sets the schema, and each service call that touches tenant data will use a helper that sets the schema before executing.**

### 3.2 Update `backend/src/prisma/prisma.service.ts`

Replace the existing file with:

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Set the PostgreSQL search_path for tenant-scoped queries.
   * IMPORTANT: Due to connection pooling, this must be called before
   * each query or group of queries. For multi-query operations,
   * use withTenantSchema() which wraps in a transaction.
   */
  async setSchema(schemaName: string): Promise<void> {
    await this.$executeRawUnsafe(`SET search_path TO "${schemaName}"`);
  }

  /**
   * Set search_path to the platform schema.
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
   */
  async executeRaw(sql: string): Promise<void> {
    await this.$executeRawUnsafe(sql);
  }

  /**
   * Query raw SQL — used for platform schema queries where Prisma
   * models aren't mapped to the platform schema directly.
   */
  async queryRaw<T = any>(sql: string, ...params: any[]): Promise<T[]> {
    return this.$queryRawUnsafe<T[]>(sql, ...params);
  }
}
```

---

## 4. Tenant Service

### 4.1 Create `backend/src/tenant/tenant.service.ts`

This service handles tenant lookups against the `platform.tenants` table. It includes a simple in-memory cache to avoid hitting the DB on every single request.

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantInfo } from './tenant.interface';

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  // Simple in-memory cache: slug/domain → TenantInfo, TTL 5 minutes
  private cache = new Map<string, { data: TenantInfo; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve tenant by slug (from subdomain).
   */
  async findBySlug(slug: string): Promise<TenantInfo | null> {
    const cacheKey = `slug:${slug}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const rows = await this.prisma.queryRaw<any>(
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

  /**
   * Resolve tenant by custom domain.
   */
  async findByCustomDomain(domain: string): Promise<TenantInfo | null> {
    const cacheKey = `domain:${domain}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const rows = await this.prisma.queryRaw<any>(
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

  /**
   * Resolve tenant by ID (from X-Tenant-ID header).
   */
  async findById(id: string): Promise<TenantInfo | null> {
    const cacheKey = `id:${id}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const rows = await this.prisma.queryRaw<any>(
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

  /**
   * Invalidate cache for a specific tenant (call after updates).
   */
  invalidateCache(slug?: string, domain?: string, id?: string): void {
    if (slug) this.cache.delete(`slug:${slug}`);
    if (domain) this.cache.delete(`domain:${domain}`);
    if (id) this.cache.delete(`id:${id}`);
  }

  /**
   * Invalidate all cached tenants.
   */
  clearCache(): void {
    this.cache.clear();
  }

  // --- Private helpers ---

  private mapRowToTenantInfo(row: any): TenantInfo {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      schemaName: row.schema_name,
      subscriptionTier: row.subscription_tier,
      maxUsers: row.max_users,
      currentUserCount: row.current_user_count,
      status: row.status,
      customDomain: row.custom_domain,
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
```

---

## 5. Tenant Middleware

### 5.1 Create `backend/src/common/middleware/tenant.middleware.ts`

This middleware runs on every incoming request EXCEPT platform routes (`/api/platform/*`) and public routes (`/api/public/*`). It resolves the tenant using 3 strategies in priority order:

1. **Custom domain** — Match `Host` header against `tenants.custom_domain`
2. **Subdomain** — Extract slug from `{slug}.{PLATFORM_DOMAIN}`
3. **Header** — `X-Tenant-ID` header (UUID)

On successful resolution, it attaches the `TenantInfo` to the request object and sets the Prisma `search_path` to the tenant's schema.

```typescript
import { Injectable, NestMiddleware, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { TenantService } from '../../tenant/tenant.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantInfo } from '../../tenant/tenant.interface';

// Extend Express Request to include tenant info
declare global {
  namespace Express {
    interface Request {
      tenant?: TenantInfo;
    }
  }
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);
  private readonly platformDomain: string;

  constructor(
    private readonly tenantService: TenantService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.platformDomain = this.config.get<string>('PLATFORM_DOMAIN', 'localhost:3000');
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Skip for platform and public routes — these are excluded at the module level
    // via route configuration, but double-check here as a safety net
    if (req.path.startsWith('/api/platform') || req.path.startsWith('/api/public')) {
      return next();
    }

    let tenant: TenantInfo | null = null;

    // Strategy 1: Custom domain
    const host = req.headers.host || '';
    if (host && !host.includes(this.platformDomain) && !host.includes('localhost')) {
      tenant = await this.tenantService.findByCustomDomain(host.split(':')[0]);
      if (tenant) {
        this.logger.debug(`Tenant resolved via custom domain: ${host} → ${tenant.slug}`);
      }
    }

    // Strategy 2: Subdomain
    if (!tenant) {
      const slug = this.extractSubdomain(host);
      if (slug) {
        tenant = await this.tenantService.findBySlug(slug);
        if (tenant) {
          this.logger.debug(`Tenant resolved via subdomain: ${slug} → ${tenant.schemaName}`);
        }
      }
    }

    // Strategy 3: X-Tenant-ID header
    if (!tenant) {
      const tenantId = req.headers['x-tenant-id'] as string;
      if (tenantId) {
        tenant = await this.tenantService.findById(tenantId);
        if (tenant) {
          this.logger.debug(`Tenant resolved via X-Tenant-ID: ${tenantId} → ${tenant.schemaName}`);
        }
      }
    }

    // For localhost development: also try X-Tenant-Slug header as convenience
    if (!tenant) {
      const tenantSlug = req.headers['x-tenant-slug'] as string;
      if (tenantSlug) {
        tenant = await this.tenantService.findBySlug(tenantSlug);
        if (tenant) {
          this.logger.debug(`Tenant resolved via X-Tenant-Slug: ${tenantSlug} → ${tenant.schemaName}`);
        }
      }
    }

    // If no tenant resolved, reject the request
    if (!tenant) {
      throw new HttpException(
        {
          success: false,
          error: {
            code: 'TENANT_NOT_FOUND',
            message: 'Unable to resolve organization. Please check your URL or contact support.',
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }

    // Check tenant status
    if (tenant.status === 'suspended') {
      throw new HttpException(
        {
          success: false,
          error: {
            code: 'TENANT_SUSPENDED',
            message: 'Your organization\'s account has been suspended. Please contact your administrator.',
          },
        },
        HttpStatus.FORBIDDEN,
      );
    }

    if (tenant.status === 'cancelled') {
      throw new HttpException(
        {
          success: false,
          error: {
            code: 'TENANT_CANCELLED',
            message: 'Your organization\'s account has been cancelled.',
          },
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // Attach tenant to request
    req.tenant = tenant;

    // Set PostgreSQL search_path for this request
    await this.prisma.setSchema(tenant.schemaName);

    next();
  }

  /**
   * Extract subdomain slug from Host header.
   * e.g., "acme-corp.platform-domain.com" → "acme-corp"
   * Returns null if no subdomain or if host is the platform domain itself.
   */
  private extractSubdomain(host: string): string | null {
    if (!host) return null;

    // Remove port
    const hostname = host.split(':')[0];

    // For localhost development, subdomain won't work normally.
    // Developers can use X-Tenant-ID or X-Tenant-Slug headers instead.
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return null;
    }

    const platformHostname = this.platformDomain.split(':')[0];
    if (!hostname.endsWith(platformHostname)) return null;

    // Extract the part before the platform domain
    const subdomain = hostname.replace(`.${platformHostname}`, '');

    // If subdomain equals the full hostname, there was no subdomain
    if (subdomain === hostname || subdomain === '' || subdomain === 'www') {
      return null;
    }

    return subdomain;
  }
}
```

---

## 6. Tenant Context Decorator

### 6.1 Create `backend/src/common/decorators/tenant.decorator.ts`

This custom decorator extracts the resolved `TenantInfo` from the request, so controllers can access it cleanly.

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantInfo } from '../../tenant/tenant.interface';

/**
 * Injects the resolved TenantInfo into a controller method parameter.
 *
 * Usage:
 * ```
 * @Get('employees')
 * getEmployees(@TenantContext() tenant: TenantInfo) {
 *   console.log(tenant.schemaName);
 * }
 * ```
 */
export const TenantContext = createParamDecorator(
  (data: keyof TenantInfo | undefined, ctx: ExecutionContext): TenantInfo | any => {
    const request = ctx.switchToHttp().getRequest();
    const tenant = request.tenant as TenantInfo;

    if (!tenant) {
      return null;
    }

    // If a specific property is requested, return just that property
    return data ? tenant[data] : tenant;
  },
);
```

---

## 7. Tenant Provisioning Pipeline

This is the most critical piece — the service that creates a new tenant's entire database schema with all tables and seed data.

### 7.1 Create Tenant DDL SQL

Create `backend/prisma/tenant-schema.sql`. This file contains the full DDL to create all ~65 tenant tables inside a given schema. The provisioning service replaces `__SCHEMA_NAME__` at runtime.

```sql
-- ============================================================================
-- TENANT SCHEMA DDL
-- Creates all ~65 tables for a single tenant.
-- __SCHEMA_NAME__ is replaced at runtime by the provisioning service.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS "__SCHEMA_NAME__";

SET search_path TO "__SCHEMA_NAME__";

-- === CORE: Users & Auth ===

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(50) UNIQUE,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    display_name VARCHAR(100),
    phone VARCHAR(20),
    photo_url TEXT,
    email_domain_type VARCHAR(20) NOT NULL DEFAULT 'company',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    must_reset_password BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE password_reset_otps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    otp_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(255) NOT NULL,
    device_info JSONB NOT NULL DEFAULT '{}',
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- === CORE: RBAC ===

CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    resource VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(module, action, resource)
);

CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
    is_custom BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    UNIQUE(role_id, permission_id)
);

CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_by UUID,
    assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, role_id)
);

-- === SHARED SERVICES ===

CREATE TABLE file_storage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    data BYTEA,
    uploaded_by UUID NOT NULL REFERENCES users(id),
    context VARCHAR(100),
    context_id UUID,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE email_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(20) NOT NULL,
    config JSONB NOT NULL,
    from_email VARCHAR(255) NOT NULL,
    from_name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE notification_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_type VARCHAR(100) UNIQUE NOT NULL,
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    module VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    old_value JSONB,
    new_value JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE organization_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_name VARCHAR(255) NOT NULL,
    custom_domain VARCHAR(255),
    default_timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
    date_format VARCHAR(20) NOT NULL DEFAULT 'DD-MMM-YYYY',
    financial_year_start_month INT NOT NULL DEFAULT 1,
    default_currency VARCHAR(10) NOT NULL DEFAULT 'USD'
);

-- === EMPLOYEE MANAGEMENT ===

CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    mail_alias VARCHAR(255),
    head_id UUID,
    parent_id UUID REFERENCES departments(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE designations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    hierarchy_level INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE employee_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id),
    designation_id UUID REFERENCES designations(id),
    reports_to UUID,
    employment_type VARCHAR(20) NOT NULL,
    date_of_joining DATE NOT NULL,
    date_of_birth DATE,
    gender VARCHAR(20),
    marital_status VARCHAR(20),
    blood_group VARCHAR(10),
    emergency_contact_name VARCHAR(255),
    emergency_contact_phone VARCHAR(20),
    emergency_contact_relation VARCHAR(50),
    present_address JSONB,
    permanent_address JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE reporting_hierarchy (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    designation_id UUID UNIQUE NOT NULL,
    reports_to_designation_id UUID,
    level INT NOT NULL DEFAULT 0
);

CREATE TABLE groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    added_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(group_id, user_id)
);

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    manager_id UUID NOT NULL,
    budget DECIMAL(12,2),
    start_date DATE,
    end_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE project_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role VARCHAR(50),
    added_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, user_id)
);

CREATE TABLE project_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    assignee_id UUID,
    status VARCHAR(20) NOT NULL DEFAULT 'todo',
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    due_date DATE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE delegations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delegator_id UUID NOT NULL,
    delegatee_id UUID NOT NULL,
    type VARCHAR(100) NOT NULL,
    description TEXT,
    start_date DATE NOT NULL,
    end_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- === LEAVE MANAGEMENT ===

CREATE TABLE leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    color VARCHAR(7),
    icon VARCHAR(50),
    is_paid BOOLEAN NOT NULL DEFAULT TRUE,
    max_consecutive_days INT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE leave_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
    designation_id UUID,
    department_id UUID,
    employment_type VARCHAR(20),
    annual_allocation FLOAT NOT NULL,
    carry_forward BOOLEAN NOT NULL DEFAULT FALSE,
    max_carry_forward FLOAT,
    accrual_type VARCHAR(20) NOT NULL DEFAULT 'annual',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE leave_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
    year INT NOT NULL,
    total_allocated FLOAT NOT NULL DEFAULT 0,
    carried_forward FLOAT NOT NULL DEFAULT 0,
    used FLOAT NOT NULL DEFAULT 0,
    UNIQUE(user_id, leave_type_id, year)
);

CREATE TABLE leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    duration_type VARCHAR(20) NOT NULL DEFAULT 'full_day',
    total_days FLOAT NOT NULL,
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    reviewed_by UUID,
    review_comment TEXT,
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE holidays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    is_optional BOOLEAN NOT NULL DEFAULT FALSE,
    year INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- === TIME TRACKER ===

CREATE TABLE time_tracker_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    config JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sync_frequency VARCHAR(20) NOT NULL DEFAULT 'hourly',
    last_sync_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE time_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    punch_type VARCHAR(10) NOT NULL,
    punch_time TIMESTAMP NOT NULL,
    source VARCHAR(50) NOT NULL,
    raw_data JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE daily_time_summary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    date DATE NOT NULL,
    first_punch_in TIMESTAMP,
    last_punch_out TIMESTAMP,
    total_hours FLOAT NOT NULL DEFAULT 0,
    effective_hours FLOAT NOT NULL DEFAULT 0,
    overtime_hours FLOAT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'present',
    is_late BOOLEAN NOT NULL DEFAULT FALSE,
    is_early_departure BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, date)
);

-- === ATTENDANCE ===

CREATE TABLE work_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    start_time VARCHAR(5) NOT NULL,
    end_time VARCHAR(5) NOT NULL,
    working_days JSONB NOT NULL,
    grace_period_minutes INT NOT NULL DEFAULT 0,
    min_hours_full_day FLOAT NOT NULL DEFAULT 8,
    min_hours_half_day FLOAT NOT NULL DEFAULT 4,
    overtime_threshold_hours FLOAT NOT NULL DEFAULT 9,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE attendance_regularizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    date DATE NOT NULL,
    reason TEXT NOT NULL,
    punch_in VARCHAR(5),
    punch_out VARCHAR(5),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    reviewed_by UUID,
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- === PERFORMANCE ===

CREATE TABLE goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    assigned_to_id UUID NOT NULL REFERENCES users(id),
    assigned_to_type VARCHAR(20) NOT NULL DEFAULT 'user',
    created_by_id UUID NOT NULL REFERENCES users(id),
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    status VARCHAR(20) NOT NULL DEFAULT 'not_started',
    progress INT NOT NULL DEFAULT 0,
    start_date DATE,
    due_date DATE,
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE goal_progress_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    old_progress INT NOT NULL,
    new_progress INT NOT NULL,
    note TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE performance_review_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE performance_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id UUID NOT NULL REFERENCES performance_review_cycles(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES users(id),
    reviewer_id UUID NOT NULL REFERENCES users(id),
    rating INT,
    comments TEXT,
    strengths TEXT,
    improvements TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    submitted_at TIMESTAMP,
    acknowledged_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- === FILES ===

CREATE TABLE file_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES file_folders(id),
    scope VARCHAR(20) NOT NULL DEFAULT 'personal',
    owner_id UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE file_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    storage_id UUID NOT NULL,
    folder_id UUID REFERENCES file_folders(id),
    scope VARCHAR(20) NOT NULL DEFAULT 'personal',
    owner_id UUID NOT NULL,
    department_id UUID,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE file_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_record_id UUID NOT NULL REFERENCES file_records(id) ON DELETE CASCADE,
    shared_with_id UUID NOT NULL,
    permission VARCHAR(20) NOT NULL DEFAULT 'view',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(file_record_id, shared_with_id)
);

-- === COMPENSATION ===

CREATE TABLE salary_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    type VARCHAR(20) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE employee_salaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ctc DECIMAL(12,2) NOT NULL,
    effective_from DATE NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE salary_breakdowns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_salary_id UUID NOT NULL REFERENCES employee_salaries(id) ON DELETE CASCADE,
    component_id UUID NOT NULL REFERENCES salary_components(id),
    amount DECIMAL(12,2) NOT NULL
);

CREATE TABLE payslips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month INT NOT NULL,
    year INT NOT NULL,
    gross_pay DECIMAL(12,2) NOT NULL,
    deductions DECIMAL(12,2) NOT NULL,
    net_pay DECIMAL(12,2) NOT NULL,
    breakdown JSONB NOT NULL,
    pdf_storage_id UUID,
    generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, month, year)
);

CREATE TABLE appraisal_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    reviewer_id UUID NOT NULL REFERENCES users(id),
    effective_date DATE NOT NULL,
    previous_ctc DECIMAL(12,2) NOT NULL,
    new_ctc DECIMAL(12,2) NOT NULL,
    increment_percent FLOAT NOT NULL,
    comments TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- === RECRUITMENT ===

CREATE TABLE job_openings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    department_id UUID,
    designation_id UUID,
    employment_type VARCHAR(20) NOT NULL,
    experience VARCHAR(50),
    salary_range JSONB,
    location VARCHAR(255),
    openings INT NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    publish_token VARCHAR(100) UNIQUE,
    published_at TIMESTAMP,
    closed_at TIMESTAMP,
    created_by UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE candidate_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    order_index INT NOT NULL,
    color VARCHAR(7),
    is_default BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_opening_id UUID NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
    stage_id UUID NOT NULL REFERENCES candidate_stages(id),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    resume_storage_id UUID,
    cover_letter TEXT,
    source VARCHAR(50),
    owner_id UUID,
    rating INT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE candidate_stage_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    stage_id UUID NOT NULL REFERENCES candidate_stages(id),
    moved_by UUID NOT NULL,
    moved_at TIMESTAMP NOT NULL DEFAULT NOW(),
    note TEXT
);

CREATE TABLE candidate_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    author_id UUID NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE interviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_opening_id UUID NOT NULL REFERENCES job_openings(id),
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    scheduled_at TIMESTAMP NOT NULL,
    duration_minutes INT NOT NULL DEFAULT 60,
    type VARCHAR(50) NOT NULL,
    location VARCHAR(255),
    meeting_link TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    notes TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE interview_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
    interviewer_id UUID NOT NULL,
    rating INT,
    recommendation VARCHAR(20),
    comments TEXT,
    submitted_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    time_limit_minutes INT,
    created_by UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE assessment_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL,
    question TEXT NOT NULL,
    options JSONB,
    correct_answer TEXT,
    points INT NOT NULL DEFAULT 1,
    order_index INT NOT NULL
);

CREATE TABLE assessment_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES assessments(id),
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    answers JSONB NOT NULL,
    score INT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    submitted_at TIMESTAMP,
    evaluated_by UUID,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID,
    job_opening_id UUID,
    referred_by_id UUID NOT NULL,
    candidate_name VARCHAR(255) NOT NULL,
    candidate_email VARCHAR(255) NOT NULL,
    candidate_phone VARCHAR(20),
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'submitted',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE offer_letters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    designation VARCHAR(255) NOT NULL,
    ctc_offered DECIMAL(12,2) NOT NULL,
    joining_date DATE NOT NULL,
    content TEXT NOT NULL,
    pdf_storage_id UUID,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    sent_at TIMESTAMP,
    responded_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE recruitment_email_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    candidate_ids JSONB NOT NULL,
    sent_by UUID NOT NULL,
    sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL DEFAULT 'sent',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- === ONBOARDING ===

CREATE TABLE onboarding_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE onboarding_checklist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES onboarding_templates(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    order_index INT NOT NULL
);

CREATE TABLE onboarding_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES onboarding_templates(id),
    candidate_name VARCHAR(255) NOT NULL,
    candidate_email VARCHAR(255) NOT NULL,
    candidate_phone VARCHAR(20),
    department_id UUID,
    designation_id UUID,
    source VARCHAR(50),
    candidate_id UUID,
    personal_details JSONB,
    sensitive_fields JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    converted_user_id UUID,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE onboarding_checklist_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    onboarding_id UUID NOT NULL REFERENCES onboarding_records(id) ON DELETE CASCADE,
    checklist_item_id UUID NOT NULL REFERENCES onboarding_checklist_items(id),
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    completed_by UUID,
    completed_at TIMESTAMP,
    notes TEXT,
    UNIQUE(onboarding_id, checklist_item_id)
);

-- === OFFBOARDING ===

CREATE TABLE offboarding_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE offboarding_template_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES offboarding_templates(id) ON DELETE CASCADE,
    notice_period_days INT NOT NULL DEFAULT 30,
    approval_chain JSONB NOT NULL
);

CREATE TABLE offboarding_clearances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES offboarding_templates(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    assigned_to VARCHAR(100) NOT NULL,
    order_index INT NOT NULL,
    fields JSONB
);

CREATE TABLE offboarding_exit_interview_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES offboarding_templates(id) ON DELETE CASCADE
);

CREATE TABLE exit_interview_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exit_interview_template_id UUID NOT NULL REFERENCES offboarding_exit_interview_templates(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    type VARCHAR(20) NOT NULL,
    options JSONB,
    order_index INT NOT NULL
);

CREATE TABLE offboarding_required_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES offboarding_templates(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    is_required BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE offboarding_workflow_triggers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES offboarding_templates(id) ON DELETE CASCADE,
    event VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    config JSONB
);

CREATE TABLE offboarding_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    template_id UUID NOT NULL REFERENCES offboarding_templates(id),
    type VARCHAR(20) NOT NULL,
    reason TEXT,
    last_working_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'initiated',
    current_step VARCHAR(20) NOT NULL DEFAULT 'preferences',
    approved_by UUID,
    approved_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE offboarding_clearance_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offboarding_id UUID NOT NULL REFERENCES offboarding_records(id) ON DELETE CASCADE,
    clearance_name VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    cleared_by UUID,
    cleared_at TIMESTAMP,
    notes TEXT
);

CREATE TABLE exit_interview_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offboarding_id UUID NOT NULL REFERENCES offboarding_records(id) ON DELETE CASCADE,
    question_id UUID NOT NULL,
    response TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE offboarding_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offboarding_id UUID NOT NULL REFERENCES offboarding_records(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    storage_id UUID NOT NULL,
    uploaded_by UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE data_retention_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    retention_days INT NOT NULL DEFAULT 365,
    auto_delete_enabled BOOLEAN NOT NULL DEFAULT FALSE
);

-- Create indexes for performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_employee_profiles_department ON employee_profiles(department_id);
CREATE INDEX idx_employee_profiles_designation ON employee_profiles(designation_id);
CREATE INDEX idx_employee_profiles_reports_to ON employee_profiles(reports_to);
CREATE INDEX idx_leave_requests_user ON leave_requests(user_id);
CREATE INDEX idx_leave_requests_status ON leave_requests(status);
CREATE INDEX idx_leave_balances_user_year ON leave_balances(user_id, year);
CREATE INDEX idx_time_logs_user_date ON time_logs(user_id, punch_time);
CREATE INDEX idx_daily_time_summary_user_date ON daily_time_summary(user_id, date);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_candidates_job ON candidates(job_opening_id);
CREATE INDEX idx_candidates_stage ON candidates(stage_id);
CREATE INDEX idx_goals_assigned ON goals(assigned_to_id);
```

### 7.2 Create Tenant Seed Data Definition

Create `backend/prisma/tenant-seed-data.ts`:

```typescript
/**
 * Default seed data inserted into every newly provisioned tenant schema.
 * This file defines the data — the TenantProvisioningService executes the inserts.
 */

// ============================================================================
// PERMISSIONS — Every module/action/resource combination
// ============================================================================
export const DEFAULT_PERMISSIONS = [
  // Employee Management
  { module: 'employee_management', action: 'view', resource: 'employees', description: 'View employees' },
  { module: 'employee_management', action: 'create', resource: 'employees', description: 'Create employees' },
  { module: 'employee_management', action: 'edit', resource: 'employees', description: 'Edit employees' },
  { module: 'employee_management', action: 'delete', resource: 'employees', description: 'Delete employees' },
  { module: 'employee_management', action: 'export', resource: 'employees', description: 'Export employees' },
  { module: 'employee_management', action: 'import', resource: 'employees', description: 'Import employees' },
  { module: 'employee_management', action: 'view', resource: 'departments', description: 'View departments' },
  { module: 'employee_management', action: 'create', resource: 'departments', description: 'Create departments' },
  { module: 'employee_management', action: 'edit', resource: 'departments', description: 'Edit departments' },
  { module: 'employee_management', action: 'delete', resource: 'departments', description: 'Delete departments' },
  { module: 'employee_management', action: 'view', resource: 'designations', description: 'View designations' },
  { module: 'employee_management', action: 'create', resource: 'designations', description: 'Create designations' },
  { module: 'employee_management', action: 'edit', resource: 'designations', description: 'Edit designations' },
  { module: 'employee_management', action: 'delete', resource: 'designations', description: 'Delete designations' },
  { module: 'employee_management', action: 'view', resource: 'groups', description: 'View groups' },
  { module: 'employee_management', action: 'create', resource: 'groups', description: 'Create groups' },
  { module: 'employee_management', action: 'edit', resource: 'groups', description: 'Edit groups' },
  { module: 'employee_management', action: 'delete', resource: 'groups', description: 'Delete groups' },
  { module: 'employee_management', action: 'view', resource: 'projects', description: 'View projects' },
  { module: 'employee_management', action: 'create', resource: 'projects', description: 'Create projects' },
  { module: 'employee_management', action: 'edit', resource: 'projects', description: 'Edit projects' },
  { module: 'employee_management', action: 'delete', resource: 'projects', description: 'Delete projects' },
  { module: 'employee_management', action: 'view', resource: 'delegations', description: 'View delegations' },
  { module: 'employee_management', action: 'create', resource: 'delegations', description: 'Create delegations' },
  { module: 'employee_management', action: 'edit', resource: 'delegations', description: 'Edit delegations' },
  { module: 'employee_management', action: 'delete', resource: 'delegations', description: 'Delete delegations' },
  { module: 'employee_management', action: 'view', resource: 'reporting_hierarchy', description: 'View reporting hierarchy' },
  { module: 'employee_management', action: 'edit', resource: 'reporting_hierarchy', description: 'Edit reporting hierarchy' },

  // Leave
  { module: 'leave', action: 'view', resource: 'leave_requests', description: 'View leave requests' },
  { module: 'leave', action: 'create', resource: 'leave_requests', description: 'Apply for leave' },
  { module: 'leave', action: 'approve', resource: 'leave_requests', description: 'Approve/reject leave' },
  { module: 'leave', action: 'cancel', resource: 'leave_requests', description: 'Cancel leave requests' },
  { module: 'leave', action: 'export', resource: 'leave_requests', description: 'Export leave data' },
  { module: 'leave', action: 'view', resource: 'leave_types', description: 'View leave types' },
  { module: 'leave', action: 'create', resource: 'leave_types', description: 'Create leave types' },
  { module: 'leave', action: 'edit', resource: 'leave_types', description: 'Edit leave types' },
  { module: 'leave', action: 'delete', resource: 'leave_types', description: 'Delete leave types' },
  { module: 'leave', action: 'view', resource: 'leave_policies', description: 'View leave policies' },
  { module: 'leave', action: 'create', resource: 'leave_policies', description: 'Create leave policies' },
  { module: 'leave', action: 'edit', resource: 'leave_policies', description: 'Edit leave policies' },
  { module: 'leave', action: 'delete', resource: 'leave_policies', description: 'Delete leave policies' },
  { module: 'leave', action: 'view', resource: 'holidays', description: 'View holidays' },
  { module: 'leave', action: 'create', resource: 'holidays', description: 'Create holidays' },
  { module: 'leave', action: 'edit', resource: 'holidays', description: 'Edit holidays' },
  { module: 'leave', action: 'delete', resource: 'holidays', description: 'Delete holidays' },

  // Attendance
  { module: 'attendance', action: 'view', resource: 'attendance', description: 'View attendance' },
  { module: 'attendance', action: 'view', resource: 'team_attendance', description: 'View team attendance' },
  { module: 'attendance', action: 'create', resource: 'regularizations', description: 'Request regularization' },
  { module: 'attendance', action: 'approve', resource: 'regularizations', description: 'Approve regularizations' },
  { module: 'attendance', action: 'export', resource: 'attendance', description: 'Export attendance' },
  { module: 'attendance', action: 'view', resource: 'work_schedule', description: 'View work schedules' },
  { module: 'attendance', action: 'create', resource: 'work_schedule', description: 'Create work schedules' },
  { module: 'attendance', action: 'edit', resource: 'work_schedule', description: 'Edit work schedules' },
  { module: 'attendance', action: 'delete', resource: 'work_schedule', description: 'Delete work schedules' },

  // Time Tracker
  { module: 'time_tracker', action: 'view', resource: 'time_logs', description: 'View time logs' },
  { module: 'time_tracker', action: 'view', resource: 'config', description: 'View time tracker config' },
  { module: 'time_tracker', action: 'create', resource: 'config', description: 'Create time tracker config' },
  { module: 'time_tracker', action: 'edit', resource: 'config', description: 'Edit time tracker config' },
  { module: 'time_tracker', action: 'delete', resource: 'config', description: 'Delete time tracker config' },
  { module: 'time_tracker', action: 'execute', resource: 'sync', description: 'Trigger manual sync' },

  // Performance
  { module: 'performance', action: 'view', resource: 'goals', description: 'View goals' },
  { module: 'performance', action: 'create', resource: 'goals', description: 'Create goals' },
  { module: 'performance', action: 'edit', resource: 'goals', description: 'Edit goals' },
  { module: 'performance', action: 'delete', resource: 'goals', description: 'Delete goals' },
  { module: 'performance', action: 'export', resource: 'goals', description: 'Export goals' },
  { module: 'performance', action: 'view', resource: 'review_cycles', description: 'View review cycles' },
  { module: 'performance', action: 'create', resource: 'review_cycles', description: 'Create review cycles' },
  { module: 'performance', action: 'edit', resource: 'review_cycles', description: 'Edit review cycles' },
  { module: 'performance', action: 'view', resource: 'reviews', description: 'View reviews' },
  { module: 'performance', action: 'create', resource: 'reviews', description: 'Submit reviews' },

  // Files
  { module: 'files', action: 'view', resource: 'files', description: 'View files' },
  { module: 'files', action: 'create', resource: 'files', description: 'Upload files' },
  { module: 'files', action: 'delete', resource: 'files', description: 'Delete files' },
  { module: 'files', action: 'share', resource: 'files', description: 'Share files' },

  // Compensation
  { module: 'compensation', action: 'view', resource: 'salary', description: 'View salary data' },
  { module: 'compensation', action: 'create', resource: 'salary', description: 'Create salary records' },
  { module: 'compensation', action: 'edit', resource: 'salary', description: 'Edit salary records' },
  { module: 'compensation', action: 'view', resource: 'payslips', description: 'View payslips' },
  { module: 'compensation', action: 'create', resource: 'payslips', description: 'Generate payslips' },
  { module: 'compensation', action: 'view', resource: 'appraisals', description: 'View appraisals' },
  { module: 'compensation', action: 'create', resource: 'appraisals', description: 'Create appraisals' },
  { module: 'compensation', action: 'view', resource: 'salary_components', description: 'View salary components' },
  { module: 'compensation', action: 'create', resource: 'salary_components', description: 'Create salary components' },
  { module: 'compensation', action: 'edit', resource: 'salary_components', description: 'Edit salary components' },
  { module: 'compensation', action: 'delete', resource: 'salary_components', description: 'Delete salary components' },
  { module: 'compensation', action: 'export', resource: 'compensation', description: 'Export compensation data' },

  // Recruitment
  { module: 'recruitment', action: 'view', resource: 'job_openings', description: 'View job openings' },
  { module: 'recruitment', action: 'create', resource: 'job_openings', description: 'Create job openings' },
  { module: 'recruitment', action: 'edit', resource: 'job_openings', description: 'Edit job openings' },
  { module: 'recruitment', action: 'delete', resource: 'job_openings', description: 'Delete job openings' },
  { module: 'recruitment', action: 'view', resource: 'candidates', description: 'View candidates' },
  { module: 'recruitment', action: 'create', resource: 'candidates', description: 'Create candidates' },
  { module: 'recruitment', action: 'edit', resource: 'candidates', description: 'Edit candidates' },
  { module: 'recruitment', action: 'delete', resource: 'candidates', description: 'Delete candidates' },
  { module: 'recruitment', action: 'view', resource: 'interviews', description: 'View interviews' },
  { module: 'recruitment', action: 'create', resource: 'interviews', description: 'Schedule interviews' },
  { module: 'recruitment', action: 'edit', resource: 'interviews', description: 'Edit interviews' },
  { module: 'recruitment', action: 'delete', resource: 'interviews', description: 'Cancel interviews' },
  { module: 'recruitment', action: 'view', resource: 'assessments', description: 'View assessments' },
  { module: 'recruitment', action: 'create', resource: 'assessments', description: 'Create assessments' },
  { module: 'recruitment', action: 'view', resource: 'referrals', description: 'View referrals' },
  { module: 'recruitment', action: 'create', resource: 'referrals', description: 'Submit referrals' },
  { module: 'recruitment', action: 'view', resource: 'offer_letters', description: 'View offer letters' },
  { module: 'recruitment', action: 'create', resource: 'offer_letters', description: 'Create offer letters' },
  { module: 'recruitment', action: 'view', resource: 'pipeline_stages', description: 'View pipeline stages' },
  { module: 'recruitment', action: 'edit', resource: 'pipeline_stages', description: 'Edit pipeline stages' },

  // Onboarding
  { module: 'onboarding', action: 'view', resource: 'onboarding', description: 'View onboarding records' },
  { module: 'onboarding', action: 'create', resource: 'onboarding', description: 'Create onboarding records' },
  { module: 'onboarding', action: 'edit', resource: 'onboarding', description: 'Edit onboarding records' },
  { module: 'onboarding', action: 'convert', resource: 'onboarding', description: 'Convert to employee' },
  { module: 'onboarding', action: 'view', resource: 'templates', description: 'View onboarding templates' },
  { module: 'onboarding', action: 'create', resource: 'templates', description: 'Create onboarding templates' },
  { module: 'onboarding', action: 'edit', resource: 'templates', description: 'Edit onboarding templates' },
  { module: 'onboarding', action: 'delete', resource: 'templates', description: 'Delete onboarding templates' },

  // Offboarding
  { module: 'offboarding', action: 'view', resource: 'offboarding', description: 'View offboarding records' },
  { module: 'offboarding', action: 'create', resource: 'offboarding', description: 'Initiate offboarding' },
  { module: 'offboarding', action: 'approve', resource: 'offboarding', description: 'Approve offboarding' },
  { module: 'offboarding', action: 'edit', resource: 'offboarding', description: 'Edit offboarding records' },
  { module: 'offboarding', action: 'view', resource: 'offboarding_templates', description: 'View offboarding templates' },
  { module: 'offboarding', action: 'create', resource: 'offboarding_templates', description: 'Create offboarding templates' },
  { module: 'offboarding', action: 'edit', resource: 'offboarding_templates', description: 'Edit offboarding templates' },
  { module: 'offboarding', action: 'delete', resource: 'offboarding_templates', description: 'Delete offboarding templates' },

  // Reports
  { module: 'reports', action: 'view', resource: 'reports', description: 'View reports' },
  { module: 'reports', action: 'export', resource: 'reports', description: 'Export reports' },

  // Settings
  { module: 'settings', action: 'view', resource: 'settings', description: 'View settings' },
  { module: 'settings', action: 'edit', resource: 'settings', description: 'Edit settings' },
  { module: 'settings', action: 'view', resource: 'rbac', description: 'View roles & permissions' },
  { module: 'settings', action: 'edit', resource: 'rbac', description: 'Edit roles & permissions' },
  { module: 'settings', action: 'view', resource: 'audit_logs', description: 'View audit logs' },
  { module: 'settings', action: 'view', resource: 'notifications', description: 'View notification settings' },
  { module: 'settings', action: 'edit', resource: 'notifications', description: 'Edit notification settings' },

  // Dashboard
  { module: 'dashboard', action: 'view', resource: 'dashboard', description: 'View dashboard' },
];

// ============================================================================
// ROLES — System roles with permission mappings
// ============================================================================
export const DEFAULT_ROLES: {
  name: string;
  description: string;
  /** 'all' means every permission. Otherwise, array of { module, action, resource } combos. */
  permissions: 'all' | Array<{ module: string; action: string; resource: string }>;
}[] = [
  {
    name: 'Admin',
    description: 'Full access to every module, every action, every resource. Can configure settings, manage RBAC.',
    permissions: 'all',
  },
  {
    name: 'HR Admin',
    description: 'Employee CRUD, leave approval, attendance, performance, compensation, recruitment, onboarding, offboarding, reports. Cannot modify RBAC or org settings.',
    permissions: [
      // Employee Management — full
      ...['view', 'create', 'edit', 'delete', 'export', 'import'].map(a => ({ module: 'employee_management', action: a, resource: 'employees' })),
      ...['view', 'create', 'edit', 'delete'].flatMap(a => ['departments', 'designations', 'groups', 'projects', 'delegations'].map(r => ({ module: 'employee_management', action: a, resource: r }))),
      { module: 'employee_management', action: 'view', resource: 'reporting_hierarchy' },
      { module: 'employee_management', action: 'edit', resource: 'reporting_hierarchy' },
      // Leave — full including approval
      ...['view', 'create', 'approve', 'cancel', 'export'].map(a => ({ module: 'leave', action: a, resource: 'leave_requests' })),
      ...['view', 'create', 'edit', 'delete'].flatMap(a => ['leave_types', 'leave_policies', 'holidays'].map(r => ({ module: 'leave', action: a, resource: r }))),
      // Attendance — full
      ...['view', 'export'].map(a => ({ module: 'attendance', action: a, resource: 'attendance' })),
      { module: 'attendance', action: 'view', resource: 'team_attendance' },
      { module: 'attendance', action: 'create', resource: 'regularizations' },
      { module: 'attendance', action: 'approve', resource: 'regularizations' },
      ...['view', 'create', 'edit', 'delete'].map(a => ({ module: 'attendance', action: a, resource: 'work_schedule' })),
      // Time Tracker — full
      { module: 'time_tracker', action: 'view', resource: 'time_logs' },
      ...['view', 'create', 'edit', 'delete'].map(a => ({ module: 'time_tracker', action: a, resource: 'config' })),
      { module: 'time_tracker', action: 'execute', resource: 'sync' },
      // Performance — full
      ...['view', 'create', 'edit', 'delete', 'export'].map(a => ({ module: 'performance', action: a, resource: 'goals' })),
      ...['view', 'create', 'edit'].map(a => ({ module: 'performance', action: a, resource: 'review_cycles' })),
      { module: 'performance', action: 'view', resource: 'reviews' },
      { module: 'performance', action: 'create', resource: 'reviews' },
      // Files — full
      ...['view', 'create', 'delete', 'share'].map(a => ({ module: 'files', action: a, resource: 'files' })),
      // Compensation — full
      ...['view', 'create', 'edit'].map(a => ({ module: 'compensation', action: a, resource: 'salary' })),
      ...['view', 'create'].map(a => ({ module: 'compensation', action: a, resource: 'payslips' })),
      ...['view', 'create'].map(a => ({ module: 'compensation', action: a, resource: 'appraisals' })),
      ...['view', 'create', 'edit', 'delete'].map(a => ({ module: 'compensation', action: a, resource: 'salary_components' })),
      { module: 'compensation', action: 'export', resource: 'compensation' },
      // Recruitment — full
      ...['view', 'create', 'edit', 'delete'].flatMap(a => ['job_openings', 'candidates', 'interviews'].map(r => ({ module: 'recruitment', action: a, resource: r }))),
      ...['view', 'create'].flatMap(a => ['assessments', 'referrals', 'offer_letters'].map(r => ({ module: 'recruitment', action: a, resource: r }))),
      { module: 'recruitment', action: 'view', resource: 'pipeline_stages' },
      { module: 'recruitment', action: 'edit', resource: 'pipeline_stages' },
      // Onboarding — full
      ...['view', 'create', 'edit', 'convert'].map(a => ({ module: 'onboarding', action: a, resource: 'onboarding' })),
      ...['view', 'create', 'edit', 'delete'].map(a => ({ module: 'onboarding', action: a, resource: 'templates' })),
      // Offboarding — full
      ...['view', 'create', 'approve', 'edit'].map(a => ({ module: 'offboarding', action: a, resource: 'offboarding' })),
      ...['view', 'create', 'edit', 'delete'].map(a => ({ module: 'offboarding', action: a, resource: 'offboarding_templates' })),
      // Reports
      { module: 'reports', action: 'view', resource: 'reports' },
      { module: 'reports', action: 'export', resource: 'reports' },
      // Dashboard
      { module: 'dashboard', action: 'view', resource: 'dashboard' },
    ],
  },
  {
    name: 'HR Manager',
    description: 'Same as HR Admin minus: create salary components, delete employees, manage templates.',
    permissions: [
      // Employee Management — no delete employees
      ...['view', 'create', 'edit', 'export', 'import'].map(a => ({ module: 'employee_management', action: a, resource: 'employees' })),
      ...['view', 'create', 'edit'].flatMap(a => ['departments', 'designations', 'groups', 'projects', 'delegations'].map(r => ({ module: 'employee_management', action: a, resource: r }))),
      { module: 'employee_management', action: 'view', resource: 'reporting_hierarchy' },
      // Leave — full
      ...['view', 'create', 'approve', 'cancel', 'export'].map(a => ({ module: 'leave', action: a, resource: 'leave_requests' })),
      ...['view'].flatMap(a => ['leave_types', 'leave_policies', 'holidays'].map(r => ({ module: 'leave', action: a, resource: r }))),
      // Attendance — full view
      ...['view', 'export'].map(a => ({ module: 'attendance', action: a, resource: 'attendance' })),
      { module: 'attendance', action: 'view', resource: 'team_attendance' },
      { module: 'attendance', action: 'create', resource: 'regularizations' },
      { module: 'attendance', action: 'approve', resource: 'regularizations' },
      { module: 'attendance', action: 'view', resource: 'work_schedule' },
      // Time Tracker — view only
      { module: 'time_tracker', action: 'view', resource: 'time_logs' },
      { module: 'time_tracker', action: 'view', resource: 'config' },
      // Performance — full except cycle management
      ...['view', 'create', 'edit', 'delete', 'export'].map(a => ({ module: 'performance', action: a, resource: 'goals' })),
      { module: 'performance', action: 'view', resource: 'review_cycles' },
      { module: 'performance', action: 'view', resource: 'reviews' },
      { module: 'performance', action: 'create', resource: 'reviews' },
      // Files — full
      ...['view', 'create', 'delete', 'share'].map(a => ({ module: 'files', action: a, resource: 'files' })),
      // Compensation — view + create, no component management
      ...['view', 'create', 'edit'].map(a => ({ module: 'compensation', action: a, resource: 'salary' })),
      ...['view', 'create'].map(a => ({ module: 'compensation', action: a, resource: 'payslips' })),
      ...['view', 'create'].map(a => ({ module: 'compensation', action: a, resource: 'appraisals' })),
      { module: 'compensation', action: 'view', resource: 'salary_components' },
      { module: 'compensation', action: 'export', resource: 'compensation' },
      // Recruitment — no template management
      ...['view', 'create', 'edit'].flatMap(a => ['job_openings', 'candidates', 'interviews'].map(r => ({ module: 'recruitment', action: a, resource: r }))),
      ...['view', 'create'].flatMap(a => ['assessments', 'referrals', 'offer_letters'].map(r => ({ module: 'recruitment', action: a, resource: r }))),
      { module: 'recruitment', action: 'view', resource: 'pipeline_stages' },
      // Onboarding — no template management
      ...['view', 'create', 'edit'].map(a => ({ module: 'onboarding', action: a, resource: 'onboarding' })),
      { module: 'onboarding', action: 'view', resource: 'templates' },
      // Offboarding — no template management
      ...['view', 'create', 'approve', 'edit'].map(a => ({ module: 'offboarding', action: a, resource: 'offboarding' })),
      { module: 'offboarding', action: 'view', resource: 'offboarding_templates' },
      // Reports & Dashboard
      { module: 'reports', action: 'view', resource: 'reports' },
      { module: 'reports', action: 'export', resource: 'reports' },
      { module: 'dashboard', action: 'view', resource: 'dashboard' },
    ],
  },
  {
    name: 'Manager',
    description: 'View own + reportees. Assign goals/tasks, manage delegations. No recruitment, settings, or compensation (except own).',
    permissions: [
      // Employee — view own + reportees
      { module: 'employee_management', action: 'view', resource: 'employees' },
      { module: 'employee_management', action: 'view', resource: 'departments' },
      { module: 'employee_management', action: 'view', resource: 'designations' },
      { module: 'employee_management', action: 'view', resource: 'groups' },
      { module: 'employee_management', action: 'view', resource: 'projects' },
      { module: 'employee_management', action: 'create', resource: 'projects' },
      { module: 'employee_management', action: 'edit', resource: 'projects' },
      ...['view', 'create', 'edit', 'delete'].map(a => ({ module: 'employee_management', action: a, resource: 'delegations' })),
      { module: 'employee_management', action: 'view', resource: 'reporting_hierarchy' },
      // Leave — view reportees, create own, no approval
      { module: 'leave', action: 'view', resource: 'leave_requests' },
      { module: 'leave', action: 'create', resource: 'leave_requests' },
      { module: 'leave', action: 'cancel', resource: 'leave_requests' },
      { module: 'leave', action: 'view', resource: 'holidays' },
      // Attendance — view own + reportees
      { module: 'attendance', action: 'view', resource: 'attendance' },
      { module: 'attendance', action: 'view', resource: 'team_attendance' },
      { module: 'attendance', action: 'create', resource: 'regularizations' },
      { module: 'attendance', action: 'view', resource: 'work_schedule' },
      // Time Tracker — view
      { module: 'time_tracker', action: 'view', resource: 'time_logs' },
      // Performance — create/assign goals, submit reviews
      ...['view', 'create', 'edit', 'delete'].map(a => ({ module: 'performance', action: a, resource: 'goals' })),
      { module: 'performance', action: 'view', resource: 'review_cycles' },
      { module: 'performance', action: 'view', resource: 'reviews' },
      { module: 'performance', action: 'create', resource: 'reviews' },
      // Files — own
      ...['view', 'create', 'delete', 'share'].map(a => ({ module: 'files', action: a, resource: 'files' })),
      // Compensation — view own only
      { module: 'compensation', action: 'view', resource: 'salary' },
      { module: 'compensation', action: 'view', resource: 'payslips' },
      // Dashboard
      { module: 'dashboard', action: 'view', resource: 'dashboard' },
    ],
  },
  {
    name: 'Employee',
    description: 'View own profile, leave, attendance, goals, files, compensation. Apply for leave, update goal progress, upload files, submit resignation.',
    permissions: [
      { module: 'employee_management', action: 'view', resource: 'employees' },
      { module: 'employee_management', action: 'view', resource: 'departments' },
      { module: 'employee_management', action: 'view', resource: 'designations' },
      // Leave — own
      { module: 'leave', action: 'view', resource: 'leave_requests' },
      { module: 'leave', action: 'create', resource: 'leave_requests' },
      { module: 'leave', action: 'cancel', resource: 'leave_requests' },
      { module: 'leave', action: 'view', resource: 'holidays' },
      // Attendance — own
      { module: 'attendance', action: 'view', resource: 'attendance' },
      { module: 'attendance', action: 'create', resource: 'regularizations' },
      { module: 'attendance', action: 'view', resource: 'work_schedule' },
      // Time Tracker — own
      { module: 'time_tracker', action: 'view', resource: 'time_logs' },
      // Performance — own goals
      { module: 'performance', action: 'view', resource: 'goals' },
      { module: 'performance', action: 'edit', resource: 'goals' }, // update progress
      { module: 'performance', action: 'view', resource: 'reviews' },
      // Files — own
      ...['view', 'create', 'delete'].map(a => ({ module: 'files', action: a, resource: 'files' })),
      // Compensation — own
      { module: 'compensation', action: 'view', resource: 'salary' },
      { module: 'compensation', action: 'view', resource: 'payslips' },
      { module: 'compensation', action: 'view', resource: 'appraisals' },
      // Offboarding — submit own resignation
      { module: 'offboarding', action: 'create', resource: 'offboarding' },
      { module: 'offboarding', action: 'view', resource: 'offboarding' },
      // Dashboard
      { module: 'dashboard', action: 'view', resource: 'dashboard' },
    ],
  },
];

// ============================================================================
// DEFAULT LEAVE TYPES
// ============================================================================
export const DEFAULT_LEAVE_TYPES = [
  { name: 'Casual Leave', code: 'CL', color: '#4CAF50', icon: 'sun', isPaid: true, maxConsecutiveDays: 3 },
  { name: 'Earned Leave', code: 'EL', color: '#2196F3', icon: 'calendar', isPaid: true, maxConsecutiveDays: null },
  { name: 'Leave Without Pay', code: 'LWP', color: '#FF9800', icon: 'alert-circle', isPaid: false, maxConsecutiveDays: null },
  { name: 'Paternity Leave', code: 'PL', color: '#9C27B0', icon: 'baby', isPaid: true, maxConsecutiveDays: 15 },
  { name: 'Sabbatical Leave', code: 'SL', color: '#607D8B', icon: 'briefcase', isPaid: false, maxConsecutiveDays: null },
  { name: 'Sick Leave', code: 'SKL', color: '#F44336', icon: 'thermometer', isPaid: true, maxConsecutiveDays: null },
];

// ============================================================================
// DEFAULT WORK SCHEDULE
// ============================================================================
export const DEFAULT_WORK_SCHEDULE = {
  name: 'General',
  startTime: '09:00',
  endTime: '18:00',
  workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  gracePeriodMinutes: 15,
  minHoursFullDay: 8,
  minHoursHalfDay: 4,
  overtimeThresholdHours: 9,
  isDefault: true,
};

// ============================================================================
// DEFAULT CANDIDATE PIPELINE STAGES
// ============================================================================
export const DEFAULT_CANDIDATE_STAGES = [
  { name: 'New', orderIndex: 0, color: '#9E9E9E', isDefault: true },
  { name: 'In Review', orderIndex: 1, color: '#2196F3', isDefault: false },
  { name: 'Available', orderIndex: 2, color: '#00BCD4', isDefault: false },
  { name: 'Engaged', orderIndex: 3, color: '#FF9800', isDefault: false },
  { name: 'Offered', orderIndex: 4, color: '#9C27B0', isDefault: false },
  { name: 'Hired', orderIndex: 5, color: '#4CAF50', isDefault: false },
  { name: 'Rejected', orderIndex: 6, color: '#F44336', isDefault: false },
];
```

### 7.3 Create Tenant Provisioning Service

Create `backend/src/tenant/tenant-provisioning.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProvisionTenantInput, ProvisionTenantResult } from './tenant.interface';
import {
  DEFAULT_PERMISSIONS,
  DEFAULT_ROLES,
  DEFAULT_LEAVE_TYPES,
  DEFAULT_WORK_SCHEDULE,
  DEFAULT_CANDIDATE_STAGES,
} from '../../prisma/tenant-seed-data';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);
  private tenantDDL: string;

  constructor(private readonly prisma: PrismaService) {
    // Load the tenant DDL SQL template once on startup
    this.tenantDDL = fs.readFileSync(
      path.join(__dirname, '..', '..', 'prisma', 'tenant-schema.sql'),
      'utf8',
    );
  }

  /**
   * Full provisioning pipeline:
   * 1. Create row in platform.tenants
   * 2. Create PostgreSQL schema
   * 3. Create all ~65 tables
   * 4. Seed default data (roles, permissions, leave types, work schedule, stages, org settings)
   * 5. Create admin user with Admin role
   */
  async provision(input: ProvisionTenantInput): Promise<ProvisionTenantResult> {
    const schemaName = this.sanitizeSchemaName(input.slug);

    this.logger.log(`Starting provisioning for: ${input.name} (schema: ${schemaName})`);

    // Step 1: Create tenant record in platform schema
    const tenantRows = await this.prisma.queryRaw<any>(
      `INSERT INTO platform.tenants (id, name, slug, schema_name, subscription_tier, max_users, billing_email, status, registration_source, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'active', $7, NOW(), NOW())
       RETURNING id`,
      input.name,
      input.slug,
      schemaName,
      input.subscriptionTier,
      input.maxUsers,
      input.billingEmail,
      input.registrationSource,
    );
    const tenantId = tenantRows[0].id;
    this.logger.log(`Step 1: Tenant record created (id: ${tenantId})`);

    try {
      // Step 2 & 3: Create schema and all tables
      const ddl = this.tenantDDL.replace(/__SCHEMA_NAME__/g, schemaName);
      // Split by semicolons and execute each statement
      const statements = ddl
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const statement of statements) {
        await this.prisma.executeRaw(statement + ';');
      }
      this.logger.log(`Step 2-3: Schema "${schemaName}" created with all tables`);

      // Step 4: Seed default data
      await this.seedPermissions(schemaName);
      this.logger.log(`Step 4a: Permissions seeded`);

      await this.seedRoles(schemaName);
      this.logger.log(`Step 4b: Roles seeded with permission mappings`);

      await this.seedLeaveTypes(schemaName);
      this.logger.log(`Step 4c: Leave types seeded`);

      await this.seedWorkSchedule(schemaName);
      this.logger.log(`Step 4d: Work schedule seeded`);

      await this.seedCandidateStages(schemaName);
      this.logger.log(`Step 4e: Candidate pipeline stages seeded`);

      await this.seedOrganizationSettings(schemaName, input.name, input.customDomain || null);
      this.logger.log(`Step 4f: Organization settings seeded`);

      // Step 5: Create admin user
      const adminUserId = await this.createAdminUser(
        schemaName,
        input.adminName,
        input.adminEmail,
        input.adminPasswordHash,
      );
      this.logger.log(`Step 5: Admin user created (id: ${adminUserId})`);

      // Update tenant user count
      await this.prisma.executeRaw(
        `UPDATE platform.tenants SET current_user_count = 1 WHERE id = '${tenantId}'`,
      );

      this.logger.log(`✅ Provisioning complete for ${input.name}`);

      return {
        tenantId,
        schemaName,
        adminUserId,
        slug: input.slug,
      };
    } catch (error) {
      // If provisioning fails, clean up: drop the schema and delete the tenant record
      this.logger.error(`❌ Provisioning failed for ${input.name}: ${error.message}`);
      try {
        await this.prisma.executeRaw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        await this.prisma.executeRaw(`DELETE FROM platform.tenants WHERE id = '${tenantId}'`);
      } catch (cleanupError) {
        this.logger.error(`Cleanup also failed: ${cleanupError.message}`);
      }
      throw error;
    }
  }

  // --- Private seed methods ---

  private async seedPermissions(schemaName: string): Promise<void> {
    for (const perm of DEFAULT_PERMISSIONS) {
      await this.prisma.executeRaw(
        `INSERT INTO "${schemaName}".permissions (id, module, action, resource, description, created_at)
         VALUES (gen_random_uuid(), '${perm.module}', '${perm.action}', '${perm.resource}', '${perm.description.replace(/'/g, "''")}', NOW())`,
      );
    }
  }

  private async seedRoles(schemaName: string): Promise<void> {
    for (const roleDef of DEFAULT_ROLES) {
      // Create the role
      const roleRows = await this.prisma.queryRaw<any>(
        `INSERT INTO "${schemaName}".roles (id, name, description, is_system_role, is_custom, created_at, updated_at)
         VALUES (gen_random_uuid(), '${roleDef.name}', '${roleDef.description.replace(/'/g, "''")}', TRUE, FALSE, NOW(), NOW())
         RETURNING id`,
      );
      const roleId = roleRows[0].id;

      // Map permissions
      if (roleDef.permissions === 'all') {
        // Admin gets all permissions
        await this.prisma.executeRaw(
          `INSERT INTO "${schemaName}".role_permissions (id, role_id, permission_id)
           SELECT gen_random_uuid(), '${roleId}', id FROM "${schemaName}".permissions`,
        );
      } else {
        // Specific permissions
        for (const perm of roleDef.permissions) {
          await this.prisma.executeRaw(
            `INSERT INTO "${schemaName}".role_permissions (id, role_id, permission_id)
             SELECT gen_random_uuid(), '${roleId}', id FROM "${schemaName}".permissions
             WHERE module = '${perm.module}' AND action = '${perm.action}' AND resource = '${perm.resource}'`,
          );
        }
      }
    }
  }

  private async seedLeaveTypes(schemaName: string): Promise<void> {
    for (const lt of DEFAULT_LEAVE_TYPES) {
      await this.prisma.executeRaw(
        `INSERT INTO "${schemaName}".leave_types (id, name, code, color, icon, is_paid, max_consecutive_days, created_at, updated_at)
         VALUES (gen_random_uuid(), '${lt.name}', '${lt.code}', '${lt.color}', '${lt.icon}', ${lt.isPaid}, ${lt.maxConsecutiveDays || 'NULL'}, NOW(), NOW())`,
      );
    }
  }

  private async seedWorkSchedule(schemaName: string): Promise<void> {
    const ws = DEFAULT_WORK_SCHEDULE;
    await this.prisma.executeRaw(
      `INSERT INTO "${schemaName}".work_schedule (id, name, start_time, end_time, working_days, grace_period_minutes, min_hours_full_day, min_hours_half_day, overtime_threshold_hours, is_default, created_at, updated_at)
       VALUES (gen_random_uuid(), '${ws.name}', '${ws.startTime}', '${ws.endTime}', '${JSON.stringify(ws.workingDays)}', ${ws.gracePeriodMinutes}, ${ws.minHoursFullDay}, ${ws.minHoursHalfDay}, ${ws.overtimeThresholdHours}, ${ws.isDefault}, NOW(), NOW())`,
    );
  }

  private async seedCandidateStages(schemaName: string): Promise<void> {
    for (const stage of DEFAULT_CANDIDATE_STAGES) {
      await this.prisma.executeRaw(
        `INSERT INTO "${schemaName}".candidate_stages (id, name, order_index, color, is_default)
         VALUES (gen_random_uuid(), '${stage.name}', ${stage.orderIndex}, '${stage.color}', ${stage.isDefault})`,
      );
    }
  }

  private async seedOrganizationSettings(schemaName: string, orgName: string, customDomain: string | null): Promise<void> {
    await this.prisma.executeRaw(
      `INSERT INTO "${schemaName}".organization_settings (id, org_name, custom_domain, default_timezone, date_format, financial_year_start_month, default_currency)
       VALUES (gen_random_uuid(), '${orgName.replace(/'/g, "''")}', ${customDomain ? `'${customDomain}'` : 'NULL'}, 'UTC', 'DD-MMM-YYYY', 1, 'USD')`,
    );
  }

  private async createAdminUser(
    schemaName: string,
    name: string,
    email: string,
    passwordHash: string,
  ): Promise<string> {
    // Create user
    const nameParts = name.split(' ');
    const firstName = nameParts[0] || name;
    const lastName = nameParts.slice(1).join(' ') || '';

    const userRows = await this.prisma.queryRaw<any>(
      `INSERT INTO "${schemaName}".users (id, email, password_hash, first_name, last_name, display_name, email_domain_type, status, must_reset_password, created_at, updated_at)
       VALUES (gen_random_uuid(), '${email}', '${passwordHash}', '${firstName.replace(/'/g, "''")}', '${lastName.replace(/'/g, "''")}', '${name.replace(/'/g, "''")}', 'company', 'active', TRUE, NOW(), NOW())
       RETURNING id`,
    );
    const userId = userRows[0].id;

    // Assign Admin role
    const adminRoleRows = await this.prisma.queryRaw<any>(
      `SELECT id FROM "${schemaName}".roles WHERE name = 'Admin' LIMIT 1`,
    );
    if (adminRoleRows.length > 0) {
      await this.prisma.executeRaw(
        `INSERT INTO "${schemaName}".user_roles (id, user_id, role_id, assigned_at)
         VALUES (gen_random_uuid(), '${userId}', '${adminRoleRows[0].id}', NOW())`,
      );
    }

    return userId;
  }

  /**
   * Sanitize slug to be a valid PostgreSQL schema name.
   * Replaces hyphens with underscores, prepends "tenant_" prefix.
   */
  private sanitizeSchemaName(slug: string): string {
    return `tenant_${slug.replace(/-/g, '_').replace(/[^a-z0-9_]/g, '')}`;
  }
}
```

---

## 8. Tenant Module

### 8.1 Create `backend/src/tenant/tenant.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { TenantProvisioningService } from './tenant-provisioning.service';

@Module({
  providers: [TenantService, TenantProvisioningService],
  exports: [TenantService, TenantProvisioningService],
})
export class TenantModule {}
```

---

## 9. Register Middleware in AppModule

### 9.1 Update `backend/src/app.module.ts`

```typescript
import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { TenantModule } from './tenant/tenant.module';
import { TenantMiddleware } from './common/middleware/tenant.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    TenantModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware)
      .exclude(
        // Platform routes — super admin portal, completely separate auth
        { path: 'api/platform/(.*)', method: RequestMethod.ALL },
        // Public routes — registration, career page, no tenant needed
        { path: 'api/public/(.*)', method: RequestMethod.ALL },
      )
      .forRoutes('*'); // Apply to all other routes
  }
}
```

---

## 10. Provisioning Test Script

Create `backend/scripts/test-provisioning.ts` — a standalone script to test the full provisioning pipeline manually:

```typescript
/**
 * Manual test script: provisions a test tenant.
 * Run: npx ts-node scripts/test-provisioning.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TenantProvisioningService } from '../src/tenant/tenant-provisioning.service';
import * as bcrypt from 'bcrypt';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const provisioner = app.get(TenantProvisioningService);

  const passwordHash = await bcrypt.hash('Admin@123', 12);

  try {
    const result = await provisioner.provision({
      name: 'Acme Corporation',
      slug: 'acme-corp',
      billingEmail: 'billing@acme.com',
      subscriptionTier: 'with_recruitment',
      maxUsers: 50,
      registrationSource: 'super_admin',
      adminName: 'John Doe',
      adminEmail: 'john@acme.com',
      adminPasswordHash: passwordHash,
    });

    console.log('\n✅ Provisioning successful!');
    console.log('Tenant ID:', result.tenantId);
    console.log('Schema:', result.schemaName);
    console.log('Admin User ID:', result.adminUserId);
    console.log('Slug:', result.slug);
    console.log('\nAdmin login credentials:');
    console.log('Email: john@acme.com');
    console.log('Password: Admin@123');
  } catch (error) {
    console.error('❌ Provisioning failed:', error.message);
  }

  await app.close();
}

main();
```

---

## 11. Verification & Acceptance Criteria

### 11.1 Test the Provisioning Pipeline

```bash
cd backend
npx ts-node scripts/test-provisioning.ts
```

### 11.2 Verify in PostgreSQL

Connect to your local database and run:

```sql
-- Check the tenant was created in platform schema
SELECT id, name, slug, schema_name, status FROM platform.tenants;

-- Check the tenant schema exists
SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'tenant_acme_corp';

-- Check tables were created in the tenant schema
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'tenant_acme_corp'
ORDER BY table_name;
-- Should return ~65 tables

-- Check default roles were seeded
SET search_path TO "tenant_acme_corp";
SELECT name, is_system_role FROM roles;
-- Should return: Admin, HR Admin, HR Manager, Manager, Employee

-- Check permissions were seeded
SELECT COUNT(*) FROM permissions;
-- Should return 100+

-- Check role-permission mappings exist
SELECT r.name, COUNT(rp.id) as permission_count
FROM roles r LEFT JOIN role_permissions rp ON r.id = rp.role_id
GROUP BY r.name;
-- Admin should have all permissions, others should have subsets

-- Check admin user was created
SELECT id, email, first_name, last_name, status, must_reset_password FROM users;
-- Should return john@acme.com

-- Check admin has Admin role
SELECT u.email, r.name FROM users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN roles r ON ur.role_id = r.id;
-- Should return john@acme.com → Admin

-- Check leave types
SELECT name, code, is_paid FROM leave_types;
-- Should return 6 leave types

-- Check work schedule
SELECT name, start_time, end_time, working_days FROM work_schedule;
-- Should return General schedule

-- Check candidate stages
SELECT name, order_index FROM candidate_stages ORDER BY order_index;
-- Should return 7 stages

-- Check organization settings
SELECT org_name, default_timezone, default_currency FROM organization_settings;
-- Should return Acme Corporation, UTC, USD
```

### 11.3 Full Acceptance Criteria Checklist

- [ ] **TenantMiddleware resolves tenant** from subdomain, custom domain, or `X-Tenant-ID` / `X-Tenant-Slug` header
- [ ] **Platform routes bypass middleware:** Requests to `/api/platform/*` never trigger tenant resolution
- [ ] **Public routes bypass middleware:** Requests to `/api/public/*` never trigger tenant resolution
- [ ] **Suspended tenants blocked:** Middleware returns 403 with clear message for suspended tenants
- [ ] **Cancelled tenants blocked:** Middleware returns 403 for cancelled tenants
- [ ] **Unknown tenants return 404:** Clean error message when tenant can't be resolved
- [ ] **Schema switching works:** `PrismaService.setSchema()` correctly changes the PostgreSQL `search_path`
- [ ] **Provisioning creates schema:** New PostgreSQL schema created with sanitized name (`tenant_{slug}`)
- [ ] **Provisioning creates all tables:** All ~65 tables exist in the new schema
- [ ] **Provisioning seeds 5 system roles:** Admin, HR Admin, HR Manager, Manager, Employee
- [ ] **Provisioning seeds all permissions:** 100+ permission records covering all modules
- [ ] **Provisioning maps role→permissions correctly:** Admin gets all; others get appropriate subsets
- [ ] **Provisioning seeds 6 leave types:** CL, EL, LWP, PL, SL, SKL
- [ ] **Provisioning seeds default work schedule:** General (9-6, Mon-Fri)
- [ ] **Provisioning seeds 7 candidate stages:** New → In Review → Available → Engaged → Offered → Hired → Rejected
- [ ] **Provisioning seeds organization settings:** With org name, UTC timezone, USD currency
- [ ] **Provisioning creates admin user:** User record with Admin role assigned
- [ ] **Provisioning failure cleans up:** If any step fails, schema is dropped and tenant record deleted
- [ ] **Tenant cache works:** Second request for same tenant hits cache instead of DB
- [ ] **Backend starts cleanly** with the TenantModule and middleware registered

---

*Sprint 1B Complete. Next: Sprint 1C — Platform Auth (Super Admin)*
