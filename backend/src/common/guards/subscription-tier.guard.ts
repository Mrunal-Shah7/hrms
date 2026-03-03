import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_TIER_KEY } from '../decorators/require-tier.decorator';

const TIER_ORDER = ['standard', 'with_recruitment'];

function tierMeetsOrExceeds(current: string, required: string): boolean {
  const currentIdx = TIER_ORDER.indexOf(current);
  const requiredIdx = TIER_ORDER.indexOf(required);
  if (currentIdx === -1 || requiredIdx === -1) return false;
  return currentIdx >= requiredIdx;
}

@Injectable()
export class SubscriptionTierGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredTier = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRED_TIER_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredTier) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const currentTier = user?.subscriptionTier ?? 'standard';

    if (tierMeetsOrExceeds(currentTier, requiredTier)) return true;

    throw new ForbiddenException({
      success: false,
      error: {
        code: 'SUBSCRIPTION_REQUIRED',
        message:
          "This feature requires the 'Standard + Recruitment' subscription plan. Please contact your administrator to upgrade.",
        details: {
          requiredTier,
          currentTier,
        },
      },
    });
  }
}
