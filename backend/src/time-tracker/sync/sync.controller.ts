import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantInfo } from '../../tenant/tenant.interface';
import { SyncService } from './sync.service';
import { ManualSyncDto } from './sync.dto';

@ApiTags('Time Tracker')
@ApiBearerAuth()
@Controller('time-tracker')
@UseGuards(TenantAuthGuard)
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('sync')
  @UseGuards(PermissionGuard)
  @RequirePermission('time_tracker', 'execute', 'sync')
  @Throttle({ default: { limit: 2, ttl: 60000 } })
  async manualSync(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: ManualSyncDto,
  ) {
    const since = dto.since ? new Date(dto.since) : undefined;
    const result = await this.syncService.sync(tenant, dto.configId, since, userId);
    return { success: true, data: result };
  }
}
