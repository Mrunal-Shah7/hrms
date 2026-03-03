import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PlatformAuthGuard } from '../platform-auth/guards/platform-auth.guard';
import { PlatformDashboardService } from './platform-dashboard.service';

@ApiTags('Platform')
@Controller('platform/dashboard')
@UseGuards(PlatformAuthGuard)
@ApiBearerAuth()
export class PlatformDashboardController {
  constructor(private readonly dashboardService: PlatformDashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Get platform dashboard stats' })
  @ApiResponse({ status: 200, description: 'Dashboard stats with all 7 widgets' })
  async getStats() {
    const data = await this.dashboardService.getStats();
    return { success: true, data };
  }
}
