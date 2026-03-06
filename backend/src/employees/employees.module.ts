import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { ImportService } from './import/import.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LeaveModule } from '../leave/leave.module';
import { EmailService } from '../core/email/email.service';
import { PlatformEmailService } from '../core/email/platform-email.service';
import { NotificationService } from '../core/notification/notification.service';
import { ExportService } from '../core/export/export.service';

@Module({
  imports: [PrismaModule, LeaveModule],
  controllers: [EmployeesController],
  providers: [
    EmployeesService,
    ImportService,
    PlatformEmailService,
    EmailService,
    NotificationService,
    ExportService,
  ],
  exports: [EmployeesService],
})
export class EmployeesModule {}
