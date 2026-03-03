import { Module } from '@nestjs/common';
import { DesignationsController } from './designations.controller';
import { DesignationsService } from './designations.service';
import { DesignationImportService } from './import/designation-import.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ExportService } from '../core/export/export.service';

@Module({
  imports: [PrismaModule],
  controllers: [DesignationsController],
  providers: [DesignationsService, DesignationImportService, ExportService],
  exports: [DesignationsService],
})
export class DesignationsModule {}
