import { Injectable, BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantInfo } from '../../tenant/tenant.interface';

export interface DesigImportError {
  row: number;
  field: string;
  value: string;
  message: string;
}

const CODE_REGEX = /^[A-Z0-9_-]+$/;

function trim(s: string): string {
  return (s ?? '').trim();
}

export function getDesigTemplateCsv(): Buffer {
  const bom = '\uFEFF';
  const headers = 'name,code,hierarchy_level';
  const sample = 'Senior Engineer,SR-ENG,4';
  return Buffer.from(`${bom}${headers}\n${sample}\n`, 'utf-8');
}

@Injectable()
export class DesignationImportService {
  constructor(private readonly prisma: PrismaService) {}

  getTemplate(): Buffer {
    return getDesigTemplateCsv();
  }

  async import(
    tenant: TenantInfo,
    userId: string,
    file: { buffer: Buffer; originalname?: string; size?: number },
    dryRun: boolean,
  ): Promise<{
    summary: { totalRows: number; imported: number; skipped: number; errors: number; wouldImport?: number; wouldSkip?: number };
    dryRun?: boolean;
    imported?: Array<{ row: number; name: string; code: string }>;
    errors: DesigImportError[];
  }> {
    const MAX_SIZE = 2 * 1024 * 1024;
    if (!file?.buffer || (file.size ?? 0) > MAX_SIZE) {
      throw new BadRequestException('Invalid file or size exceeds 2MB');
    }

    let records: Record<string, string>[];
    try {
      records = parse(file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });
    } catch (err) {
      throw new BadRequestException(`Invalid CSV: ${(err as Error).message}`);
    }

    const dataRows = records.filter((r) => {
      const v = Object.values(r)[0] ?? '';
      return !String(v).trim().startsWith('#');
    });

    const existing = await this.prisma.withTenantSchema(tenant.schemaName, (tx) =>
      tx.$queryRawUnsafe<Array<{ code: string; name: string }>>(`SELECT code, name FROM designations`),
    );
    const existingCodes = new Set(existing.map((d) => (d.code ?? '').toUpperCase()));
    const existingNames = new Set(existing.map((d) => (d.name ?? '').toLowerCase()));

    const allErrors: DesigImportError[] = [];
    const validRows: { row: { name: string; code: string; hierarchyLevel: number }; rowIndex: number }[] = [];
    const seenCodes = new Set<string>();
    const seenNames = new Set<string>();

    for (let i = 0; i < dataRows.length; i++) {
      const r = dataRows[i];
      const rowIndex = i + 2;
      const name = trim(r.name ?? r.Name ?? '');
      const code = trim(r.code ?? r.Code ?? '').toUpperCase();
      const hierarchyLevelStr = trim(r.hierarchy_level ?? r.hierarchyLevel ?? '');

      const rowErrors: DesigImportError[] = [];

      if (!name) rowErrors.push({ row: rowIndex, field: 'name', value: name, message: 'Name is required' });
      else if (name.length > 255) rowErrors.push({ row: rowIndex, field: 'name', value: name, message: 'Name exceeds 255 characters' });
      else if (seenNames.has(name.toLowerCase())) rowErrors.push({ row: rowIndex, field: 'name', value: name, message: 'Duplicate name in file' });
      else if (existingNames.has(name.toLowerCase())) rowErrors.push({ row: rowIndex, field: 'name', value: name, message: 'Designation name already exists in the system' });

      if (!code) rowErrors.push({ row: rowIndex, field: 'code', value: code, message: 'Code is required' });
      else if (code.length > 50) rowErrors.push({ row: rowIndex, field: 'code', value: code, message: 'Code exceeds 50 characters' });
      else if (!CODE_REGEX.test(code)) rowErrors.push({ row: rowIndex, field: 'code', value: code, message: 'Code must be uppercase alphanumeric with underscore or dash' });
      else if (seenCodes.has(code)) rowErrors.push({ row: rowIndex, field: 'code', value: code, message: 'Duplicate code in file' });
      else if (existingCodes.has(code)) rowErrors.push({ row: rowIndex, field: 'code', value: code, message: 'Designation code already exists in the system' });

      const level = hierarchyLevelStr === '' ? NaN : parseInt(hierarchyLevelStr, 10);
      if (hierarchyLevelStr === '') rowErrors.push({ row: rowIndex, field: 'hierarchy_level', value: hierarchyLevelStr, message: 'Hierarchy level is required' });
      else if (isNaN(level) || level < 0 || level > 100) rowErrors.push({ row: rowIndex, field: 'hierarchy_level', value: hierarchyLevelStr, message: 'Hierarchy level must be an integer between 0 and 100' });

      if (rowErrors.length > 0) {
        allErrors.push(...rowErrors);
      } else {
        seenNames.add(name.toLowerCase());
        seenCodes.add(code);
        validRows.push({ row: { name, code, hierarchyLevel: level }, rowIndex });
      }
    }

    if (dryRun) {
      const wouldImport = validRows.length;
      const wouldSkip = dataRows.length - wouldImport;
      return {
        dryRun: true,
        summary: {
          totalRows: dataRows.length,
          imported: 0,
          skipped: wouldSkip,
          errors: allErrors.length,
          wouldImport,
          wouldSkip,
        },
        errors: allErrors,
      };
    }

    const imported: Array<{ row: number; name: string; code: string }> = [];

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      for (const { row, rowIndex } of validRows) {
        const id = crypto.randomUUID();
        await tx.$executeRawUnsafe(
          `INSERT INTO designations (id, name, code, hierarchy_level, created_at, updated_at)
           VALUES ($1::uuid, $2, $3, $4, NOW(), NOW())`,
          id,
          row.name,
          row.code,
          row.hierarchyLevel,
        );
        imported.push({ row: rowIndex, name: row.name, code: row.code });
      }

      await tx.$executeRawUnsafe(
        `INSERT INTO audit_logs (id, user_id, action, module, entity_type, entity_id, old_value, new_value, created_at)
         VALUES (gen_random_uuid(), $1, 'import', 'employee_management', 'designations', NULL, NULL, $2::jsonb, NOW())`,
        userId,
        JSON.stringify({ importedCount: validRows.length, skippedCount: dataRows.length - validRows.length, totalRows: dataRows.length, fileName: file.originalname ?? 'import.csv' }),
      );
    });

    return {
      summary: { totalRows: dataRows.length, imported: validRows.length, skipped: dataRows.length - validRows.length, errors: allErrors.length },
      imported,
      errors: allErrors,
    };
  }
}
