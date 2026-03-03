import { Injectable, BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantInfo } from '../../tenant/tenant.interface';

export interface DeptImportError {
  row: number;
  field: string;
  value: string;
  message: string;
}

const CODE_REGEX = /^[A-Z0-9_-]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function trim(s: string): string {
  return (s ?? '').trim();
}

export function getDeptTemplateCsv(): Buffer {
  const bom = '\uFEFF';
  const headers = 'name,code,mail_alias,parent_code,head_email';
  const sample = 'Engineering,ENG,eng@acme.com,,cto@acme.com';
  return Buffer.from(`${bom}${headers}\n${sample}\n`, 'utf-8');
}

@Injectable()
export class DepartmentImportService {
  constructor(private readonly prisma: PrismaService) {}

  getTemplate(): Buffer {
    return getDeptTemplateCsv();
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
    errors: DeptImportError[];
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

    const existingDepts = await this.prisma.withTenantSchema(tenant.schemaName, (tx) =>
      tx.$queryRawUnsafe<Array<{ id: string; code: string }>>(`SELECT id, code FROM departments`),
    );
    const existingCodes = new Set(existingDepts.map((d) => (d.code ?? '').toUpperCase()));
    const usersByEmail = await this.prisma.withTenantSchema(tenant.schemaName, (tx) =>
      tx.$queryRawUnsafe<Array<{ id: string; email: string }>>(
        `SELECT id, email FROM users WHERE status = 'active'`,
      ),
    );
    const emailToId = new Map(usersByEmail.map((u) => [(u.email ?? '').toLowerCase(), u.id]));

    const allErrors: DeptImportError[] = [];
    const validRows: { row: Record<string, string>; rowIndex: number }[] = [];
    const codeToId = new Map<string, string>(existingDepts.map((d) => [(d.code ?? '').toUpperCase(), d.id]));
    const seenCodesInFile = new Set<string>();
    const seenNamesInFile = new Set<string>();

    for (let i = 0; i < dataRows.length; i++) {
      const r = dataRows[i];
      const rowIndex = i + 2;
      const name = trim(r.name ?? r.Name ?? '');
      const code = trim(r.code ?? r.Code ?? '').toUpperCase();
      const mailAlias = trim(r.mail_alias ?? r.mailAlias ?? '');
      const parentCode = trim(r.parent_code ?? r.parentCode ?? '').toUpperCase();
      const headEmail = trim(r.head_email ?? r.headEmail ?? '');

      const rowErrors: DeptImportError[] = [];

      if (!name) rowErrors.push({ row: rowIndex, field: 'name', value: name, message: 'Name is required' });
      else if (name.length > 255) rowErrors.push({ row: rowIndex, field: 'name', value: name, message: 'Name exceeds 255 characters' });
      else if (seenNamesInFile.has(name.toLowerCase())) rowErrors.push({ row: rowIndex, field: 'name', value: name, message: 'Duplicate name in file' });

      if (!code) rowErrors.push({ row: rowIndex, field: 'code', value: code, message: 'Code is required' });
      else if (code.length > 50) rowErrors.push({ row: rowIndex, field: 'code', value: code, message: 'Code exceeds 50 characters' });
      else if (!CODE_REGEX.test(code)) rowErrors.push({ row: rowIndex, field: 'code', value: code, message: 'Code must be uppercase alphanumeric with underscore or dash' });
      else if (seenCodesInFile.has(code)) rowErrors.push({ row: rowIndex, field: 'code', value: code, message: 'Duplicate code in file' });
      else if (existingCodes.has(code)) rowErrors.push({ row: rowIndex, field: 'code', value: code, message: "Department code already exists in the system" });

      if (mailAlias && !EMAIL_REGEX.test(mailAlias)) rowErrors.push({ row: rowIndex, field: 'mail_alias', value: mailAlias, message: 'Invalid email format' });

      if (parentCode && !codeToId.has(parentCode)) rowErrors.push({ row: rowIndex, field: 'parent_code', value: parentCode, message: `Parent department code '${parentCode}' not found` });

      if (headEmail && !emailToId.has(headEmail.toLowerCase())) rowErrors.push({ row: rowIndex, field: 'head_email', value: headEmail, message: `User with email '${headEmail}' not found or inactive` });

      if (rowErrors.length > 0) {
        allErrors.push(...rowErrors);
      } else {
        seenNamesInFile.add(name.toLowerCase());
        seenCodesInFile.add(code);
        validRows.push({ row: { name, code, mailAlias, parentCode, headEmail }, rowIndex });
        codeToId.set(code, ''); // placeholder - will be set on insert
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
        const parentIdVal = codeToId.get(row.parentCode);
        const parentId = parentIdVal && parentIdVal !== '' ? parentIdVal : null;
        let headId: string | null = null;
        if (row.headEmail) headId = emailToId.get(row.headEmail.toLowerCase()) ?? null;

        await tx.$executeRawUnsafe(
          `INSERT INTO departments (id, name, code, mail_alias, head_id, parent_id, created_at, updated_at)
           VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::uuid, NOW(), NOW())`,
          id,
          row.name,
          row.code,
          row.mailAlias || null,
          headId,
          parentId,
        );
        codeToId.set(row.code, id);
        imported.push({ row: rowIndex, name: row.name, code: row.code });
      }

      await tx.$executeRawUnsafe(
        `INSERT INTO audit_logs (id, user_id, action, module, entity_type, entity_id, old_value, new_value, created_at)
         VALUES (gen_random_uuid(), $1, 'import', 'employee_management', 'departments', NULL, NULL, $2::jsonb, NOW())`,
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
