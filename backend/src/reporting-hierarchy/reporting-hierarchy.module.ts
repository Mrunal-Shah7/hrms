import { Module } from '@nestjs/common';
import { ReportingHierarchyController } from './reporting-hierarchy.controller';
import { ReportingHierarchyService } from './reporting-hierarchy.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ReportingHierarchyController],
  providers: [ReportingHierarchyService],
  exports: [ReportingHierarchyService],
})
export class ReportingHierarchyModule {}
