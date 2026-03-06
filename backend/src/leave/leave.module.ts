import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ExportService } from '../core/export/export.service';
import { NotificationService } from '../core/notification/notification.service';
import { EmailService } from '../core/email/email.service';
import { PlatformEmailService } from '../core/email/platform-email.service';
import { LeaveTypesController } from './types/leave-types.controller';
import { LeaveTypesService } from './types/leave-types.service';
import { LeavePoliciesController } from './policies/leave-policies.controller';
import { LeavePoliciesService } from './policies/leave-policies.service';
import { HolidaysController } from './holidays/holidays.controller';
import { HolidaysService } from './holidays/holidays.service';
import { BalanceEngineController } from './balances/balance-engine.controller';
import { BalanceEngineService } from './balances/balance-engine.service';
import { BalanceImportController } from './balances/balance-import.controller';
import { BalanceImportService } from './balances/balance-import.service';
import { LeaveAccrualCronService } from './leave-accrual-cron.service';
import { LeaveRequestsController } from './requests/leave-requests.controller';
import { LeaveRequestsService } from './requests/leave-requests.service';
import { LeaveSummaryController, LeaveBalanceController } from './summary/leave-summary.controller';
import { LeaveSummaryService } from './summary/leave-summary.service';
import { LeaveTeamController, LeaveReporteesController } from './team/leave-team.controller';
import { LeaveTeamService } from './team/leave-team.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    LeaveTypesController,
    LeavePoliciesController,
    HolidaysController,
    BalanceEngineController,
    BalanceImportController,
    LeaveRequestsController,
    LeaveSummaryController,
    LeaveBalanceController,
    LeaveTeamController,
    LeaveReporteesController,
  ],
  providers: [
    LeaveTypesService,
    LeavePoliciesService,
    HolidaysService,
    BalanceEngineService,
    BalanceImportService,
    ExportService,
    NotificationService,
    PlatformEmailService,
    EmailService,
    LeaveAccrualCronService,
    LeaveRequestsService,
    LeaveSummaryService,
    LeaveTeamService,
  ],
  exports: [BalanceEngineService],
})
export class LeaveModule {}
