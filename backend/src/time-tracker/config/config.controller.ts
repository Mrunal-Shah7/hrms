import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ParseUUIDPipe } from '@nestjs/common/pipes';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantInfo } from '../../tenant/tenant.interface';
import { TimeTrackerConfigService } from './config.service';
import { CreateTimeTrackerConfigDto, UpdateTimeTrackerConfigDto } from './dto';

@ApiTags('Time Tracker')
@ApiBearerAuth()
@Controller('time-tracker/config')
@UseGuards(TenantAuthGuard)
export class TimeTrackerConfigController {
  constructor(private readonly configService: TimeTrackerConfigService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('time_tracker', 'view', 'config')
  async list(@TenantContext() tenant: TenantInfo) {
    const data = await this.configService.list(tenant);
    return { success: true, data };
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('time_tracker', 'view', 'config')
  async getById(
    @TenantContext() tenant: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.configService.getById(tenant, id);
    if (!data) throw new NotFoundException('Integration not found');
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('time_tracker', 'create', 'config')
  async create(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateTimeTrackerConfigDto,
  ) {
    const data = await this.configService.create(tenant, userId, dto);
    return { success: true, data };
  }

  @Put(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('time_tracker', 'edit', 'config')
  async update(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTimeTrackerConfigDto,
  ) {
    const data = await this.configService.update(tenant, userId, id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('time_tracker', 'delete', 'config')
  async delete(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.configService.delete(tenant, userId, id);
    return { success: true, message: result.message };
  }

  @Post(':id/test')
  @UseGuards(PermissionGuard)
  @RequirePermission('time_tracker', 'execute', 'sync')
  async testConnection(
    @TenantContext() tenant: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.configService.testConnection(tenant, id);
    return { success: result.success, message: result.message };
  }
}
