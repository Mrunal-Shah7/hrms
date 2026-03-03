import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

export interface TenantJwtPayload {
  userId: string;
  tenantId: string;
  schemaName: string;
  sessionId?: string;
  subscriptionTier?: string;
  roles: string[];
  permissions: string[];
  type: 'tenant';
}

@Injectable()
export class TenantJwtStrategy extends PassportStrategy(Strategy, 'tenant-jwt') {
  constructor(configService: ConfigService) {
    const secret = configService.getOrThrow<string>('TENANT_JWT_ACCESS_SECRET');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: TenantJwtPayload) {
    if (payload.type !== 'tenant') {
      throw new UnauthorizedException('Invalid token type');
    }

    return {
      userId: payload.userId,
      tenantId: payload.tenantId,
      schemaName: payload.schemaName,
      sessionId: payload.sessionId,
      subscriptionTier: payload.subscriptionTier ?? 'standard',
      roles: payload.roles || [],
      permissions: payload.permissions || [],
      type: payload.type,
    };
  }
}
