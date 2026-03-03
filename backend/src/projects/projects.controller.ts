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
import { ProjectsService } from './projects.service';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { TenantContext } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TenantInfo } from '../tenant/tenant.interface';
import {
  CreateProjectDto,
  UpdateProjectDto,
  ListProjectsQueryDto,
  AddProjectMembersDto,
  RemoveProjectMembersDto,
} from './dto';

@ApiTags('Projects')
@ApiBearerAuth()
@Controller('projects')
@UseGuards(TenantAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'projects')
  @ApiOperation({ summary: 'List all projects' })
  async list(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Query() query: ListProjectsQueryDto,
  ) {
    const result = await this.projectsService.list(
      tenant,
      userId,
      roles ?? [],
      query,
    );
    return { success: true, ...result };
  }

  @Get('export')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'projects')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Export projects' })
  async export(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Query() query: ListProjectsQueryDto & { format?: 'csv' | 'xlsx' | 'pdf' },
    @Res({ passthrough: false }) res: Response,
  ) {
    const format = ['csv', 'xlsx', 'pdf'].includes(query.format ?? '') ? query.format : 'csv';
    const buffer = await this.projectsService.export(tenant, userId, roles ?? [], query, format ?? 'csv');
    const filename = `projects_${new Date().toISOString().slice(0, 10)}.${format}`;
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
  @RequirePermission('employee_management', 'create', 'projects')
  @ApiOperation({ summary: 'Create project' })
  async create(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Body() dto: CreateProjectDto,
  ) {
    const data = await this.projectsService.create(
      tenant,
      userId,
      roles ?? [],
      dto,
    );
    return { success: true, data };
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'projects')
  @ApiOperation({ summary: 'Get project detail' })
  async findOne(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.projectsService.findOne(
      tenant,
      userId,
      roles ?? [],
      id,
    );
    return { success: true, data };
  }

  @Put(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'edit', 'projects')
  @ApiOperation({ summary: 'Update project' })
  async update(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    const data = await this.projectsService.update(
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
  @RequirePermission('employee_management', 'delete', 'projects')
  @ApiOperation({ summary: 'Delete project' })
  async delete(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.projectsService.delete(
      tenant,
      userId,
      roles ?? [],
      id,
    );
    return { success: true, ...result };
  }

  @Post(':id/members')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'edit', 'projects')
  @ApiOperation({ summary: 'Add project members' })
  async addMembers(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddProjectMembersDto,
  ) {
    const data = await this.projectsService.addMembers(
      tenant,
      userId,
      roles ?? [],
      id,
      dto.members,
    );
    return { success: true, data };
  }

  @Delete(':id/members')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'edit', 'projects')
  @ApiOperation({ summary: 'Remove project members' })
  async removeMembers(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemoveProjectMembersDto,
  ) {
    const data = await this.projectsService.removeMembers(
      tenant,
      userId,
      roles ?? [],
      id,
      dto.userIds,
    );
    return { success: true, data };
  }
}
