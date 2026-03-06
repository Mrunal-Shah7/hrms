import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { StreamableFile } from '@nestjs/common';
import { ParseUUIDPipe } from '@nestjs/common/pipes';
import { LeavePoliciesService } from './leave-policies.service';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantInfo } from '../../tenant/tenant.interface';
import { CreateLeavePolicyDto, UpdateLeavePolicyDto, ListLeavePoliciesQueryDto } from './dto';

@ApiTags('Leave Policies')
@ApiBearerAuth()
@Controller('leave/policies')
@UseGuards(TenantAuthGuard)
export class LeavePoliciesController {
  constructor(private readonly leavePoliciesService: LeavePoliciesService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'leave_policies')
  @ApiOperation({ summary: 'List leave policies' })
  async list(
    @TenantContext() tenant: TenantInfo,
    @Query() query: ListLeavePoliciesQueryDto,
  ) {
    const result = await this.leavePoliciesService.list(tenant, query);
    return { success: true, ...result };
  }

  @Get('export')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'leave_policies')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Export leave policies' })
  async export(
    @TenantContext() tenant: TenantInfo,
    @Query() query: ListLeavePoliciesQueryDto,
    @Query('format') format: 'csv' | 'xlsx',
    @Res({ passthrough: false }) res: Response,
  ) {
    const fmt = format === 'xlsx' ? 'xlsx' : 'csv';
    const buffer = await this.leavePoliciesService.export(tenant, query, fmt);
    const filename = `leave_policies_${new Date().toISOString().slice(0, 10)}.${fmt}`;
    const contentTypes: Record<string, string> = {
      csv: 'text/csv',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    res.set({
      'Content-Type': contentTypes[fmt],
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    return new StreamableFile(buffer);
  }

  @Get('preview')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'leave_policies')
  @ApiOperation({ summary: 'Preview policy impact (affected employee count)' })
  async preview(
    @TenantContext() tenant: TenantInfo,
    @Query('leaveTypeId') leaveTypeId: string,
    @Query('designationId') designationId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('employmentType') employmentType?: string,
  ) {
    const data = await this.leavePoliciesService.preview(
      tenant,
      leaveTypeId,
      designationId,
      departmentId,
      employmentType,
    );
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'create', 'leave_policies')
  @ApiOperation({ summary: 'Create leave policy' })
  @ApiResponse({ status: 201, description: 'Policy created' })
  @ApiResponse({ status: 409, description: 'Duplicate scope for this leave type' })
  async create(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateLeavePolicyDto,
  ) {
    const data = await this.leavePoliciesService.create(tenant, userId, dto);
    return { success: true, data };
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'leave_policies')
  @ApiOperation({ summary: 'Get policy detail' })
  async findOne(
    @TenantContext() tenant: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.leavePoliciesService.findOne(tenant, id);
    return { success: true, data };
  }

  @Put(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'edit', 'leave_policies')
  @ApiOperation({ summary: 'Update policy' })
  async update(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeavePolicyDto,
  ) {
    const data = await this.leavePoliciesService.update(tenant, userId, id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'delete', 'leave_policies')
  @ApiOperation({ summary: 'Delete policy' })
  async delete(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.leavePoliciesService.delete(tenant, userId, id);
    return { success: true, ...result };
  }
}
