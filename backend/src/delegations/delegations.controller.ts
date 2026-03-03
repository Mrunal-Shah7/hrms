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
import { DelegationsService } from './delegations.service';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { TenantContext } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TenantInfo } from '../tenant/tenant.interface';
import {
  CreateDelegationDto,
  UpdateDelegationDto,
  ListDelegationsQueryDto,
} from './dto';

@ApiTags('Delegations')
@ApiBearerAuth()
@Controller('delegations')
@UseGuards(TenantAuthGuard)
export class DelegationsController {
  constructor(private readonly delegationsService: DelegationsService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'delegations')
  @ApiOperation({ summary: 'List delegations' })
  async list(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Query() query: ListDelegationsQueryDto,
  ) {
    const result = await this.delegationsService.list(
      tenant,
      userId,
      roles ?? [],
      query,
    );
    return { success: true, ...result };
  }

  @Get('export')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'delegations')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Export delegations' })
  async export(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Query() query: ListDelegationsQueryDto & { format?: 'csv' | 'xlsx' | 'pdf' },
    @Res({ passthrough: false }) res: Response,
  ) {
    const format = ['csv', 'xlsx', 'pdf'].includes(query.format ?? '') ? query.format : 'csv';
    const buffer = await this.delegationsService.export(tenant, userId, roles ?? [], query, format ?? 'csv');
    const filename = `delegations_${new Date().toISOString().slice(0, 10)}.${format}`;
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
  @RequirePermission('employee_management', 'create', 'delegations')
  @ApiOperation({ summary: 'Create delegation' })
  async create(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Body() dto: CreateDelegationDto,
  ) {
    const data = await this.delegationsService.create(
      tenant,
      userId,
      roles ?? [],
      dto,
    );
    return { success: true, data };
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'delegations')
  @ApiOperation({ summary: 'Get delegation detail' })
  async findOne(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.delegationsService.findOne(
      tenant,
      userId,
      roles ?? [],
      id,
    );
    return { success: true, data };
  }

  @Put(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'edit', 'delegations')
  @ApiOperation({ summary: 'Update delegation' })
  async update(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDelegationDto,
  ) {
    const data = await this.delegationsService.update(
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
  @RequirePermission('employee_management', 'delete', 'delegations')
  @ApiOperation({ summary: 'Delete delegation' })
  async delete(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.delegationsService.delete(
      tenant,
      userId,
      roles ?? [],
      id,
    );
    return { success: true, ...result };
  }
}
