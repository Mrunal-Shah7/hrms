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
import { GroupsService } from './groups.service';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { TenantContext } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TenantInfo } from '../tenant/tenant.interface';
import { CreateGroupDto, UpdateGroupDto, AddMembersDto, RemoveMembersDto, ListGroupsQueryDto } from './dto';

@ApiTags('Groups')
@ApiBearerAuth()
@Controller('groups')
@UseGuards(TenantAuthGuard)
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'groups')
  @ApiOperation({ summary: 'List all groups' })
  async list(
    @TenantContext() tenant: TenantInfo,
    @Query() query: ListGroupsQueryDto,
  ) {
    const result = await this.groupsService.list(tenant, query);
    return { success: true, ...result };
  }

  @Get('export')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'groups')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Export groups' })
  async export(
    @TenantContext() tenant: TenantInfo,
    @Query() query: ListGroupsQueryDto & { format?: 'csv' | 'xlsx' | 'pdf' },
    @Res({ passthrough: false }) res: Response,
  ) {
    const format = ['csv', 'xlsx', 'pdf'].includes(query.format ?? '') ? query.format : 'csv';
    const buffer = await this.groupsService.export(tenant, query, format ?? 'csv');
    const filename = `groups_${new Date().toISOString().slice(0, 10)}.${format}`;
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
  @RequirePermission('employee_management', 'create', 'groups')
  @ApiOperation({ summary: 'Create group' })
  async create(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateGroupDto,
  ) {
    const data = await this.groupsService.create(tenant, userId, dto);
    return { success: true, data };
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'groups')
  @ApiOperation({ summary: 'Get group detail' })
  async findOne(
    @TenantContext() tenant: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.groupsService.findOne(tenant, id);
    return { success: true, data };
  }

  @Put(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'edit', 'groups')
  @ApiOperation({ summary: 'Update group' })
  async update(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGroupDto,
  ) {
    const data = await this.groupsService.update(tenant, userId, id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'delete', 'groups')
  @ApiOperation({ summary: 'Delete group' })
  async delete(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.groupsService.delete(tenant, userId, id);
    return { success: true, ...result };
  }

  @Post(':id/members')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'edit', 'groups')
  @ApiOperation({ summary: 'Add members to group' })
  async addMembers(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMembersDto,
  ) {
    const result = await this.groupsService.addMembers(
      tenant,
      userId,
      id,
      dto.userIds,
    );
    return { success: true, ...result };
  }

  @Delete(':id/members')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'edit', 'groups')
  @ApiOperation({ summary: 'Remove members from group' })
  async removeMembers(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemoveMembersDto,
  ) {
    const result = await this.groupsService.removeMembers(
      tenant,
      userId,
      id,
      dto.userIds,
    );
    return { success: true, ...result };
  }
}
