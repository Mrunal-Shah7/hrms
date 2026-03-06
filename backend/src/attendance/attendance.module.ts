import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ExportService } from '../core/export/export.service';
import { NotificationService } from '../core/notification/notification.service';
import { EmailService } from '../core/email/email.service';
import { PlatformEmailService } from '../core/email/platform-email.service';
import { TimeTrackerModule } from '../time-tracker/time-tracker.module';
import { AttendanceSummaryController } from './summary/attendance-summary.controller';
import { AttendanceSummaryService } from './summary/attendance-summary.service';
import { WorkScheduleController } from './work-schedule/work-schedule.controller';
import { WorkScheduleService } from './work-schedule/work-schedule.service';
import { RegularizationController } from './regularization/regularization.controller';
import { RegularizationService } from './regularization/regularization.service';
import { AttendanceNotificationService } from './attendance-notification.service';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => TimeTrackerModule),
  ],
  controllers: [
    AttendanceSummaryController,
    WorkScheduleController,
    RegularizationController,
  ],
  providers: [
    AttendanceSummaryService,
    WorkScheduleService,
    RegularizationService,
    AttendanceNotificationService,
    ExportService,
    PlatformEmailService,
    EmailService,
    NotificationService,
  ],
  exports: [AttendanceNotificationService],
})
export class AttendanceModule {}
