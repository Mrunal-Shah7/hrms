import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantInfo } from '../../tenant/tenant.interface';
import type { CreateWorkScheduleDto } from './dto/create-work-schedule.dto';
import type { UpdateWorkScheduleDto } from './dto/update-work-schedule.dto';

export interface WorkScheduleRow {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  workingDays: string[];
  gracePeriodMinutes: number;
  minHoursFullDay: number;
  minHoursHalfDay: number;
  overtimeThresholdHours: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  employeeCount?: number;
}

@Injectable()
export class WorkScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenant: TenantInfo): Promise<WorkScheduleRow[]> {
    const rows = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{
          id: string;
          name: string;
          start_time: string;
          end_time: string;
          working_days: unknown;
          grace_period_minutes: number;
          min_hours_full_day: number;
          min_hours_half_day: number;
          overtime_threshold_hours: number;
          is_default: boolean;
          created_at: Date;
          updated_at: Date;
        }>
      >(
        `SELECT id, name, start_time, end_time, working_days, grace_period_minutes,
         min_hours_full_day, min_hours_half_day, overtime_threshold_hours, is_default, created_at, updated_at
         FROM work_schedule ORDER BY is_default DESC, name`,
      );
    });
    return rows.map((r) => this.toRow(r));
  }

  async getById(tenant: TenantInfo, id: string): Promise<WorkScheduleRow | null> {
    const rows = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{
          id: string;
          name: string;
          start_time: string;
          end_time: string;
          working_days: unknown;
          grace_period_minutes: number;
          min_hours_full_day: number;
          min_hours_half_day: number;
          overtime_threshold_hours: number;
          is_default: boolean;
          created_at: Date;
          updated_at: Date;
        }>
      >(
        `SELECT id, name, start_time, end_time, working_days, grace_period_minutes,
         min_hours_full_day, min_hours_half_day, overtime_threshold_hours, is_default, created_at, updated_at
         FROM work_schedule WHERE id = $1::uuid`,
        id,
      );
    });
    if (rows.length === 0) return null;
    const row = rows[0];
    let employeeCount = 0;
    if (row.is_default) {
      const countRows = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
        return tx.$queryRawUnsafe<Array<{ count: string }>>(
          `SELECT COUNT(*)::text AS count FROM users WHERE status = 'active'`,
        );
      });
      employeeCount = Number(countRows[0]?.count ?? 0);
    }
    return { ...this.toRow(row), employeeCount };
  }

  async create(
    tenant: TenantInfo,
    userId: string,
    dto: CreateWorkScheduleDto,
  ): Promise<WorkScheduleRow> {
    this.validateTimes(dto.startTime, dto.endTime, dto.minHoursHalfDay, dto.minHoursFullDay);
    const id = crypto.randomUUID();
    const workingDaysJson = JSON.stringify(dto.workingDays);

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const existing = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM work_schedule WHERE name = $1`,
        dto.name,
      );
      if (existing.length > 0) {
        throw new ConflictException('Name already exists');
      }
      if (dto.isDefault) {
        await tx.$executeRawUnsafe(
          `UPDATE work_schedule SET is_default = false`,
        );
      }
      await tx.$executeRawUnsafe(
        `INSERT INTO work_schedule (id, name, start_time, end_time, working_days, grace_period_minutes,
         min_hours_full_day, min_hours_half_day, overtime_threshold_hours, is_default, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, NOW(), NOW())`,
        id,
        dto.name,
        dto.startTime,
        dto.endTime,
        workingDaysJson,
        dto.gracePeriodMinutes,
        dto.minHoursFullDay,
        dto.minHoursHalfDay,
        dto.overtimeThresholdHours,
        dto.isDefault ?? false,
      );
      await this.insertAuditLog(tenant.schemaName, userId, 'create', 'attendance', 'work_schedule', id, null, dto as object);
    });

    const created = await this.getById(tenant, id);
    if (!created) throw new NotFoundException('Work schedule not found');
    return created;
  }

  async update(
    tenant: TenantInfo,
    userId: string,
    id: string,
    dto: UpdateWorkScheduleDto,
  ): Promise<WorkScheduleRow> {
    const existing = await this.getById(tenant, id);
    if (!existing) throw new NotFoundException('Work schedule not found');

    const startTime = dto.startTime ?? existing.startTime;
    const endTime = dto.endTime ?? existing.endTime;
    const minHalf = dto.minHoursHalfDay ?? existing.minHoursHalfDay;
    const minFull = dto.minHoursFullDay ?? existing.minHoursFullDay;
    this.validateTimes(startTime, endTime, minHalf, minFull);

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      if (dto.name !== undefined && dto.name !== existing.name) {
        const dup = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM work_schedule WHERE name = $1 AND id != $2::uuid`,
          dto.name,
          id,
        );
        if (dup.length > 0) throw new ConflictException('Name already exists');
      }
      if (dto.isDefault === true) {
        await tx.$executeRawUnsafe(`UPDATE work_schedule SET is_default = false WHERE id != $1::uuid`, id);
      }

      const updates: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (dto.name !== undefined) {
        updates.push(`name = $${idx++}`);
        params.push(dto.name);
      }
      if (dto.startTime !== undefined) {
        updates.push(`start_time = $${idx++}`);
        params.push(dto.startTime);
      }
      if (dto.endTime !== undefined) {
        updates.push(`end_time = $${idx++}`);
        params.push(dto.endTime);
      }
      if (dto.workingDays !== undefined) {
        updates.push(`working_days = $${idx++}::jsonb`);
        params.push(JSON.stringify(dto.workingDays));
      }
      if (dto.gracePeriodMinutes !== undefined) {
        updates.push(`grace_period_minutes = $${idx++}`);
        params.push(dto.gracePeriodMinutes);
      }
      if (dto.minHoursFullDay !== undefined) {
        updates.push(`min_hours_full_day = $${idx++}`);
        params.push(dto.minHoursFullDay);
      }
      if (dto.minHoursHalfDay !== undefined) {
        updates.push(`min_hours_half_day = $${idx++}`);
        params.push(dto.minHoursHalfDay);
      }
      if (dto.overtimeThresholdHours !== undefined) {
        updates.push(`overtime_threshold_hours = $${idx++}`);
        params.push(dto.overtimeThresholdHours);
      }
      if (dto.isDefault !== undefined) {
        updates.push(`is_default = $${idx++}`);
        params.push(dto.isDefault);
      }
      if (updates.length > 0) {
        updates.push(`updated_at = NOW()`);
        params.push(id);
        await tx.$executeRawUnsafe(
          `UPDATE work_schedule SET ${updates.join(', ')} WHERE id = $${idx}::uuid`,
          ...params,
        );
      }
      await this.insertAuditLog(tenant.schemaName, userId, 'update', 'attendance', 'work_schedule', id, { name: existing.name }, dto as object);
    });

    const updated = await this.getById(tenant, id);
    if (!updated) throw new NotFoundException('Work schedule not found');
    return updated;
  }

  async delete(tenant: TenantInfo, userId: string, id: string): Promise<{ message: string }> {
    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ is_default: boolean; name: string }>>(
        `SELECT is_default, name FROM work_schedule WHERE id = $1::uuid`,
        id,
      );
      if (rows.length === 0) throw new NotFoundException('Work schedule not found');
      if (rows[0].is_default) {
        throw new BadRequestException(
          'Cannot delete the default work schedule. Set another schedule as default first.',
        );
      }
      await tx.$executeRawUnsafe(`DELETE FROM work_schedule WHERE id = $1::uuid`, id);
      await this.insertAuditLog(tenant.schemaName, userId, 'delete', 'attendance', 'work_schedule', id, { name: rows[0].name }, null);
    });
    return { message: 'Work schedule deleted' };
  }

  private validateTimes(
    startTime: string,
    endTime: string,
    minHoursHalfDay: number,
    minHoursFullDay: number,
  ): void {
    if (endTime <= startTime) {
      throw new BadRequestException('End time must be after start time');
    }
    if (minHoursHalfDay >= minHoursFullDay) {
      throw new BadRequestException('Min hours half day must be less than min hours full day');
    }
  }

  private toRow(r: {
    id: string;
    name: string;
    start_time: string;
    end_time: string;
    working_days: unknown;
    grace_period_minutes: number;
    min_hours_full_day: number;
    min_hours_half_day: number;
    overtime_threshold_hours: number;
    is_default: boolean;
    created_at: Date;
    updated_at: Date;
  }): WorkScheduleRow {
    const workingDays = Array.isArray(r.working_days)
      ? (r.working_days as string[])
      : (typeof r.working_days === 'string' ? JSON.parse(r.working_days) : []) as string[];
    return {
      id: r.id,
      name: r.name,
      startTime: r.start_time,
      endTime: r.end_time,
      workingDays,
      gracePeriodMinutes: r.grace_period_minutes,
      minHoursFullDay: r.min_hours_full_day,
      minHoursHalfDay: r.min_hours_half_day,
      overtimeThresholdHours: r.overtime_threshold_hours,
      isDefault: r.is_default,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  }

  private async insertAuditLog(
    schemaName: string,
    userId: string,
    action: string,
    module: string,
    entityType: string,
    entityId: string,
    oldValue: object | null,
    newValue: object | null,
  ): Promise<void> {
    await this.prisma.withTenantSchema(schemaName, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO audit_logs (id, user_id, action, module, entity_type, entity_id, old_value, new_value, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, NOW())`,
        userId,
        action,
        module,
        entityType,
        entityId,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
      );
    });
  }
}
