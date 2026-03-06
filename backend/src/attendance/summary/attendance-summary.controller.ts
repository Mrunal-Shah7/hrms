import { Controller, Get, Query, UseGuards, Res } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantInfo } from '../../tenant/tenant.interface';
import { AttendanceSummaryService } from './attendance-summary.service';

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller('attendance')
@UseGuards(TenantAuthGuard)
export class AttendanceSummaryController {
  constructor(private readonly attendanceSummaryService: AttendanceSummaryService) {}

  @Get('my-summary')
  @UseGuards(PermissionGuard)
  @RequirePermission('attendance', 'view', 'attendance')
  @ApiOperation({ summary: 'My attendance summary for a date range' })
  async getMySummary(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('view') _view?: string,
  ) {
    const data = await this.attendanceSummaryService.getMySummary(tenant, userId, from, to);
    return { success: true, data };
  }

  @Get('team')
  @UseGuards(PermissionGuard)
  @RequirePermission('attendance', 'view', 'team_attendance')
  @ApiOperation({ summary: 'Team attendance (all or reportees by role)' })
  async getTeam(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('permissions') permissions: string[],
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('departmentId') departmentId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
    const data = await this.attendanceSummaryService.getTeam(
      tenant,
      userId,
      permissions ?? [],
      from,
      to,
      departmentId,
      pageNum,
      limitNum,
    );
    return { success: true, ...data };
  }

  @Get('reportees')
  @UseGuards(PermissionGuard)
  @RequirePermission('attendance', 'view', 'team_attendance')
  @ApiOperation({ summary: 'Reportees attendance' })
  async getReportees(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
    const data = await this.attendanceSummaryService.getReportees(
      tenant,
      userId,
      from,
      to,
      pageNum,
      limitNum,
    );
    return { success: true, ...data };
  }

  @Get('export')
  @UseGuards(PermissionGuard)
  @RequirePermission('attendance', 'export', 'attendance')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Export attendance' })
  async export(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('permissions') permissions: string[],
    @Res({ passthrough: false }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('departmentId') departmentId?: string,
    @Query('format') format?: 'csv' | 'xlsx' | 'pdf',
  ) {
    const fmt = (format && ['csv', 'xlsx', 'pdf'].includes(format) ? format : 'csv') as 'csv' | 'xlsx' | 'pdf';
    const { buffer, fromDate, toDate } = await this.attendanceSummaryService.export(
      tenant,
      userId,
      permissions ?? [],
      from,
      to,
      departmentId,
      fmt,
    );
    const filename = `attendance_${fromDate}_to_${toDate}.${fmt}`;
    const contentType =
      fmt === 'csv'
        ? 'text/csv'
        : fmt === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/pdf';
    res.set({ 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${filename}"` });
    res.send(buffer);
  }
}
