import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSION_KEY,
  type RequiredPermission,
} from '../decorators/require-permission.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RequiredPermission | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const permissions: string[] = user?.permissions ?? [];

    const key = `${required.module}:${required.action}:${required.resource}`;
    if (permissions.includes(key)) return true;

    throw new ForbiddenException({
      success: false,
      error: {
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission to perform this action.',
        details: {
          required: key,
          module: required.module,
          action: required.action,
          resource: required.resource,
        },
      },
    });
  }
}
