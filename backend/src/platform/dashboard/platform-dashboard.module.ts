import { Module } from '@nestjs/common';
import { PlatformDashboardController } from './platform-dashboard.controller';
import { PlatformDashboardService } from './platform-dashboard.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PlatformDashboardController],
  providers: [PlatformDashboardService],
  exports: [PlatformDashboardService],
})
export class PlatformDashboardModule {}
