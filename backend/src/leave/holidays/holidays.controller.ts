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
import { HolidaysService } from './holidays.service';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantInfo } from '../../tenant/tenant.interface';
import { CreateHolidayDto, UpdateHolidayDto, ListHolidaysQueryDto } from './dto';

@ApiTags('Holidays')
@ApiBearerAuth()
@Controller('holidays')
@UseGuards(TenantAuthGuard)
export class HolidaysController {
  constructor(private readonly holidaysService: HolidaysService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'holidays')
  @ApiOperation({ summary: 'List holidays' })
  async list(
    @TenantContext() tenant: TenantInfo,
    @Query() query: ListHolidaysQueryDto,
  ) {
    const result = await this.holidaysService.list(tenant, query);
    return { success: true, ...result };
  }

  @Get('export')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'holidays')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Export holidays' })
  async export(
    @TenantContext() tenant: TenantInfo,
    @Res({ passthrough: false }) res: Response,
    @Query('format') format?: 'csv' | 'xlsx',
    @Query('year') year?: number,
  ) {
    const fmt: 'csv' | 'xlsx' = format === 'xlsx' ? 'xlsx' : 'csv';
    const buffer = await this.holidaysService.export(tenant, fmt, year ? Number(year) : undefined);
    const filename = `holidays_${new Date().toISOString().slice(0, 10)}.${fmt}`;
    const contentType =
      fmt === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    return new StreamableFile(buffer);
  }

  @Get('import/template')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'create', 'holidays')
  @ApiOperation({ summary: 'Download holiday import template' })
  async getImportTemplate(@Res({ passthrough: false }) res: Response) {
    const buffer = this.holidaysService.getImportTemplate();
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="holiday_import_template.csv"',
      'Content-Length': buffer.length,
    });
    return new StreamableFile(buffer);
  }

  @Post('import')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'create', 'holidays')
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
  @ApiOperation({ summary: 'Bulk import holidays from CSV' })
  async import(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @UploadedFile() file: { buffer: Buffer; originalname?: string },
    @Body() body: { dryRun?: string },
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('No file uploaded');
    }
    const dryRun = body?.dryRun === 'true';
    const data = await this.holidaysService.import(tenant, userId, file, dryRun);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'create', 'holidays')
  @ApiOperation({ summary: 'Create holiday' })
  @ApiResponse({ status: 201, description: 'Holiday created' })
  @ApiResponse({ status: 409, description: 'A holiday already exists on this date' })
  async create(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateHolidayDto,
  ) {
    const data = await this.holidaysService.create(tenant, userId, dto);
    return { success: true, data };
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'holidays')
  @ApiOperation({ summary: 'Get holiday detail' })
  async findOne(
    @TenantContext() tenant: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.holidaysService.findOne(tenant, id);
    return { success: true, data };
  }

  @Put(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'edit', 'holidays')
  @ApiOperation({ summary: 'Update holiday' })
  async update(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHolidayDto,
  ) {
    const data = await this.holidaysService.update(tenant, userId, id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'delete', 'holidays')
  @ApiOperation({ summary: 'Delete holiday' })
  async delete(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.holidaysService.delete(tenant, userId, id);
    return { success: true, ...result };
  }
}
