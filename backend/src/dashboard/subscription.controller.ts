import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { TenantDashboardService } from './tenant-dashboard.service';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Subscription')
@Controller('subscription')
@UseGuards(TenantAuthGuard)
@ApiBearerAuth()
export class SubscriptionController {
  constructor(private readonly dashboard: TenantDashboardService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get lightweight subscription status (Admin only)' })
  @ApiResponse({ status: 200, description: 'Subscription status and warnings for banner' })
  async getStatus(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    const data = await this.dashboard.getSubscriptionStatus(tenantId, roles ?? []);
    return { success: true, data: data ?? {} };
  }
}
