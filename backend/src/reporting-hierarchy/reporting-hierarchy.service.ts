import {
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantInfo } from '../tenant/tenant.interface';
import type { HierarchyEntryDto } from './dto/update-hierarchy.dto';

@Injectable()
export class ReportingHierarchyService {
  constructor(private readonly prisma: PrismaService) {}

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

  async getHierarchy(tenant: TenantInfo) {
    const rows = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe(
        `SELECT rh.id, rh.designation_id, rh.reports_to_designation_id, rh.level,
                d.name AS designation_name, d.code AS designation_code,
                pd.name AS reports_to_name, pd.code AS reports_to_code, pd.id AS reports_to_id
         FROM reporting_hierarchy rh
         JOIN designations d ON rh.designation_id = d.id
         LEFT JOIN designations pd ON rh.reports_to_designation_id = pd.id
         ORDER BY rh.level ASC`,
      );
    })) as Array<{
      id: string;
      designation_id: string;
      reports_to_designation_id: string | null;
      level: number;
      designation_name: string;
      designation_code: string;
      reports_to_name: string | null;
      reports_to_code: string | null;
      reports_to_id: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      designation: { id: r.designation_id, name: r.designation_name, code: r.designation_code },
      reportsTo: r.reports_to_id
        ? { id: r.reports_to_id, name: r.reports_to_name, code: r.reports_to_code }
        : null,
      level: r.level,
    }));
  }

  async updateHierarchy(
    tenant: TenantInfo,
    userId: string,
    entries: HierarchyEntryDto[],
  ) {
    if (!entries || entries.length === 0) {
      throw new BadRequestException('Entries array cannot be empty');
    }

    const designationIds = new Set(entries.map((e) => e.designationId));
    if (designationIds.size !== entries.length) {
      throw new BadRequestException('Duplicate designation IDs in entries');
    }

    const reportsToIds = new Set(
      entries.map((e) => e.reportsToDesignationId).filter((x): x is string => !!x),
    );

    const rootCount = entries.filter(
      (e) => e.reportsToDesignationId == null || e.reportsToDesignationId === '',
    ).length;
    if (rootCount !== 1) {
      throw new BadRequestException('Exactly one root node (reportsToDesignationId = null) is required');
    }

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const allDesignationIds = new Set([...designationIds, ...reportsToIds]);
      for (const did of allDesignationIds) {
        const exists = (await tx.$queryRawUnsafe(
          `SELECT id FROM designations WHERE id = $1::uuid`,
          did,
        )) as Array<{ id: string }>;
        if (exists.length === 0) {
          throw new BadRequestException('Designation not found: ' + did);
        }
      }

      const graph = new Map<string, string | null>();
      for (const e of entries) {
        const parent =
          e.reportsToDesignationId && e.reportsToDesignationId.trim()
            ? e.reportsToDesignationId
            : null;
        graph.set(e.designationId, parent);
      }

      const visited = new Set<string>();
      const recStack = new Set<string>();
      const hasCycle = (node: string): boolean => {
        visited.add(node);
        recStack.add(node);
        const parent = graph.get(node);
        if (parent && designationIds.has(parent)) {
          if (!visited.has(parent)) {
            if (hasCycle(parent)) return true;
          } else if (recStack.has(parent)) {
            return true;
          }
        }
        recStack.delete(node);
        return false;
      };
      for (const id of designationIds) {
        if (!visited.has(id) && hasCycle(id)) {
          throw new BadRequestException('Circular reference detected in hierarchy');
        }
      }

      await tx.$executeRawUnsafe(`DELETE FROM reporting_hierarchy`);

      for (const e of entries) {
        const id = crypto.randomUUID();
        const reportsTo =
          e.reportsToDesignationId && e.reportsToDesignationId.trim()
            ? e.reportsToDesignationId
            : null;
        await tx.$executeRawUnsafe(
          `INSERT INTO reporting_hierarchy (id, designation_id, reports_to_designation_id, level)
           VALUES ($1::uuid, $2::uuid, $3, $4)`,
          id,
          e.designationId,
          reportsTo,
          e.level,
        );
      }

      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'update',
        'employee_management',
        'reporting_hierarchy',
        'bulk',
        null,
        { entries } as object,
      );
    });

    return this.getHierarchy(tenant);
  }

  async getSuggestions(tenant: TenantInfo, designationId: string) {
    const row = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe(
        `SELECT rh.reports_to_designation_id, pd.name AS reports_to_name, pd.code AS reports_to_code
         FROM reporting_hierarchy rh
         LEFT JOIN designations pd ON rh.reports_to_designation_id = pd.id
         WHERE rh.designation_id = $1::uuid`,
        designationId,
      );
    })) as Array<{
      reports_to_designation_id: string | null;
      reports_to_name: string | null;
      reports_to_code: string | null;
    }>;

    if (!row || row.length === 0 || !row[0].reports_to_designation_id) {
      return {
        reportsToDesignation: null,
        suggestedManagers: [],
      };
    }

    const parentDesignationId = row[0].reports_to_designation_id;
    const reportsToDesignation = {
      id: parentDesignationId,
      name: row[0].reports_to_name,
      code: row[0].reports_to_code,
    };

    const managers = (await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe(
        `SELECT u.id, u.employee_id, u.first_name, u.last_name, u.email, u.photo_url
         FROM users u
         JOIN employee_profiles ep ON u.id = ep.user_id
         WHERE ep.designation_id = $1::uuid AND u.status = 'active'
         ORDER BY u.first_name
         LIMIT 10`,
        parentDesignationId,
      );
    })) as Array<{
      id: string;
      employee_id: string | null;
      first_name: string;
      last_name: string;
      email: string;
      photo_url: string | null;
    }>;

    return {
      reportsToDesignation,
      suggestedManagers: managers.map((m) => ({
        id: m.id,
        employeeId: m.employee_id,
        firstName: m.first_name,
        lastName: m.last_name,
        email: m.email,
        photoUrl: m.photo_url,
      })),
    };
  }
}
