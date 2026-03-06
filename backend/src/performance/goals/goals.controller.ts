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
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ParseUUIDPipe } from '@nestjs/common/pipes';
import { GoalsService } from './goals.service';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantInfo } from '../../tenant/tenant.interface';
import {
  CreateGoalDto,
  UpdateGoalDto,
  UpdateProgressDto,
  ListGoalsQueryDto,
} from './dto';

@ApiTags('Goals')
@ApiBearerAuth()
@Controller('goals')
@UseGuards(TenantAuthGuard)
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('performance', 'view', 'goals')
  @ApiOperation({ summary: 'List goals' })
  async list(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Query() query: ListGoalsQueryDto,
  ) {
    const result = await this.goalsService.list(tenant, userId, roles ?? [], {
      page: query.page,
      limit: query.limit,
      assignedToType: query.assignedToType,
      status: query.status,
      priority: query.priority,
      filter: query.filter as 'all' | 'this_week' | 'last_week' | 'this_month' | 'last_month',
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });
    return { success: true, ...result };
  }

  @Get('export')
  @UseGuards(PermissionGuard)
  @RequirePermission('performance', 'export', 'goals')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Export goals' })
  async export(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Query('format') format: 'csv' | 'xlsx' | 'pdf' = 'csv',
    @Query('assignedToType') assignedToType?: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('filter') filter?: string,
    @Res({ passthrough: false }) res?: Response,
  ) {
    const fmt = format === 'pdf' ? 'pdf' : format === 'xlsx' ? 'xlsx' : 'csv';
    const { buffer, filename } = await this.goalsService.export(
      tenant,
      userId,
      roles ?? [],
      {
        format: fmt,
        assignedToType,
        status,
        priority,
        filter: filter as 'all' | 'this_week' | 'last_week' | 'this_month' | 'last_month',
      },
    );
    if (res) {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      if (fmt === 'csv') res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      else if (fmt === 'xlsx') res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      else res.setHeader('Content-Type', 'application/pdf');
      return new StreamableFile(buffer);
    }
    return { success: true, filename };
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission('performance', 'create', 'goals')
  @ApiOperation({ summary: 'Create goal' })
  async create(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateGoalDto,
  ) {
    const data = await this.goalsService.create(tenant, userId, dto);
    return { success: true, data };
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('performance', 'view', 'goals')
  @ApiOperation({ summary: 'Get goal by id' })
  async findOne(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.goalsService.findOne(tenant, userId, roles ?? [], id);
    return { success: true, data };
  }

  @Put(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('performance', 'edit', 'goals')
  @ApiOperation({ summary: 'Update goal' })
  async update(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGoalDto,
  ) {
    const data = await this.goalsService.update(tenant, userId, roles ?? [], id, dto);
    return { success: true, data };
  }

  @Put(':id/progress')
  @UseGuards(PermissionGuard)
  @RequirePermission('performance', 'edit', 'goals')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update goal progress' })
  async updateProgress(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProgressDto,
  ) {
    const data = await this.goalsService.updateProgress(
      tenant,
      userId,
      roles ?? [],
      id,
      dto,
    );
    return { success: true, data };
  }

  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('performance', 'delete', 'goals')
  @ApiOperation({ summary: 'Delete goal' })
  async remove(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.goalsService.remove(tenant, userId, roles ?? [], id);
    return { success: true, ...result };
  }
}
