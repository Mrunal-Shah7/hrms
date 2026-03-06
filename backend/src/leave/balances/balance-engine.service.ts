import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { getLeaveYear, getLeaveYearRange, getLeaveYearLabel } from '../utils/leave-year.util';

interface PolicyRow {
  id: string;
  leave_type_id: string;
  designation_id: string | null;
  department_id: string | null;
  employment_type: string | null;
  annual_allocation: number;
  carry_forward: boolean;
  max_carry_forward: number | null;
  accrual_type: string;
}

interface LeaveTypeRow {
  id: string;
  code: string;
}

interface EmployeeRow {
  user_id: string;
  designation_id: string | null;
  department_id: string | null;
  employment_type: string | null;
  date_of_joining: Date | null;
}

interface PrevBalanceRow {
  total_allocated: number;
  carried_forward: number;
  used: number;
}

export interface GenerateBalancesOptions {
  userId?: string;
  dryRun?: boolean;
  auditUserId?: string;
}

export interface GenerateBalancesResult {
  dryRun: boolean;
  year: number;
  summary: {
    employeesProcessed: number;
    balancesCreated: number;
    balancesUpdated: number;
    carryForwardsApplied: number;
  };
}

@Injectable()
export class BalanceEngineService {
  constructor(private readonly prisma: PrismaService) {}

