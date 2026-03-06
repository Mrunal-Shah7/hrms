import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExportService } from '../../core/export/export.service';
import { TenantInfo } from '../../tenant/tenant.interface';
import { getLeaveYear } from '../utils/leave-year.util';
import type { CreateHolidayDto } from './dto/create-holiday.dto';
import type { UpdateHolidayDto } from './dto/update-holiday.dto';
import type { ListHolidaysQueryDto } from './dto/list-holidays-query.dto';
import type { ColumnDef } from '../../core/export/export.service';
import { parse } from 'csv-parse/sync';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface HolidayRow {
  id: string;
  name: string;
  date: Date;
  is_optional: boolean;
  year: number;
  created_at: Date;
}

export interface HolidayImportResult {
  summary: { totalRows: number; imported: number; errors: number };
  imported: Array<{ row: number; name: string; date: string }>;
  errors: Array<{ row: number; message: string }>;
}

@Injectable()
export class HolidaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exportService: ExportService,
  ) {}

  private async getFinancialYearStartMonth(schemaName: string): Promise<number> {
    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<Array<{ financial_year_start_month: number }>>(
        `SELECT financial_year_start_month FROM organization_settings LIMIT 1`,
      );
    });
    return rows[0]?.financial_year_start_month ?? 1;
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

  async list(tenant: TenantInfo, query: ListHolidaysQueryDto) {
    const fyMonth = await this.getFinancialYearStartMonth(tenant.schemaName);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const offset = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'date';
    const sortOrder = query.sortOrder ?? 'asc';
    const currentYear = getLeaveYear(new Date(), fyMonth);
    const year = query.year ?? currentYear;
    const sortColMap: Record<string, string> = {
      date: 'h.date',
      name: 'h.name',
      createdAt: 'h.created_at',
    };
    const orderCol = sortColMap[sortBy] ?? 'h.date';

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const countResult = (await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::text as count FROM holidays h WHERE h.year = $1`,
        year,
      )) as Array<{ count: string }>;
      const total = parseInt(countResult[0]?.count ?? '0', 10);

      const rows = (await tx.$queryRawUnsafe(
        `SELECT id, name, date, is_optional, year, created_at
         FROM holidays
         WHERE year = $1
         ORDER BY ${orderCol} ${sortOrder === 'desc' ? 'DESC' : 'ASC'}
         LIMIT $2 OFFSET $3`,
        year,
        limit,
        offset,
      )) as HolidayRow[];

      const data = rows.map((r) => {
        const d = new Date(r.date);
        const dayOfWeek = DAY_NAMES[d.getDay()];
        return {
          id: r.id,
          name: r.name,
          date: r.date,
          isOptional: r.is_optional,
          year: r.year,
          dayOfWeek,
          createdAt: r.created_at,
        };
      });

      return {
        data,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  async create(tenant: TenantInfo, userId: string, dto: CreateHolidayDto) {
    const fyMonth = await this.getFinancialYearStartMonth(tenant.schemaName);
    const dateObj = new Date(dto.date);
    const year = getLeaveYear(dateObj, fyMonth);

    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const existingDate = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM holidays WHERE date = $1::date`,
        dto.date,
      );
      if (existingDate.length > 0) {
        throw new ConflictException('A holiday already exists on this date');
      }
      const id = crypto.randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO holidays (id, name, date, is_optional, year, created_at)
         VALUES ($1, $2, $3::date, $4, $5, NOW())`,
        id,
        dto.name,
        dto.date,
        dto.isOptional ?? false,
        year,
      );
      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'create',
        'leave',
        'holidays',
        id,
        null,
        { name: dto.name, date: dto.date },
      );
      const rows = (await tx.$queryRawUnsafe(
        `SELECT id, name, date, is_optional, year, created_at FROM holidays WHERE id = $1`,
        id,
      )) as HolidayRow[];
      const r = rows[0];
      const d = new Date(r.date);
      return {
        id: r.id,
        name: r.name,
        date: r.date,
        isOptional: r.is_optional,
        year: r.year,
        dayOfWeek: DAY_NAMES[d.getDay()],
        createdAt: r.created_at,
      };
    });
  }

  async findOne(tenant: TenantInfo, id: string) {
    const result = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const rows = (await tx.$queryRawUnsafe(
        `SELECT id, name, date, is_optional, year, created_at FROM holidays WHERE id = $1`,
        id,
      )) as HolidayRow[];
      if (rows.length === 0) return null;
      const r = rows[0];
      const d = new Date(r.date);
      return {
        id: r.id,
        name: r.name,
        date: r.date,
        isOptional: r.is_optional,
        year: r.year,
        dayOfWeek: DAY_NAMES[d.getDay()],
        createdAt: r.created_at,
      };
    });
    if (!result) throw new NotFoundException('Holiday not found');
    return result;
  }

  async update(tenant: TenantInfo, userId: string, id: string, dto: UpdateHolidayDto) {
    const fyMonth = await this.getFinancialYearStartMonth(tenant.schemaName);
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const existing = (await tx.$queryRawUnsafe(
        `SELECT id, name, date FROM holidays WHERE id = $1`,
        id,
      )) as Array<{ id: string; name: string; date: Date }>;
      if (existing.length === 0) throw new NotFoundException('Holiday not found');
      let year: number | undefined;
      if (dto.date !== undefined) {
        year = getLeaveYear(new Date(dto.date), fyMonth);
        const dup = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM holidays WHERE date = $1::date AND id != $2`,
          dto.date,
          id,
        );
        if (dup.length > 0) {
          throw new ConflictException('A holiday already exists on this date');
        }
      }
      const updates: string[] = [];
      const params: unknown[] = [];
      let p = 1;
      if (dto.name !== undefined) {
        updates.push(`name = $${p++}`);
        params.push(dto.name);
      }
      if (dto.date !== undefined) {
        updates.push(`date = $${p++}`);
        params.push(dto.date);
      }
      if (year !== undefined) {
        updates.push(`year = $${p++}`);
        params.push(year);
      }
      if (dto.isOptional !== undefined) {
        updates.push(`is_optional = $${p++}`);
        params.push(dto.isOptional);
      }
      if (updates.length > 0) {
        params.push(id);
        await tx.$executeRawUnsafe(
          `UPDATE holidays SET ${updates.join(', ')} WHERE id = $${p}`,
          ...params,
        );
        await this.insertAuditLog(
          tenant.schemaName,
          userId,
          'update',
          'leave',
          'holidays',
          id,
          { name: existing[0].name, date: existing[0].date },
          dto as object,
        );
      }
      return this.findOne(tenant, id);
    });
  }

  async delete(tenant: TenantInfo, userId: string, id: string) {
    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const existing = (await tx.$queryRawUnsafe(
        `SELECT id, name, date FROM holidays WHERE id = $1`,
        id,
      )) as Array<{ id: string; name: string; date: Date }>;
      if (existing.length === 0) throw new NotFoundException('Holiday not found');
      await tx.$executeRawUnsafe(`DELETE FROM holidays WHERE id = $1`, id);
      await this.insertAuditLog(
        tenant.schemaName,
        userId,
        'delete',
        'leave',
        'holidays',
        id,
        { name: existing[0].name, date: existing[0].date },
        null,
      );
    });
    return { message: 'Holiday deleted' };
  }

  async export(tenant: TenantInfo, format: 'csv' | 'xlsx', year?: number) {
    const fyMonth = await this.getFinancialYearStartMonth(tenant.schemaName);
    const y = year ?? getLeaveYear(new Date(), fyMonth);
    const { data } = await this.list(tenant, { page: 1, limit: 1000, year: y });
    const columns: ColumnDef[] = [
      { key: 'name', header: 'Name' },
      { key: 'date', header: 'Date', format: (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)) },
      { key: 'dayOfWeek', header: 'Day of Week' },
      { key: 'isOptional', header: 'Optional', format: (v) => (v ? 'Yes' : 'No') },
      { key: 'year', header: 'Year' },
    ];
    if (format === 'csv') return this.exportService.toCsv(data, columns);
    return this.exportService.toXlsx(data, columns, { sheetName: 'Holidays' });
  }

  getImportTemplate(): Buffer {
    const bom = '\uFEFF';
    const header = 'name,date,is_optional';
    const sample = 'Republic Day,2026-01-26,false';
    const content = `${bom}${header}\n${sample}\n`;
    return Buffer.from(content, 'utf-8');
  }

  async import(
    tenant: TenantInfo,
    userId: string,
    file: { buffer: Buffer },
    dryRun: boolean,
  ): Promise<HolidayImportResult> {
    const fyMonth = await this.getFinancialYearStartMonth(tenant.schemaName);
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
    const normalized = records.map((r) => {
      const key = (k: string) => Object.keys(r).find((x) => x.toLowerCase() === k.toLowerCase()) ?? k;
      return {
        name: (r[key('name')] ?? '').trim(),
        date: (r[key('date')] ?? '').trim(),
        is_optional: (r[key('is_optional')] ?? 'false').trim().toLowerCase(),
      };
    });
    const errors: Array<{ row: number; message: string }> = [];
    const validRows: Array<{ row: number; name: string; date: string; isOptional: boolean }> = [];
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const seenDates = new Set<string>();

    for (let i = 0; i < normalized.length; i++) {
      const row = normalized[i];
      const rowNum = i + 2;
      if (!row.name || row.name.length > 255) {
        errors.push({ row: rowNum, message: 'name is required and must be at most 255 characters' });
        continue;
      }
      if (!row.date || !dateRegex.test(row.date)) {
        errors.push({ row: rowNum, message: 'date is required and must be YYYY-MM-DD' });
        continue;
      }
      if (
        row.is_optional !== '' &&
        row.is_optional !== 'true' &&
        row.is_optional !== 'false'
      ) {
        errors.push({ row: rowNum, message: 'is_optional must be true or false' });
        continue;
      }
      const isOpt = row.is_optional === 'true';
      if (seenDates.has(row.date)) {
        errors.push({ row: rowNum, message: 'Duplicate date within file' });
        continue;
      }
      seenDates.add(row.date);
      validRows.push({ row: rowNum, name: row.name, date: row.date, isOptional: isOpt });
    }

    if (dryRun) {
      return {
        summary: { totalRows: normalized.length, imported: 0, errors: errors.length },
        imported: [],
        errors,
      };
    }

    const imported: Array<{ row: number; name: string; date: string }> = [];
    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const existingDates = (await tx.$queryRawUnsafe(
        `SELECT date::text AS date FROM holidays`,
      )) as Array<{ date: string }>;
      const existingSet = new Set(existingDates.map((x) => x.date));
      for (const v of validRows) {
        if (existingSet.has(v.date)) {
          errors.push({ row: v.row, message: 'A holiday already exists on this date' });
          continue;
        }
        const year = getLeaveYear(new Date(v.date), fyMonth);
        const id = crypto.randomUUID();
        await tx.$executeRawUnsafe(
          `INSERT INTO holidays (id, name, date, is_optional, year, created_at)
           VALUES ($1, $2, $3::date, $4, $5, NOW())`,
          id,
          v.name,
          v.date,
          v.isOptional,
          year,
        );
        existingSet.add(v.date);
        imported.push({ row: v.row, name: v.name, date: v.date });
      }
      if (imported.length > 0) {
        await this.insertAuditLog(
          tenant.schemaName,
          userId,
          'import',
          'leave',
          'holidays',
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
