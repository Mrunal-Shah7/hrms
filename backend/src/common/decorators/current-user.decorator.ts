import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts the authenticated user from the request object.
 * Works with both PlatformAuthGuard (Sprint 1C) and TenantAuthGuard (Sprint 1E).
 *
 * Usage:
 *   @Get('me')
 *   getProfile(@CurrentUser() user: any) { ... }
 *
 *   @Get('me')
 *   getEmail(@CurrentUser('email') email: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
