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

  /**
   * Get actual non-archived user count from tenant schema and correct
   * platform.tenants.current_user_count if it has drifted.
   */
  private async getActualUserCountAndFixDrift(
    tenantId: string,
    schemaName: string,
    storedCount: number,
  ): Promise<number> {
    const countRows = await this.prisma.withTenantSchema(schemaName, (tx) =>
      tx.$queryRawUnsafe<Array<{ count: string }>>(
        `SELECT COUNT(*)::text as count FROM users WHERE status != 'archived'`,
      ),
    );
    const actual = parseInt(countRows[0]?.count ?? '0', 10);
    if (actual !== storedCount) {
      await this.prisma.withPlatformSchema(async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE tenants SET current_user_count = $1, updated_at = NOW() WHERE id = $2::uuid`,
          actual,
          tenantId,
        );
      });
    }
    return actual;
  }

  async getDashboardData(
    tenantId: string,
    schemaName: string,
    roles: string[],
    userId?: string,
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
        const currentUserCount = await this.getActualUserCountAndFixDrift(
          tenantId,
          schemaName,
          r.current_user_count,
        );
        const maxUsers = r.max_users || 1;
        const util = Math.round((currentUserCount / maxUsers) * 100);
        const warnings = buildWarnings(
          r.status,
          r.trial_ends_at,
          currentUserCount,
          r.max_users,
        );

        subscription = {
          tier: r.subscription_tier,
          currentUserCount,
          maxUsers: r.max_users,
          utilizationPercent: util,
          status: r.status,
          trialEndsAt: r.trial_ends_at ? r.trial_ends_at.toISOString() : null,
          warnings,
        };
      }
    }

    let totalEmployees: number | null = null;
    let pendingLeaveRequests: number | null = null;
    let activeGoals: number | null = null;
    try {
      const queries: Promise<unknown>[] = [
        this.prisma.withTenantSchema(schemaName, (tx) =>
          tx.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT COUNT(*)::bigint as count FROM users WHERE status = 'active'`,
          ),
        ),
        this.prisma.withTenantSchema(schemaName, (tx) =>
          tx.$queryRawUnsafe<Array<{ count: string }>>(
            `SELECT COUNT(*)::text as count FROM leave_requests WHERE status = 'pending'`,
          ),
        ),
      ];
      if (userId) {
        queries.push(
          this.prisma.withTenantSchema(schemaName, (tx) =>
            tx.$queryRawUnsafe<Array<{ count: string }>>(
              `SELECT COUNT(*)::text as count FROM goals g
               WHERE g.status IN ('not_started', 'in_progress')
                 AND (
                   (g.assigned_to_type = 'user' AND g.assigned_to_id = $1::uuid)
                   OR (g.assigned_to_type = 'group' AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = g.assigned_to_id AND gm.user_id = $1::uuid))
                   OR (g.assigned_to_type = 'project' AND EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = g.assigned_to_id AND pm.user_id = $1::uuid))
                 )`,
              userId,
            ),
          ),
        );
      }
      const results = await Promise.all(queries);
      totalEmployees = (results[0] as Array<{ count: bigint }>)?.[0] ? Number((results[0] as Array<{ count: bigint }>)[0].count) : 0;
      pendingLeaveRequests = (results[1] as Array<{ count: string }>)?.[0] ? parseInt((results[1] as Array<{ count: string }>)[0].count, 10) : 0;
      if (userId && results[2]) {
        activeGoals = (results[2] as Array<{ count: string }>)?.[0] ? parseInt((results[2] as Array<{ count: string }>)[0].count, 10) : 0;
      }
    } catch {
      totalEmployees = null;
      pendingLeaveRequests = null;
      activeGoals = null;
    }

    return {
      subscription,
      quickStats: {
        totalEmployees,
        pendingLeaveRequests,
        activeGoals,
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
          schema_name: string;
        }>
      >(
        `SELECT current_user_count, max_users, subscription_tier, status, trial_ends_at, schema_name
         FROM tenants WHERE id = $1::uuid LIMIT 1`,
        tenantId,
      );
    });

    if (rows.length === 0) return null;

    const r = rows[0];
    const currentUserCount = await this.getActualUserCountAndFixDrift(
      tenantId,
      r.schema_name,
      r.current_user_count,
    );
    const warnings = buildWarnings(
      r.status,
      r.trial_ends_at,
      currentUserCount,
      r.max_users,
    );

    return {
      tier: r.subscription_tier,
      currentUserCount,
      maxUsers: r.max_users,
      status: r.status,
      trialEndsAt: r.trial_ends_at ? r.trial_ends_at.toISOString() : null,
      warnings,
    };
  }
}
