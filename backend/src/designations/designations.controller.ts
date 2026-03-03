import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ParseUUIDPipe } from '@nestjs/common/pipes';
import { DesignationsService } from './designations.service';
import { DesignationImportService } from './import/designation-import.service';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { TenantContext } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TenantInfo } from '../tenant/tenant.interface';
import { CreateDesignationDto, UpdateDesignationDto, ListDesignationsQueryDto } from './dto';

@ApiTags('Designations')
@ApiBearerAuth()
@Controller('designations')
@UseGuards(TenantAuthGuard)
export class DesignationsController {
  constructor(
    private readonly designationsService: DesignationsService,
    private readonly designationImportService: DesignationImportService,
  ) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'designations')
  @ApiOperation({ summary: 'List all designations' })
  async list(
    @TenantContext() tenant: TenantInfo,
    @Query() query: ListDesignationsQueryDto,
  ) {
    const result = await this.designationsService.list(tenant, query);
    return { success: true, ...result };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'create', 'designations')
  @ApiOperation({ summary: 'Create designation' })
  @ApiResponse({ status: 201, description: 'Designation created' })
  @ApiResponse({ status: 409, description: 'Designation code or name already exists' })
  async create(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateDesignationDto,
  ) {
    const data = await this.designationsService.create(tenant, userId, dto);
    return { success: true, data };
  }

  @Get('export')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'designations')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Export designations' })
  async export(
    @TenantContext() tenant: TenantInfo,
    @Query('format') format: 'csv' | 'xlsx' = 'csv',
    @Res({ passthrough: false }) res: Response,
  ) {
    if (!['csv', 'xlsx'].includes(format)) {
      format = 'csv';
    }
    const buffer = await this.designationsService.export(tenant, format);
    const filename = `designations_${new Date().toISOString().slice(0, 10)}.${format}`;
    const contentType =
      format === 'csv'
        ? 'text/csv'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    return new StreamableFile(buffer);
  }

  @Get('import/template')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'create', 'designations')
  @ApiOperation({ summary: 'Download designation import template' })
  async getImportTemplate(@Res({ passthrough: false }) res: Response) {
    const buffer = this.designationImportService.getTemplate();
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="designation_import_template.csv"',
      'Content-Length': buffer.length,
    });
    return new StreamableFile(buffer);
  }

  @Post('import')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'create', 'designations')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ext = (file.originalname ?? '').toLowerCase();
        if (!ext.endsWith('.csv')) {
          cb(new BadRequestException('File must be a CSV'), false);
        } else {
          cb(null, true);
        }
      },
    }),
  )
  @ApiOperation({ summary: 'Import designations from CSV' })
  async importDesignations(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @UploadedFile() file: { buffer: Buffer; originalname?: string; size?: number },
    @Body() body: { dryRun?: string },
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('No file uploaded');
    }
    const dryRun = body?.dryRun === 'true';
    const result = await this.designationImportService.import(tenant, userId, file, dryRun);
    return { success: true, data: result };
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'designations')
  @ApiOperation({ summary: 'Get designation detail' })
  async findOne(
    @TenantContext() tenant: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.designationsService.findOne(tenant, id);
    return { success: true, data };
  }

  @Put(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'edit', 'designations')
  @ApiOperation({ summary: 'Update designation' })
  async update(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDesignationDto,
  ) {
    const data = await this.designationsService.update(tenant, userId, id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'delete', 'designations')
  @ApiOperation({ summary: 'Delete designation' })
  @ApiResponse({ status: 400, description: 'Cannot delete designation with employees or used in hierarchy' })
  async delete(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.designationsService.delete(tenant, userId, id);
    return { success: true, ...result };
  }
}
