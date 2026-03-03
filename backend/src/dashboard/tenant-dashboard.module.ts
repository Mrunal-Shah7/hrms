import { Module } from '@nestjs/common';
import { TenantDashboardController } from './tenant-dashboard.controller';
import { SubscriptionController } from './subscription.controller';
import { TenantDashboardService } from './tenant-dashboard.service';

@Module({
  controllers: [TenantDashboardController, SubscriptionController],
  providers: [TenantDashboardService],
  exports: [TenantDashboardService],
})
export class TenantDashboardModule {}
