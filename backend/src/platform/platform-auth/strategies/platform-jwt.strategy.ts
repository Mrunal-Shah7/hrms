import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

export interface PlatformJwtPayload {
  superAdminId: string;
  type: 'platform';
}

@Injectable()
export class PlatformJwtStrategy extends PassportStrategy(Strategy, 'platform-jwt') {
  constructor(configService: ConfigService) {
    const secret = configService.getOrThrow<string>('PLATFORM_JWT_ACCESS_SECRET');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: PlatformJwtPayload) {
    if (payload.type !== 'platform') {
      throw new UnauthorizedException('Invalid token type');
    }

    return {
      superAdminId: payload.superAdminId,
      type: payload.type,
    };
  }
}
