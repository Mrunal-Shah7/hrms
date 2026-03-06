import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LeaveSummaryService } from './leave-summary.service';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantInfo } from '../../tenant/tenant.interface';

@ApiTags('Leave Summary')
@ApiBearerAuth()
@Controller('leave/summary')
@UseGuards(TenantAuthGuard)
export class LeaveSummaryController {
  constructor(private readonly leaveSummaryService: LeaveSummaryService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'leave_requests')
  @ApiOperation({ summary: 'Get leave summary' })
  async getSummary(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Query('year') year?: number,
    @Query('userId') targetUserId?: string,
  ) {
    const y = year ? Number(year) : undefined;
    const data = await this.leaveSummaryService.getSummary(tenant, userId, roles ?? [], y, targetUserId);
    return { success: true, data };
  }
}

@ApiTags('Leave Balance')
@ApiBearerAuth()
@Controller('leave/balance')
@UseGuards(TenantAuthGuard)
export class LeaveBalanceController {
  constructor(private readonly leaveSummaryService: LeaveSummaryService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'leave_requests')
  @ApiOperation({ summary: 'Get leave balance per type' })
  async getBalance(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Query('year') year?: number,
    @Query('userId') targetUserId?: string,
  ) {
    const y = year ? Number(year) : undefined;
    const data = await this.leaveSummaryService.getBalance(tenant, userId, y, targetUserId);
    return { success: true, data };
  }
}
