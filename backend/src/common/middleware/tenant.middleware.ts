import {
  Injectable,
  NestMiddleware,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { TenantService } from '../../tenant/tenant.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantInfo } from '../../tenant/tenant.interface';

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
    this.platformDomain = this.config.get<string>(
      'PLATFORM_DOMAIN',
      'localhost:3000',
    );
  }

  async use(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    // Skip tenant resolution for platform and public API routes.
    // Use originalUrl: req.path can be relative to NestJS global prefix (e.g. /platform/auth/... instead of /api/platform/auth/...).
    const pathToCheck = req.originalUrl?.split('?')[0] ?? req.url ?? req.path ?? '';
    const isPlatformOrPublic =
      pathToCheck.includes('/api/platform') ||
      pathToCheck.includes('/api/public') ||
      pathToCheck.includes('/platform/auth') ||
      pathToCheck.includes('/public/');
    if (isPlatformOrPublic) {
      return next();
    }

    let tenant: TenantInfo | null = null;

    const host = req.headers.host || '';
    if (
      host &&
      !host.includes(this.platformDomain) &&
      !host.includes('localhost')
    ) {
      tenant = await this.tenantService.findByCustomDomain(host.split(':')[0]);
      if (tenant) {
        this.logger.debug(
          `Tenant resolved via custom domain: ${host} → ${tenant.slug}`,
        );
      }
    }

    if (!tenant) {
      const slug = this.extractSubdomain(host);
      if (slug) {
        tenant = await this.tenantService.findBySlug(slug);
        if (tenant) {
          this.logger.debug(
            `Tenant resolved via subdomain: ${slug} → ${tenant.schemaName}`,
          );
        }
      }
    }

    if (!tenant) {
      const tenantId = req.headers['x-tenant-id'] as string;
      if (tenantId) {
        tenant = await this.tenantService.findById(tenantId);
        if (tenant) {
          this.logger.debug(
            `Tenant resolved via X-Tenant-ID: ${tenantId} → ${tenant.schemaName}`,
          );
        }
      }
    }

    if (!tenant) {
      const tenantSlug = req.headers['x-tenant-slug'] as string;
      if (tenantSlug) {
        tenant = await this.tenantService.findBySlug(tenantSlug);
        if (tenant) {
          this.logger.debug(
            `Tenant resolved via X-Tenant-Slug: ${tenantSlug} → ${tenant.schemaName}`,
          );
        }
      }
    }

    if (!tenant) {
      throw new HttpException(
        {
          success: false,
          error: {
            code: 'TENANT_NOT_FOUND',
            message:
              'Unable to resolve organization. Please check your URL or contact support.',
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }

    if (tenant.status === 'suspended') {
      throw new HttpException(
        {
          success: false,
          error: {
            code: 'TENANT_SUSPENDED',
            message:
              "Your organization's account has been suspended. Please contact your administrator.",
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
            message: "Your organization's account has been cancelled.",
          },
        },
        HttpStatus.FORBIDDEN,
      );
    }

    req.tenant = tenant;

    await this.prisma.setSchema(tenant.schemaName);

    next();
  }

  private extractSubdomain(host: string): string | null {
    if (!host) return null;

    const hostname = host.split(':')[0];

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return null;
    }

    const platformHostname = this.platformDomain.split(':')[0];
    if (!hostname.endsWith(platformHostname)) return null;

    const subdomain = hostname.replace(`.${platformHostname}`, '');

    if (
      subdomain === hostname ||
      subdomain === '' ||
      subdomain === 'www'
    ) {
      return null;
    }

    return subdomain;
  }
}
