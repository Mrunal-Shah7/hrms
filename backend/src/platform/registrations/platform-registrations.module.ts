import { Module } from '@nestjs/common';
import { PlatformRegistrationsController } from './platform-registrations.controller';
import { PlatformRegistrationsService } from './platform-registrations.service';
import { TenantModule } from '../../tenant/tenant.module';
import { PlatformEmailService } from '../../core/email/platform-email.service';

@Module({
  imports: [TenantModule],
  controllers: [PlatformRegistrationsController],
  providers: [PlatformRegistrationsService, PlatformEmailService],
  exports: [PlatformRegistrationsService],
})
export class PlatformRegistrationsModule {}
