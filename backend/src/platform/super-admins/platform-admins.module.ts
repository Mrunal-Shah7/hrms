import { Module } from '@nestjs/common';
import { PlatformAdminsController } from './platform-admins.controller';
import { PlatformAdminsService } from './platform-admins.service';
import { PlatformEmailService } from '../../core/email/platform-email.service';

@Module({
  controllers: [PlatformAdminsController],
  providers: [PlatformAdminsService, PlatformEmailService],
  exports: [PlatformAdminsService],
})
export class PlatformAdminsModule {}
