import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { TenantDashboardService } from './tenant-dashboard.service';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { TenantContext } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import * as Tenant from '../tenant/tenant.interface';

@ApiTags('Dashboard')
@Controller('dashboard')
@UseGuards(TenantAuthGuard)
@ApiBearerAuth()
export class TenantDashboardController {
  constructor(private readonly dashboard: TenantDashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Get tenant dashboard data' })
  @ApiResponse({ status: 200, description: 'Dashboard data with subscription widget (Admin) and quick stats' })
  async getDashboard(
    @TenantContext() tenant: Tenant.TenantInfo,
    @CurrentUser('userId') _userId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    const data = await this.dashboard.getDashboardData(
      tenant.id,
      tenant.schemaName,
      roles ?? [],
      _userId,
    );
    return { success: true, data };
  }
}
