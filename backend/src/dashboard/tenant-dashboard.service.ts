import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SubscriptionWarning {
  type: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface SubscriptionData {
  tier: string;
  currentUserCount: number;
  maxUsers: number;
  utilizationPercent: number;
  status: string;
  trialEndsAt: string | null;
  warnings: SubscriptionWarning[];
}

function buildWarnings(
  status: string,
  trialEndsAt: Date | null,
  currentUserCount: number,
  maxUsers: number,
): SubscriptionWarning[] {
  const warnings: SubscriptionWarning[] = [];

  if (status === 'trial' && trialEndsAt) {
    const now = new Date();
    const diffMs = trialEndsAt.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));

    if (diffDays <= 2) {
      warnings.push({
        type: 'trial_expiring',
        message:
          diffDays <= 1
            ? 'Your trial expires tomorrow! Contact your administrator immediately.'
            : 'Your trial expires in 2 days! Contact your administrator immediately.',
        severity: 'critical',
      });
    } else if (diffDays <= 7) {
      warnings.push({
        type: 'trial_expiring',
        message: `Your trial expires in ${diffDays} days. Contact your administrator to activate your subscription.`,
        severity: 'warning',
      });
    }
  }

  if (maxUsers > 0) {
    const util = (currentUserCount / maxUsers) * 100;
    if (currentUserCount >= maxUsers) {
      warnings.push({
        type: 'seat_limit_reached',
        message: 'User seat limit reached. No new employees can be added.',
        severity: 'critical',
      });
    } else if (util >= 80) {
      warnings.push({
        type: 'seat_limit_approaching',
        message: `${Math.round(util)}% of user seats used (${currentUserCount}/${maxUsers})`,
        severity: 'info',
      });
    }
  }

  return warnings;
}

@Injectable()
export class TenantDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardData(
    tenantId: string,
    schemaName: string,
    roles: string[],
  ): Promise<{
    subscription: SubscriptionData | null;
    quickStats: {
      totalEmployees: number | null;
      pendingLeaveRequests: number | null;
      activeGoals: number | null;
      openJobOpenings: number | null;
    };
  }> {
    const isAdmin = roles.includes('Admin');

    let subscription: SubscriptionData | null = null;
    if (isAdmin) {
      const rows = await this.prisma.withPlatformSchema(async (tx) => {
        return tx.$queryRawUnsafe<
          Array<{
            current_user_count: number;
            max_users: number;
            subscription_tier: string;
            status: string;
            trial_ends_at: Date | null;
          }>
        >(
          `SELECT current_user_count, max_users, subscription_tier, status, trial_ends_at
           FROM tenants WHERE id = $1::uuid LIMIT 1`,
          tenantId,
        );
      });

      if (rows.length > 0) {
        const r = rows[0];
        const maxUsers = r.max_users || 1;
        const util = Math.round((r.current_user_count / maxUsers) * 100);
        const warnings = buildWarnings(
          r.status,
          r.trial_ends_at,
          r.current_user_count,
          r.max_users,
        );

        subscription = {
          tier: r.subscription_tier,
          currentUserCount: r.current_user_count,
          maxUsers: r.max_users,
          utilizationPercent: util,
          status: r.status,
          trialEndsAt: r.trial_ends_at ? r.trial_ends_at.toISOString() : null,
          warnings,
        };
      }
    }

    let totalEmployees: number | null = null;
    try {
      const countRows = (await this.prisma.withTenantSchema(schemaName, async (tx) => {
        return tx.$queryRawUnsafe(
          `SELECT COUNT(*)::bigint as count FROM users WHERE status = 'active'`,
        );
      })) as Array<{ count: bigint }>;
      totalEmployees = countRows?.[0] ? Number(countRows[0].count) : 0;
    } catch {
      totalEmployees = null;
    }

    return {
      subscription,
      quickStats: {
        totalEmployees,
        pendingLeaveRequests: null,
        activeGoals: null,
        openJobOpenings: null,
      },
    };
  }

  async getSubscriptionStatus(tenantId: string, roles: string[]): Promise<{
    tier: string;
    currentUserCount: number;
    maxUsers: number;
    status: string;
    trialEndsAt: string | null;
    warnings: SubscriptionWarning[];
  } | null> {
    const isAdmin = roles.includes('Admin');
    if (!isAdmin) return null;

    const rows = await this.prisma.withPlatformSchema(async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{
          current_user_count: number;
          max_users: number;
          subscription_tier: string;
          status: string;
          trial_ends_at: Date | null;
        }>
      >(
        `SELECT current_user_count, max_users, subscription_tier, status, trial_ends_at
         FROM tenants WHERE id = $1::uuid LIMIT 1`,
        tenantId,
      );
    });

    if (rows.length === 0) return null;

    const r = rows[0];
    const warnings = buildWarnings(
      r.status,
      r.trial_ends_at,
      r.current_user_count,
      r.max_users,
    );

    return {
      tier: r.subscription_tier,
      currentUserCount: r.current_user_count,
      maxUsers: r.max_users,
      status: r.status,
      trialEndsAt: r.trial_ends_at ? r.trial_ends_at.toISOString() : null,
      warnings,
    };
  }
}
