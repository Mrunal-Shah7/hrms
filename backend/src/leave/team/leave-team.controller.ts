import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LeaveTeamService } from './leave-team.service';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantInfo } from '../../tenant/tenant.interface';

@ApiTags('Leave Team')
@ApiBearerAuth()
@Controller('leave/team')
@UseGuards(TenantAuthGuard)
export class LeaveTeamController {
  constructor(private readonly leaveTeamService: LeaveTeamService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'leave_requests')
  @ApiOperation({ summary: 'Team on leave today (or by date)' })
  async getTeamOnLeave(
    @TenantContext() tenant: TenantInfo,
    @Query('date') date?: string,
    @Query('departmentId') departmentId?: string,
  ) {
    const data = await this.leaveTeamService.getTeamOnLeave(
      tenant,
      date ?? new Date().toISOString().slice(0, 10),
      departmentId,
    );
    return { success: true, data };
  }
}

@ApiTags('Leave Reportees')
@ApiBearerAuth()
@Controller('leave/reportees')
@UseGuards(TenantAuthGuard)
export class LeaveReporteesController {
  constructor(private readonly leaveTeamService: LeaveTeamService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'leave_requests')
  @ApiOperation({ summary: "Manager's reportees on leave" })
  async getReporteesOnLeave(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Query('date') date?: string,
  ) {
    const data = await this.leaveTeamService.getReporteesOnLeave(
      tenant,
      userId,
      date ?? new Date().toISOString().slice(0, 10),
    );
    return { success: true, data };
  }
}
