import { Module } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { TenantProvisioningService } from './tenant-provisioning.service';

@Module({
  providers: [TenantService, TenantProvisioningService],
  exports: [TenantService, TenantProvisioningService],
})
export class TenantModule {}
