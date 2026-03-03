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
import { TasksService } from './tasks.service';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantInfo } from '../../tenant/tenant.interface';
import {
  CreateTaskDto,
  UpdateTaskDto,
  ListTasksQueryDto,
} from './dto';

@ApiTags('Tasks')
@ApiBearerAuth()
@Controller('projects/:projectId/tasks')
@UseGuards(TenantAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'projects')
  @ApiOperation({ summary: 'List project tasks' })
  async list(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListTasksQueryDto,
  ) {
    const result = await this.tasksService.list(
      tenant,
      userId,
      roles ?? [],
      projectId,
      query,
    );
    return { success: true, ...result };
  }

  @Get('export')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'projects')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Export project tasks' })
  async export(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListTasksQueryDto & { format?: 'csv' | 'xlsx' | 'pdf' },
    @Res({ passthrough: false }) res: Response,
  ) {
    const format = ['csv', 'xlsx', 'pdf'].includes(query.format ?? '') ? query.format : 'csv';
    const { buffer, projectName } = await this.tasksService.export(
      tenant,
      userId,
      roles ?? [],
      projectId,
      query,
      format ?? 'csv',
    );
    const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeName}_tasks_${new Date().toISOString().slice(0, 10)}.${format}`;
    const contentType =
      format === 'csv'
        ? 'text/csv'
        : format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/pdf';
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
  @RequirePermission('employee_management', 'edit', 'projects')
  @ApiOperation({ summary: 'Create task' })
  async create(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateTaskDto,
  ) {
    const data = await this.tasksService.create(
      tenant,
      userId,
      roles ?? [],
      projectId,
      dto,
    );
    return { success: true, data };
  }

  @Put(':taskId')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'edit', 'projects')
  @ApiOperation({ summary: 'Update task' })
  async update(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateTaskDto,
  ) {
    const data = await this.tasksService.update(
      tenant,
      userId,
      roles ?? [],
      projectId,
      taskId,
      dto,
    );
    return { success: true, data };
  }

  @Delete(':taskId')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'edit', 'projects')
  @ApiOperation({ summary: 'Delete task' })
  async delete(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ) {
    const result = await this.tasksService.delete(
      tenant,
      userId,
      roles ?? [],
      projectId,
      taskId,
    );
    return { success: true, ...result };
  }
}
