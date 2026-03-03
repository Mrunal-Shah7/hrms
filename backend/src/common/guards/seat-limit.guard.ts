import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { CHECK_SEAT_LIMIT_KEY } from '../decorators/check-seat-limit.decorator';

@Injectable()
export class SeatLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const checkSeatLimit = this.reflector.getAllAndOverride<boolean | undefined>(
      CHECK_SEAT_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!checkSeatLimit) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const tenantId = user?.tenantId;
    if (!tenantId) return true;

    const rows = await this.prisma.withPlatformSchema(async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{ current_user_count: number; max_users: number }>
      >(
        `SELECT current_user_count, max_users FROM tenants WHERE id = $1::uuid LIMIT 1`,
        tenantId,
      );
    });

    if (rows.length === 0) return true;

    const { current_user_count, max_users } = rows[0];
    if (current_user_count >= max_users) {
      throw new ForbiddenException({
        success: false,
        error: {
          code: 'SEAT_LIMIT_REACHED',
          message: `Your organization has reached the maximum number of users (${max_users}). Please contact your administrator to increase the seat limit.`,
          details: {
            currentUserCount: current_user_count,
            maxUsers: max_users,
          },
        },
      });
    }

    return true;
  }
}
