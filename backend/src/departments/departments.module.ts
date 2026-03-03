import { Module } from '@nestjs/common';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import { DepartmentImportService } from './import/department-import.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ExportService } from '../core/export/export.service';

@Module({
  imports: [PrismaModule],
  controllers: [DepartmentsController],
  providers: [DepartmentsService, DepartmentImportService, ExportService],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
