import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantInfo } from '../../tenant/tenant.interface';
import { parse } from 'csv-parse/sync';

export interface BalanceImportResult {
  summary: { totalRows: number; imported: number; errors: number };
  imported: Array<{ row: number; email: string; leaveTypeCode: string; year: number }>;
  errors: Array<{ row: number; message: string }>;
}

@Injectable()
export class BalanceImportService {
  constructor(private readonly prisma: PrismaService) {}

  getTemplateCsv(): Buffer {
    const bom = '\uFEFF';
    const header = 'email,leave_type_code,year,total_allocated,carried_forward,used';
    const sample = 'john@acme.com,CL,2026,12,0,3';
    const content = `${bom}${header}\n${sample}\n`;
    return Buffer.from(content, 'utf-8');
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

  async import(
    tenant: TenantInfo,
    userId: string,
    file: { buffer: Buffer },
    dryRun: boolean,
  ): Promise<BalanceImportResult> {
    let records: Array<Record<string, string>>;
    try {
      records = parse(file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });
    } catch {
      throw new BadRequestException('Invalid CSV format');
    }
    const key = (r: Record<string, string>, k: string) =>
      Object.keys(r).find((x) => x.toLowerCase() === k.toLowerCase()) ?? k;
    const normalized = records.map((r) => ({
      email: (r[key(r, 'email')] ?? '').trim().toLowerCase(),
      leave_type_code: (r[key(r, 'leave_type_code')] ?? '').trim().toUpperCase(),
      year: (r[key(r, 'year')] ?? '').trim(),
      total_allocated: (r[key(r, 'total_allocated')] ?? '').trim(),
      carried_forward: (r[key(r, 'carried_forward')] ?? '0').trim(),
      used: (r[key(r, 'used')] ?? '0').trim(),
    }));

    const errors: Array<{ row: number; message: string }> = [];
    const validRows: Array<{
      row: number;
      email: string;
      leaveTypeCode: string;
      year: number;
      totalAllocated: number;
      carriedForward: number;
      used: number;
    }> = [];

    for (let i = 0; i < normalized.length; i++) {
      const row = normalized[i];
      const rowNum = i + 2;
      if (!row.email) {
        errors.push({ row: rowNum, message: 'email is required' });
        continue;
      }
      if (!row.leave_type_code) {
        errors.push({ row: rowNum, message: 'leave_type_code is required' });
        continue;
      }
      const y = parseInt(row.year, 10);
      if (!row.year || !Number.isFinite(y) || y < 2020 || y > 2099) {
        errors.push({ row: rowNum, message: 'year is required and must be 2020-2099' });
        continue;
      }
      const totalAllocated = parseFloat(row.total_allocated);
      if (row.total_allocated === '' || !Number.isFinite(totalAllocated) || totalAllocated < 0) {
        errors.push({ row: rowNum, message: 'total_allocated is required and must be >= 0' });
        continue;
      }
      const carriedForward = parseFloat(row.carried_forward || '0');
      if (!Number.isFinite(carriedForward) || carriedForward < 0) {
        errors.push({ row: rowNum, message: 'carried_forward must be >= 0' });
        continue;
      }
      const used = parseFloat(row.used || '0');
      if (!Number.isFinite(used) || used < 0) {
        errors.push({ row: rowNum, message: 'used must be >= 0' });
        continue;
      }
      if (used > totalAllocated + carriedForward) {
        errors.push({ row: rowNum, message: 'used cannot exceed total_allocated + carried_forward' });
        continue;
      }
      validRows.push({
        row: rowNum,
        email: row.email,
        leaveTypeCode: row.leave_type_code,
        year: y,
        totalAllocated,
        carriedForward,
        used,
      });
    }

    if (dryRun) {
      return {
        summary: { totalRows: normalized.length, imported: 0, errors: errors.length },
        imported: [],
        errors,
      };
    }

    const imported: Array<{ row: number; email: string; leaveTypeCode: string; year: number }> = [];
    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const userRows = await tx.$queryRawUnsafe<Array<{ id: string; email: string }>>(
        `SELECT id, LOWER(email) AS email FROM users WHERE status = 'active'`,
      );
      const usersByEmail = new Map(userRows.map((u) => [u.email, u.id]));
      const typeRows = await tx.$queryRawUnsafe<Array<{ id: string; code: string }>>(
        `SELECT id, code FROM leave_types`,
      );
      const typesByCode = new Map(typeRows.map((t) => [t.code, t.id]));

      for (const v of validRows) {
        const uid = usersByEmail.get(v.email);
        const typeId = typesByCode.get(v.leaveTypeCode);
        if (!uid) {
          errors.push({ row: v.row, message: 'User not found or inactive for this email' });
          continue;
        }
        if (!typeId) {
          errors.push({ row: v.row, message: `Leave type code '${v.leaveTypeCode}' not found` });
          continue;
        }
        await tx.$executeRawUnsafe(
          `INSERT INTO leave_balances (id, user_id, leave_type_id, year, total_allocated, carried_forward, used)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
           ON CONFLICT (user_id, leave_type_id, year)
           DO UPDATE SET total_allocated = $4, carried_forward = $5, used = $6`,
          uid,
          typeId,
          v.year,
          v.totalAllocated,
          v.carriedForward,
          v.used,
        );
        imported.push({ row: v.row, email: v.email, leaveTypeCode: v.leaveTypeCode, year: v.year });
      }
      if (imported.length > 0) {
        await this.insertAuditLog(
          tenant.schemaName,
          userId,
          'import',
          'leave',
          'leave_balances',
          'bulk',
          null,
          { imported: imported.length },
        );
      }
    });

    return {
      summary: { totalRows: normalized.length, imported: imported.length, errors: errors.length },
      imported,
      errors,
    };
  }
}
