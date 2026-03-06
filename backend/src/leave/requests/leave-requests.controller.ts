import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ParseUUIDPipe } from '@nestjs/common/pipes';
import { LeaveRequestsService } from './leave-requests.service';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantInfo } from '../../tenant/tenant.interface';
import { ApplyLeaveDto, ReviewLeaveDto, ListLeaveRequestsQueryDto, ExportLeaveRequestsQueryDto } from './dto';

@ApiTags('Leave Requests')
@ApiBearerAuth()
@Controller('leave/requests')
@UseGuards(TenantAuthGuard)
export class LeaveRequestsController {
  constructor(private readonly leaveRequestsService: LeaveRequestsService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'leave_requests')
  @ApiOperation({ summary: 'List leave requests' })
  async list(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Query() query: ListLeaveRequestsQueryDto,
  ) {
    const result = await this.leaveRequestsService.list(tenant, userId, roles ?? [], query);
    return { success: true, ...result };
  }

  @Get('preview')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'leave_requests')
  @ApiOperation({ summary: 'Preview leave days breakdown' })
  async preview(
    @TenantContext() tenant: TenantInfo,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('durationType') durationType?: 'full_day' | 'first_half' | 'second_half',
  ) {
    if (!startDate || !endDate) {
      return { success: true, data: { totalDays: 0, breakdown: [], holidaysInRange: [] } };
    }
    const data = await this.leaveRequestsService.preview(
      tenant,
      startDate,
      endDate,
      durationType ?? 'full_day',
    );
    return { success: true, data };
  }

  @Get('export')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'export', 'leave_requests')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Export leave requests' })
  async export(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Query() query: ExportLeaveRequestsQueryDto,
    @Query('format') format: 'csv' | 'xlsx' | 'pdf',
    @Res({ passthrough: false }) res: Response,
  ) {
    const fmt = format === 'pdf' ? 'pdf' : format === 'xlsx' ? 'xlsx' : 'csv';
    const { format: _omit, ...listQuery } = query;
    const buffer = await this.leaveRequestsService.export(tenant, userId, roles ?? [], listQuery, fmt);
    const filename = `leave_requests_${new Date().toISOString().slice(0, 10)}.${fmt}`;
    const contentTypes: Record<string, string> = {
      csv: 'text/csv',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pdf: 'application/pdf',
    };
    res.set({
      'Content-Type': contentTypes[fmt],
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    return new StreamableFile(buffer);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'create', 'leave_requests')
  @ApiOperation({ summary: 'Apply for leave' })
  @ApiResponse({ status: 201, description: 'Leave request created' })
  async apply(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Body() dto: ApplyLeaveDto,
  ) {
    const data = await this.leaveRequestsService.apply(tenant, userId, roles ?? [], dto);
    return { success: true, data };
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'leave_requests')
  @ApiOperation({ summary: 'Get leave request detail' })
  async findOne(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.leaveRequestsService.findOne(tenant, userId, roles ?? [], id);
    return { success: true, data };
  }

  @Put(':id/review')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'approve', 'leave_requests')
  @ApiOperation({ summary: 'Approve or reject leave request' })
  async review(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewLeaveDto,
  ) {
    const data = await this.leaveRequestsService.review(tenant, userId, id, dto);
    return { success: true, data };
  }

  @Put(':id/cancel')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'cancel', 'leave_requests')
  @ApiOperation({ summary: 'Cancel leave request' })
  async cancel(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.leaveRequestsService.cancel(tenant, userId, roles ?? [], id);
    return { success: true, data };
  }
}
