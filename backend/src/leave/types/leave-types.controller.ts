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
import type { Response } from 'express';
import { StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ParseUUIDPipe } from '@nestjs/common/pipes';
import { LeaveTypesService } from './leave-types.service';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantInfo } from '../../tenant/tenant.interface';
import { CreateLeaveTypeDto, UpdateLeaveTypeDto, ListLeaveTypesQueryDto } from './dto';

@ApiTags('Leave Types')
@ApiBearerAuth()
@Controller('leave/types')
@UseGuards(TenantAuthGuard)
export class LeaveTypesController {
  constructor(private readonly leaveTypesService: LeaveTypesService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'leave_types')
  @ApiOperation({ summary: 'List leave types' })
  async list(
    @TenantContext() tenant: TenantInfo,
    @Query() query: ListLeaveTypesQueryDto,
  ) {
    const result = await this.leaveTypesService.list(tenant, query);
    return { success: true, ...result };
  }

  @Get('export')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'leave_types')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Export leave types' })
  async export(
    @TenantContext() tenant: TenantInfo,
    @Query('format') format: 'csv' | 'xlsx' = 'csv',
    @Res({ passthrough: false }) res: Response,
  ) {
    if (!['csv', 'xlsx'].includes(format ?? '')) format = 'csv';
    const buffer = await this.leaveTypesService.export(tenant, format);
    const filename = `leave_types_${new Date().toISOString().slice(0, 10)}.${format}`;
    const contentType =
      format === 'csv'
        ? 'text/csv'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    return new StreamableFile(buffer);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'create', 'leave_types')
  @ApiOperation({ summary: 'Create leave type' })
  @ApiResponse({ status: 201, description: 'Leave type created' })
  @ApiResponse({ status: 409, description: 'Code or name already exists' })
  async create(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateLeaveTypeDto,
  ) {
    const data = await this.leaveTypesService.create(tenant, userId, dto);
    return { success: true, data };
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'leave_types')
  @ApiOperation({ summary: 'Get leave type detail' })
  async findOne(
    @TenantContext() tenant: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.leaveTypesService.findOne(tenant, id);
    return { success: true, data };
  }

  @Put(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'edit', 'leave_types')
  @ApiOperation({ summary: 'Update leave type' })
  async update(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeaveTypeDto,
  ) {
    const data = await this.leaveTypesService.update(tenant, userId, id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'delete', 'leave_types')
  @ApiOperation({ summary: 'Delete leave type' })
  @ApiResponse({ status: 400, description: 'Cannot delete when requests exist' })
  async delete(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.leaveTypesService.delete(tenant, userId, id);
    return { success: true, ...result };
  }
}
