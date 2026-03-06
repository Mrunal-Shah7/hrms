import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantInfo } from '../../tenant/tenant.interface';
import { LogsService } from './logs.service';

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}
function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

@ApiTags('Time Tracker')
@ApiBearerAuth()
@Controller('time-tracker')
@UseGuards(TenantAuthGuard)
export class TimeTrackerLogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get('logs')
  @UseGuards(PermissionGuard)
  @RequirePermission('time_tracker', 'view', 'time_logs')
  async getLogs(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Query('userId') requestedUserId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const result = await this.logsService.getLogs(tenant, userId, roles ?? [], {
      userId: requestedUserId,
      from: from ?? defaultFrom(),
      to: to ?? defaultTo(),
      page: page ?? 1,
      limit: limit ?? 50,
    });
    return { success: true, ...result };
  }

  @Get('daily-summary')
  @UseGuards(PermissionGuard)
  @RequirePermission('time_tracker', 'view', 'time_logs')
  async getDailySummaries(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Query('userId') requestedUserId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const result = await this.logsService.getDailySummaries(tenant, userId, roles ?? [], {
      userId: requestedUserId,
      from: from ?? defaultFrom(),
      to: to ?? defaultTo(),
      page: page ?? 1,
      limit: limit ?? 31,
    });
    return { success: true, ...result };
  }
}
