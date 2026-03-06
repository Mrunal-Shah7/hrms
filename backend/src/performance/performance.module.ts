import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ExportService } from '../core/export/export.service';
import { NotificationService } from '../core/notification/notification.service';
import { EmailService } from '../core/email/email.service';
import { PlatformEmailService } from '../core/email/platform-email.service';
import { GoalsController } from './goals/goals.controller';
import { GoalsService } from './goals/goals.service';
import { ReviewCyclesController } from './reviews/review-cycles.controller';
import { ReviewCyclesService } from './reviews/review-cycles.service';
import { ReviewsController } from './reviews/reviews.controller';
import { ReviewsService } from './reviews/reviews.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    GoalsController,
    ReviewCyclesController,
    ReviewsController,
  ],
  providers: [
    GoalsService,
    ReviewCyclesService,
    ReviewsService,
    ExportService,
    PlatformEmailService,
    EmailService,
    NotificationService,
  ],
  exports: [GoalsService, ReviewCyclesService, ReviewsService],
})
export class PerformanceModule {}
