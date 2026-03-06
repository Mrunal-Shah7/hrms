import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ParseUUIDPipe } from '@nestjs/common/pipes';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantInfo } from '../../tenant/tenant.interface';
import { WorkScheduleService } from './work-schedule.service';
import { CreateWorkScheduleDto } from './dto/create-work-schedule.dto';
import { UpdateWorkScheduleDto } from './dto/update-work-schedule.dto';

@ApiTags('Attendance - Work Schedule')
@ApiBearerAuth()
@Controller('attendance/work-schedule')
@UseGuards(TenantAuthGuard)
export class WorkScheduleController {
  constructor(private readonly workScheduleService: WorkScheduleService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('attendance', 'view', 'work_schedule')
  @ApiOperation({ summary: 'List work schedules' })
  async list(@TenantContext() tenant: TenantInfo) {
    const data = await this.workScheduleService.list(tenant);
    return { success: true, data };
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('attendance', 'view', 'work_schedule')
  @ApiOperation({ summary: 'Get work schedule by id' })
  async getById(@TenantContext() tenant: TenantInfo, @Param('id', ParseUUIDPipe) id: string) {
    const data = await this.workScheduleService.getById(tenant, id);
    if (!data) throw new NotFoundException('Work schedule not found');
    return { success: true, data };
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission('attendance', 'create', 'work_schedule')
  @ApiOperation({ summary: 'Create work schedule' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 409, description: 'Name already exists' })
  async create(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateWorkScheduleDto,
  ) {
    const data = await this.workScheduleService.create(tenant, userId, dto);
    return { success: true, data };
  }

  @Put(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('attendance', 'edit', 'work_schedule')
  @ApiOperation({ summary: 'Update work schedule' })
  async update(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkScheduleDto,
  ) {
    const data = await this.workScheduleService.update(tenant, userId, id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('attendance', 'delete', 'work_schedule')
  @ApiOperation({ summary: 'Delete work schedule' })
  @ApiResponse({ status: 400, description: 'Cannot delete default schedule' })
  async delete(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.workScheduleService.delete(tenant, userId, id);
    return { success: true, ...result };
  }
}
