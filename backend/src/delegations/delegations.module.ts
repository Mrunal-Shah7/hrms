import { Module } from '@nestjs/common';
import { DelegationsController } from './delegations.controller';
import { DelegationsService } from './delegations.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationService } from '../core/notification/notification.service';
import { EmailService } from '../core/email/email.service';
import { PlatformEmailService } from '../core/email/platform-email.service';
import { ExportService } from '../core/export/export.service';

@Module({
  imports: [PrismaModule],
  controllers: [DelegationsController],
  providers: [
    DelegationsService,
    ExportService,
    PlatformEmailService,
    EmailService,
    NotificationService,
  ],
  exports: [DelegationsService],
})
export class DelegationsModule {}
