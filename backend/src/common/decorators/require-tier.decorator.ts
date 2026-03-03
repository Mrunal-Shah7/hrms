import { SetMetadata } from '@nestjs/common';

export const REQUIRED_TIER_KEY = 'required_tier';

/**
 * Gates route access by subscription tier.
 * Usage: @RequireTier('with_recruitment') — blocks tenants on 'standard' tier.
 */
export function RequireTier(tier: string) {
  return SetMetadata(REQUIRED_TIER_KEY, tier);
}
