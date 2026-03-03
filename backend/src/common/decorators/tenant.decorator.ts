import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantInfo } from '../../tenant/tenant.interface';

/**
 * Injects the resolved TenantInfo into a controller method parameter.
 *
 * Usage:
 * @Get('employees')
 * getEmployees(@TenantContext() tenant: TenantInfo) {
 *   console.log(tenant.schemaName);
 * }
 */
export const TenantContext = createParamDecorator(
  (data: keyof TenantInfo | undefined, ctx: ExecutionContext): TenantInfo | unknown => {
    const request = ctx.switchToHttp().getRequest();
    const tenant = request.tenant as TenantInfo;

    if (!tenant) {
      return null;
    }

    return data ? tenant[data] : tenant;
  },
);
