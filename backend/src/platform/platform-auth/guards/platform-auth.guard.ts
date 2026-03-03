import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard for all /api/platform/* routes (except auth endpoints).
 * Validates the JWT using the 'platform-jwt' strategy.
 * Ensures the token type is 'platform' (not 'tenant').
 */
@Injectable()
export class PlatformAuthGuard extends AuthGuard('platform-jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, _info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('Platform authentication required');
    }
    return user;
  }
}
