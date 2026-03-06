import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { TimeTrackerConfigController } from './config/config.controller';
import { TimeTrackerConfigService } from './config/config.service';
import { TimeTrackerLogsController } from './logs/logs.controller';
import { LogsService } from './logs/logs.service';
import { SummaryService } from './summary/summary.service';
import { SyncController } from './sync/sync.controller';
import { SyncCronService } from './sync/sync.cron';
import { SyncService } from './sync/sync.service';

@Module({
  imports: [PrismaModule, forwardRef(() => AttendanceModule)],
  controllers: [TimeTrackerConfigController, SyncController, TimeTrackerLogsController],
  providers: [TimeTrackerConfigService, LogsService, SummaryService, SyncService, SyncCronService],
  exports: [TimeTrackerConfigService, LogsService, SyncService, SummaryService],
})
export class TimeTrackerModule {}
