import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TasksController } from './tasks/tasks.controller';
import { TasksService } from './tasks/tasks.service';
import { NotificationService } from '../core/notification/notification.service';
import { EmailService } from '../core/email/email.service';
import { PlatformEmailService } from '../core/email/platform-email.service';
import { ExportService } from '../core/export/export.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProjectsController, TasksController],
  providers: [
    ProjectsService,
    TasksService,
    ExportService,
    PlatformEmailService,
    EmailService,
    NotificationService,
  ],
  exports: [ProjectsService, TasksService],
})
export class ProjectsModule {}
