import { Module } from '@nestjs/common';
import { PlatformTenantsController } from './platform-tenants.controller';
import { PlatformTenantsService } from './platform-tenants.service';
import { TenantModule } from '../../tenant/tenant.module';
import { PlatformEmailService } from '../../core/email/platform-email.service';

@Module({
  imports: [TenantModule],
  controllers: [PlatformTenantsController],
  providers: [PlatformTenantsService, PlatformEmailService],
  exports: [PlatformTenantsService],
})
export class PlatformTenantsModule {}