  private async getFinancialYearStartMonth(schemaName: string): Promise<number> {
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<Array<{ financial_year_start_month: number }>>(
        `SELECT financial_year_start_month FROM organization_settings LIMIT 1`,
      );
    });
    return rows[0]?.financial_year_start_month ?? 1;
  }

  /**
   * Score policy match: 3 = all match, 2 = two, 1 = one, 0 = default.
   * Tie-break: higher annual_allocation wins (employee-favorable).
   */
  private scorePolicy(
    policy: PolicyRow,
    emp: { designationId: string | null; departmentId: string | null; employmentType: string | null },
  ): { score: number; allocation: number } {
    let score = 0;
    if (policy.designation_id != null && emp.designationId === policy.designation_id) score++;
    else if (policy.designation_id != null) return { score: -1, allocation: 0 };
    if (policy.department_id != null && emp.departmentId === policy.department_id) score++;
    else if (policy.department_id != null) return { score: -1, allocation: 0 };
    if (policy.employment_type != null && emp.employmentType === policy.employment_type) score++;
    else if (policy.employment_type != null) return { score: -1, allocation: 0 };
    return { score, allocation: policy.annual_allocation };
  }

  private pickBestPolicy(
    policies: PolicyRow[],
    emp: { designationId: string | null; departmentId: string | null; employmentType: string | null },
  ): PolicyRow | null {
    let best: { policy: PolicyRow; score: number; allocation: number } | null = null;
    for (const p of policies) {
      const { score, allocation } = this.scorePolicy(p, emp);
      if (score < 0) continue;
      if (!best || score > best.score || (score === best.score && allocation > best.allocation)) {
        best = { policy: p, score, allocation };
      }
    }
    return best?.policy ?? null;
  }

  private async insertAuditLog(
    schemaName: string,
    userId: string | null,
    action: string,
    module: string,
    entityType: string,
    entityId: string,
    oldValue: object | null,
    newValue: object | null,
  ) {
    await this.prisma.withTenantSchema(schemaName, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO audit_logs (id, user_id, action, module, entity_type, entity_id, old_value, new_value, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, NOW())`,
        userId ?? null,
        action,
        module,
        entityType,
        entityId,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
      );
    });
  }

  async generateBalancesForYear(
    schemaName: string,
    year: number,
    options: GenerateBalancesOptions = {},
  ): Promise<GenerateBalancesResult> {
    const { userId, dryRun = false, auditUserId } = options;
    const fyMonth = await this.getFinancialYearStartMonth(schemaName);
    const { startDate, endDate } = getLeaveYearRange(year, fyMonth);
    const asOf = new Date();
    const runYear = getLeaveYear(asOf, fyMonth);

    const result = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const leaveTypes = (await tx.$queryRawUnsafe(
        `SELECT id, code FROM leave_types`,
      )) as LeaveTypeRow[];
      const lwpTypeIds = new Set(leaveTypes.filter((lt) => lt.code === 'LWP').map((lt) => lt.id));

      let employees: EmployeeRow[];
      if (userId) {
        const rows = (await tx.$queryRawUnsafe(
          `SELECT ep.user_id, ep.designation_id, ep.department_id, ep.employment_type, ep.date_of_joining
           FROM users u
           JOIN employee_profiles ep ON u.id = ep.user_id
           WHERE u.id = $1 AND u.status = 'active'`,
          userId,
        )) as EmployeeRow[];
        employees = rows;
      } else {
        employees = (await tx.$queryRawUnsafe(
          `SELECT ep.user_id, ep.designation_id, ep.department_id, ep.employment_type, ep.date_of_joining
           FROM users u
           JOIN employee_profiles ep ON u.id = ep.user_id
           WHERE u.status = 'active'`,
        )) as EmployeeRow[];
      }

      const policiesByType = new Map<string, PolicyRow[]>();
      const allPolicies = (await tx.$queryRawUnsafe(
        `SELECT id, leave_type_id, designation_id, department_id, employment_type,
                annual_allocation, carry_forward, max_carry_forward, accrual_type
         FROM leave_policies`,
      )) as PolicyRow[];
      for (const p of allPolicies) {
        const list = policiesByType.get(p.leave_type_id) ?? [];
        list.push(p);
        policiesByType.set(p.leave_type_id, list);
      }

      let employeesProcessed = 0;
      let balancesCreated = 0;
      let balancesUpdated = 0;
      let carryForwardsApplied = 0;

      for (const emp of employees) {
        employeesProcessed++;
        const empProfile = {
          designationId: emp.designation_id,
          departmentId: emp.department_id,
          employmentType: emp.employment_type,
        };
        const doj = emp.date_of_joining ? new Date(emp.date_of_joining) : startDate;
        const joinedInThisYear = doj <= endDate && doj >= startDate;
        const joinLeaveYear = getLeaveYear(doj, fyMonth);
        const monthsInYear = 12;
        const monthZero = startDate.getMonth();
        const monthsElapsed = (() => {
          if (asOf < startDate) return 0;
          if (asOf > endDate) return monthsInYear;
          const y = asOf.getFullYear() - startDate.getFullYear();
          const m = asOf.getMonth() - monthZero + y * 12;
          return Math.min(monthsInYear, m + 1);
        })();
        const joinMonth1Based = (() => {
          if (doj < startDate) return 0;
          const y = doj.getFullYear() - startDate.getFullYear();
          const m = (doj.getMonth() - monthZero) + y * 12 + 1;
          return Math.min(monthsInYear, Math.max(1, m));
        })();
        const monthsFromJoin = joinLeaveYear < year ? monthsElapsed : Math.max(0, monthsElapsed - joinMonth1Based);
        const quartersElapsed = Math.min(4, Math.floor((monthsElapsed - 1) / 3) + 1);
        const quartersFromJoin = Math.max(0, Math.floor((monthsFromJoin - 1) / 3) + 1);

        for (const lt of leaveTypes) {
          const policies = policiesByType.get(lt.id) ?? [];
          const policy = this.pickBestPolicy(policies, empProfile);
          let totalAllocated = 0;
          let carryForward = 0;

          if (lwpTypeIds.has(lt.id)) {
            totalAllocated = 0;
            carryForward = 0;
          } else if (policy) {
            const annual = policy.annual_allocation;
            switch (policy.accrual_type) {
              case 'annual':
                if (joinedInThisYear && year === runYear) {
                  const endMonth = endDate.getMonth() + 1 + endDate.getFullYear() * 12;
                  const joinMonth = doj.getMonth() + 1 + doj.getFullYear() * 12;
                  const monthsRemaining = Math.max(0, endMonth - joinMonth + 1);
                  totalAllocated = Math.round((annual / 12) * monthsRemaining * 10) / 10;
                } else {
                  totalAllocated = annual;
                }
                break;
              case 'monthly':
                totalAllocated = Math.round((annual / 12) * (year === runYear ? monthsFromJoin : monthsInYear) * 10) / 10;
                break;
              case 'quarterly':
                totalAllocated = Math.round((annual / 4) * (year === runYear ? quartersFromJoin : 4) * 10) / 10;
                break;
              default:
                totalAllocated = annual;
            }

            if (policy.carry_forward && policy.max_carry_forward != null) {
              const prev = (await tx.$queryRawUnsafe(
                `SELECT total_allocated, carried_forward, used FROM leave_balances
                 WHERE user_id = $1 AND leave_type_id = $2 AND year = $3`,
                emp.user_id,
                lt.id,
                year - 1,
              )) as PrevBalanceRow[];
              if (prev.length > 0) {
                const p = prev[0];
                const remaining = p.total_allocated + p.carried_forward - p.used;
                if (remaining > 0) {
                  carryForward = Math.min(remaining, policy.max_carry_forward);
                  carryForwardsApplied++;
                }
              }
            }
          } else {
            totalAllocated = 10;
          }

          if (dryRun) continue;

          const existing = (await tx.$queryRawUnsafe(
            `SELECT id, used FROM leave_balances WHERE user_id = $1 AND leave_type_id = $2 AND year = $3`,
            emp.user_id,
            lt.id,
            year,
          )) as Array<{ id: string; used: number }>;
          if (existing.length > 0) {
            await tx.$executeRawUnsafe(
              `UPDATE leave_balances SET total_allocated = $1, carried_forward = $2
               WHERE user_id = $3 AND leave_type_id = $4 AND year = $5`,
              totalAllocated,
              carryForward,
              emp.user_id,
              lt.id,
              year,
            );
            balancesUpdated++;
          } else {
            await tx.$executeRawUnsafe(
              `INSERT INTO leave_balances (id, user_id, leave_type_id, year, total_allocated, carried_forward, used)
               VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 0)
               ON CONFLICT (user_id, leave_type_id, year)
               DO UPDATE SET total_allocated = EXCLUDED.total_allocated, carried_forward = EXCLUDED.carried_forward`,
              emp.user_id,
              lt.id,
              year,
              totalAllocated,
              carryForward,
            );
            balancesCreated++;
          }
        }
      }

      return {
        dryRun,
        year,
        summary: {
          employeesProcessed,
          balancesCreated,
          balancesUpdated,
          carryForwardsApplied,
        },
      };
    });

    if (!dryRun && auditUserId) {
      await this.insertAuditLog(
        schemaName,
        auditUserId,
        'create',
        'leave',
        'leave_balances',
        `year-${year}`,
        null,
        result.summary,
      );
    }
    return result;
  }

  /**
   * Set (or adjust) leave balance for a specific user, leave type, and year.
   * Admin-only. Creates or updates the total_allocated; carried_forward and used are preserved.
   */
  async setBalance(
    schemaName: string,
    dto: { userId: string; leaveTypeId: string; year: number; totalAllocated: number },
    auditUserId: string,
  ): Promise<{ userId: string; leaveTypeId: string; year: number; totalAllocated: number; carriedForward: number; used: number }> {
    const result = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const existing = (await tx.$queryRawUnsafe(
        `SELECT id, carried_forward, used FROM leave_balances WHERE user_id = $1 AND leave_type_id = $2 AND year = $3`,
        dto.userId,
        dto.leaveTypeId,
        dto.year,
      )) as Array<{ id: string; carried_forward: number; used: number }>;
      const carriedForward = existing[0]?.carried_forward ?? 0;
      const used = existing[0]?.used ?? 0;
      let balanceId: string;
      if (existing.length > 0) {
        balanceId = existing[0].id;
        await tx.$executeRawUnsafe(
          `UPDATE leave_balances SET total_allocated = $1 WHERE user_id = $2 AND leave_type_id = $3 AND year = $4`,
          dto.totalAllocated,
          dto.userId,
          dto.leaveTypeId,
          dto.year,
        );
      } else {
        const inserted = (await tx.$queryRawUnsafe(
          `INSERT INTO leave_balances (id, user_id, leave_type_id, year, total_allocated, carried_forward, used)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 0, 0)
           RETURNING id`,
          dto.userId,
          dto.leaveTypeId,
          dto.year,
          dto.totalAllocated,
        )) as Array<{ id: string }>;
        balanceId = inserted[0]?.id ?? '';
      }
      return {
        userId: dto.userId,
        leaveTypeId: dto.leaveTypeId,
        year: dto.year,
        totalAllocated: dto.totalAllocated,
        carriedForward: existing[0]?.carried_forward ?? 0,
        used: existing[0]?.used ?? 0,
        balanceId,
      };
    });
    await this.insertAuditLog(
      schemaName,
      auditUserId,
      'update',
      'leave',
      'leave_balances',
      result.balanceId,
      null,
      {
        userId: result.userId,
        leaveTypeId: result.leaveTypeId,
        year: result.year,
        totalAllocated: result.totalAllocated,
        carriedForward: result.carriedForward,
        used: result.used,
      },
    );
    return {
      userId: result.userId,
      leaveTypeId: result.leaveTypeId,
      year: result.year,
      totalAllocated: result.totalAllocated,
      carriedForward: result.carriedForward,
      used: result.used,
    };
  }

  /**
   * List users (id, employeeId, firstName, lastName) for admin balance dropdown.
   */
  async getUsersForBalance(schemaName: string): Promise<Array<{ id: string; employeeId: string | null; firstName: string; lastName: string }>> {
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const result = await tx.$queryRawUnsafe(
        `SELECT u.id, u.employee_id, u.first_name, u.last_name
         FROM users u
         JOIN employee_profiles ep ON u.id = ep.user_id
         WHERE u.status = 'active'
         ORDER BY u.first_name, u.last_name`,
      );
      return result as Array<{ id: string; employee_id: string | null; first_name: string; last_name: string }>;
    });
    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employee_id,
      firstName: r.first_name,
      lastName: r.last_name,
    }));
  }

  async getBalanceStatus(schemaName: string, year: number): Promise<{
    year: number;
    leaveYearLabel: string;
    totalActiveEmployees: number;
    employeesWithBalances: number;
    employeesWithoutBalances: number;
    missingEmployees: Array<{ id: string; employeeId: string | null; firstName: string; lastName: string }>;
    lastGeneratedAt: string | null;
  }> {
    const fyMonth = await this.getFinancialYearStartMonth(schemaName);
    const leaveYearLabel = getLeaveYearLabel(year, fyMonth);

    const result = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const activeCount = (await tx.$queryRawUnsafe<{ count: string }[]>(
        `SELECT COUNT(*)::text AS count FROM users u JOIN employee_profiles ep ON u.id = ep.user_id WHERE u.status = 'active'`,
      ))[0];
      const totalActiveEmployees = parseInt(activeCount?.count ?? '0', 10);
      const withBalances = (await tx.$queryRawUnsafe<{ count: string }[]>(
        `SELECT COUNT(DISTINCT user_id)::text AS count FROM leave_balances WHERE year = $1`,
        year,
      ))[0];
      const employeesWithBalances = parseInt(withBalances?.count ?? '0', 10);
      const employeesWithoutBalances = totalActiveEmployees - employeesWithBalances;
      const missingRows = (await tx.$queryRawUnsafe(
        `SELECT u.id, u.employee_id, u.first_name, u.last_name
         FROM users u
         JOIN employee_profiles ep ON u.id = ep.user_id
         WHERE u.status = 'active'
           AND NOT EXISTS (SELECT 1 FROM leave_balances lb WHERE lb.user_id = u.id AND lb.year = $1)`,
        year,
      )) as Array<{ id: string; employee_id: string | null; first_name: string; last_name: string }>;
      return {
        year,
        leaveYearLabel,
        totalActiveEmployees,
        employeesWithBalances,
        employeesWithoutBalances,
        missingEmployees: missingRows.map((r) => ({
          id: r.id,
          employeeId: r.employee_id,
          firstName: r.first_name,
          lastName: r.last_name,
        })),
        lastGeneratedAt: null,
      };
    });
    return result;
  }

  /**
   * List all users with their leave balances per type for a given year (admin grid).
   */
  async listBalancesForAdmin(
    schemaName: string,
    year: number,
  ): Promise<{
    year: number;
    leaveYearLabel: string;
    leaveTypes: Array<{ id: string; name: string; code: string }>;
    users: Array<{
      id: string;
      employeeId: string | null;
      firstName: string;
      lastName: string;
      balances: Array<{
        leaveTypeId: string;
        leaveTypeName: string;
        totalAllocated: number;
        used: number;
        available: number;
      }>;
    }>;
  }> {
    const fyMonth = await this.getFinancialYearStartMonth(schemaName);
    const leaveYearLabel = getLeaveYearLabel(year, fyMonth);

    const raw = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const types = await tx.$queryRawUnsafe<
        Array<{ id: string; name: string; code: string }>
      >(`SELECT id, name, code FROM leave_types ORDER BY name`);
      const users = await tx.$queryRawUnsafe<
        Array<{ id: string; employee_id: string | null; first_name: string; last_name: string }>
      >(
        `SELECT u.id, u.employee_id, u.first_name, u.last_name
         FROM users u
         JOIN employee_profiles ep ON u.id = ep.user_id
         WHERE u.status = 'active'
         ORDER BY u.first_name, u.last_name`,
      );
      const balRows = await tx.$queryRawUnsafe<
        Array<{ user_id: string; leave_type_id: string; total_allocated: number; carried_forward: number; used: number }>
      >(
        `SELECT user_id, leave_type_id, total_allocated, carried_forward, used
         FROM leave_balances WHERE year = $1`,
        year,
      );
      return { types, users, balRows };
    });

    const balanceMap = new Map<string, { totalAllocated: number; used: number; available: number }>();
    for (const r of raw.balRows) {
      const key = `${r.user_id}:${r.leave_type_id}`;
      const available = r.total_allocated + r.carried_forward - r.used;
      balanceMap.set(key, { totalAllocated: r.total_allocated, used: r.used, available });
    }

    const leaveTypes = raw.types.map((t) => ({ id: t.id, name: t.name, code: t.code }));
    const users = raw.users.map((u) => ({
      id: u.id,
      employeeId: u.employee_id,
      firstName: u.first_name,
      lastName: u.last_name,
      balances: leaveTypes.map((lt) => {
        const key = `${u.id}:${lt.id}`;
        const b = balanceMap.get(key) ?? { totalAllocated: 0, used: 0, available: 0 };
        return {
          leaveTypeId: lt.id,
          leaveTypeName: lt.name,
          totalAllocated: b.totalAllocated,
          used: b.used,
          available: b.available,
        };
      }),
    }));

    return { year, leaveYearLabel, leaveTypes, users };
  }
}
