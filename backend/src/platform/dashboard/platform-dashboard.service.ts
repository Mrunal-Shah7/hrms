import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface TenantStats {
  active: number;
  trial: number;
  suspended: number;
  cancelled: number;
  total: number;
}

export interface UserStats {
  totalUsers: number;
  totalSeats: number;
  utilizationPercent: number;
}

export interface RevenueStats {
  currentMonthRevenue: number;
  totalRevenue: number;
  pendingRevenue: number;
}

export interface RecentRegistration {
  id: string;
  organizationName: string;
  adminEmail: string;
  tier: string;
  status: string;
  createdAt: Date;
}

export interface TrialExpiringTenant {
  id: string;
  name: string;
  slug: string;
  trialEndsAt: Date;
  billingEmail: string;
}

export interface OverduePayment {
  id: string;
  totalAmount: number;
  periodStart: Date;
  periodEnd: Date;
  tenantName: string;
  tenantSlug: string;
}

export interface SystemHealth {
  dbConnectionOk: boolean;
  tenantsWithErrors: number;
}

export interface DashboardStats {
  tenantStats: TenantStats;
  userStats: UserStats;
  revenue: RevenueStats;
  recentRegistrations: RecentRegistration[];
  trialExpiring: TrialExpiringTenant[];
  overduePayments: OverduePayment[];
  systemHealth: SystemHealth;
}

@Injectable()
export class PlatformDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(): Promise<DashboardStats> {
    const [
      tenantStats,
      userStats,
      revenue,
      recentRegistrations,
      trialExpiring,
      overduePayments,
      systemHealth,
    ] = await Promise.all([
      this.getTenantStats(),
      this.getUserStats(),
      this.getRevenueStats(),
      this.getRecentRegistrations(),
      this.getTrialExpiring(),
      this.getOverduePayments(),
      this.getSystemHealth(),
    ]);

    return {
      tenantStats,
      userStats,
      revenue,
      recentRegistrations,
      trialExpiring,
      overduePayments,
      systemHealth,
    };
  }

  private async getTenantStats(): Promise<TenantStats> {
    const rows = await this.prisma.queryRaw<{ status: string; count: bigint }>(
      `SELECT status, COUNT(*)::bigint as count
       FROM platform.tenants
       GROUP BY status`,
    );

    const stats: TenantStats = {
      active: 0,
      trial: 0,
      suspended: 0,
      cancelled: 0,
      total: 0,
    };

    for (const row of rows) {
      const count = Number(row.count);
      const key = row.status as keyof TenantStats;
      if (key in stats && key !== 'total') {
        stats[key] = count;
      }
      stats.total += count;
    }

    return stats;
  }

  private async getUserStats(): Promise<UserStats> {
    const rows = await this.prisma.queryRaw<{
      total_users: string;
      total_seats: string;
    }>(
      `SELECT
         COALESCE(SUM(current_user_count), 0)::bigint as total_users,
         COALESCE(SUM(max_users), 0)::bigint as total_seats
       FROM platform.tenants
       WHERE status != 'cancelled'`,
    );

    const totalUsers = Number(rows[0]?.total_users ?? 0);
    const totalSeats = Number(rows[0]?.total_seats ?? 0);
    const utilizationPercent =
      totalSeats > 0 ? Math.round((totalUsers / totalSeats) * 100) : 0;

    return {
      totalUsers,
      totalSeats,
      utilizationPercent,
    };
  }

  private async getRevenueStats(): Promise<RevenueStats> {
    const rows = await this.prisma.queryRaw<{
      current_month_revenue: string;
      total_revenue: string;
      pending_revenue: string;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'paid' AND period_start >= date_trunc('month', CURRENT_DATE) THEN total_amount ELSE 0 END), 0)::numeric as current_month_revenue,
         COALESCE(SUM(CASE WHEN status = 'paid' THEN total_amount ELSE 0 END), 0)::numeric as total_revenue,
         COALESCE(SUM(CASE WHEN status = 'pending' THEN total_amount ELSE 0 END), 0)::numeric as pending_revenue
       FROM platform.billing_records`,
    );

    return {
      currentMonthRevenue: parseFloat(rows[0]?.current_month_revenue ?? '0'),
      totalRevenue: parseFloat(rows[0]?.total_revenue ?? '0'),
      pendingRevenue: parseFloat(rows[0]?.pending_revenue ?? '0'),
    };
  }

  private async getRecentRegistrations(): Promise<RecentRegistration[]> {
    const rows = await this.prisma.queryRaw<{
      id: string;
      organization_name: string;
      admin_email: string;
      subscription_tier: string;
      status: string;
      created_at: Date;
    }>(
      `SELECT id, organization_name, admin_email, subscription_tier, status, created_at
       FROM platform.registration_requests
       ORDER BY created_at DESC
       LIMIT 10`,
    );

    return rows.map((r) => ({
      id: r.id,
      organizationName: r.organization_name,
      adminEmail: r.admin_email,
      tier: r.subscription_tier,
      status: r.status,
      createdAt: r.created_at,
    }));
  }

  private async getTrialExpiring(): Promise<TrialExpiringTenant[]> {
    const rows = await this.prisma.queryRaw<{
      id: string;
      name: string;
      slug: string;
      trial_ends_at: Date;
      billing_email: string;
    }>(
      `SELECT id, name, slug, trial_ends_at, billing_email
       FROM platform.tenants
       WHERE status = 'trial'
         AND trial_ends_at IS NOT NULL
         AND trial_ends_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
       ORDER BY trial_ends_at ASC`,
    );

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      trialEndsAt: r.trial_ends_at,
      billingEmail: r.billing_email,
    }));
  }

  private async getOverduePayments(): Promise<OverduePayment[]> {
    const rows = await this.prisma.queryRaw<{
      id: string;
      total_amount: string;
      period_start: Date;
      period_end: Date;
      tenant_name: string;
      tenant_slug: string;
    }>(
      `SELECT br.id, br.total_amount, br.period_start, br.period_end,
              t.name as tenant_name, t.slug as tenant_slug
       FROM platform.billing_records br
       JOIN platform.tenants t ON br.tenant_id = t.id
       WHERE br.status = 'overdue'
       ORDER BY br.period_end ASC`,
    );

    return rows.map((r) => ({
      id: r.id,
      totalAmount: parseFloat(r.total_amount),
      periodStart: r.period_start,
      periodEnd: r.period_end,
      tenantName: r.tenant_name,
      tenantSlug: r.tenant_slug,
    }));
  }

  private async getSystemHealth(): Promise<SystemHealth> {
    let dbConnectionOk = false;
    let tenantsWithErrors = 0;

    try {
      await this.prisma.queryRaw(`SELECT 1`);
      dbConnectionOk = true;
    } catch {
      dbConnectionOk = false;
    }

    if (dbConnectionOk) {
      const rows = await this.prisma.queryRaw<{ count: bigint }>(
        `SELECT COUNT(*)::bigint as count
         FROM platform.registration_requests
         WHERE status = 'failed'`,
      );
      tenantsWithErrors = Number(rows[0]?.count ?? 0);
    }

    return { dbConnectionOk, tenantsWithErrors };
  }
}
