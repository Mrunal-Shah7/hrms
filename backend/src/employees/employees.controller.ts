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
import { EmployeesService } from './employees.service';
import { ImportService } from './import/import.service';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { SeatLimitGuard } from '../common/guards/seat-limit.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CheckSeatLimit } from '../common/decorators/check-seat-limit.decorator';
import { TenantContext } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TenantInfo } from '../tenant/tenant.interface';
import { CreateEmployeeDto, UpdateEmployeeDto, ListEmployeesQueryDto } from './dto';

@ApiTags('Employees')
@ApiBearerAuth()
@Controller('employees')
@UseGuards(TenantAuthGuard)
export class EmployeesController {
  constructor(
    private readonly employeesService: EmployeesService,
    private readonly importService: ImportService,
  ) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'employees')
  @ApiOperation({ summary: 'List employees' })
  async list(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Query() query: ListEmployeesQueryDto,
  ) {
    const result = await this.employeesService.list(
      tenant,
      userId,
      roles ?? [],
      query,
    );
    return { success: true, ...result };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard, SeatLimitGuard)
  @RequirePermission('employee_management', 'create', 'employees')
  @CheckSeatLimit()
  @ApiOperation({ summary: 'Create employee' })
  @ApiResponse({ status: 201, description: 'Employee created' })
  @ApiResponse({ status: 409, description: 'Email or employee ID already exists' })
  @ApiResponse({ status: 403, description: 'Seat limit reached' })
  async create(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateEmployeeDto,
  ) {
    const data = await this.employeesService.create(tenant, userId, dto);
    return { success: true, data };
  }

  @Get('departments/options')
  @ApiOperation({ summary: 'Get department options for dropdowns' })
  async getDepartmentOptions(@TenantContext() tenant: TenantInfo) {
    const data = await this.employeesService.getDepartmentOptions(tenant);
    return { success: true, data };
  }

  @Get('designations/options')
  @ApiOperation({ summary: 'Get designation options for dropdowns' })
  async getDesignationOptions(@TenantContext() tenant: TenantInfo) {
    const data = await this.employeesService.getDesignationOptions(tenant);
    return { success: true, data };
  }

  @Get('lookup')
  @ApiOperation({ summary: 'Lightweight employee search for select fields' })
  async lookup(
    @TenantContext() tenant: TenantInfo,
    @Query('search') search: string,
    @Query('limit') limit?: number,
    @Query('excludeId') excludeId?: string,
  ) {
    const data = await this.employeesService.lookup(
      tenant,
      search ?? '',
      limit ? Number(limit) : 10,
      excludeId,
    );
    return { success: true, data };
  }

  @Get('org-chart')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'employees')
  @ApiOperation({ summary: 'Get full org chart' })
  async getOrgChart(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    const data = await this.employeesService.getOrgChart(
      tenant,
      userId,
      roles ?? [],
    );
    return { success: true, data };
  }

  @Get('org-chart/:id')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'employees')
  @ApiOperation({ summary: 'Get org chart subtree from employee' })
  async getOrgChartSubtree(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.employeesService.getOrgChart(
      tenant,
      userId,
      roles ?? [],
      id,
    );
    return { success: true, data };
  }

  @Get('export')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'export', 'employees')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Export employees' })
  async export(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Query() query: ListEmployeesQueryDto & { format: 'csv' | 'xlsx' | 'pdf' },
    @Res({ passthrough: false }) res: Response,
  ) {
    const format = query.format ?? 'csv';
    if (!['csv', 'xlsx', 'pdf'].includes(format)) {
      throw new Error('Invalid format');
    }
    const buffer = await this.employeesService.export(
      tenant,
      userId,
      roles ?? [],
      format,
      query,
    );
    const filename = `employees_${new Date().toISOString().slice(0, 10)}.${format}`;
    const contentType =
      format === 'csv'
        ? 'text/csv'
        : format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/pdf';
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.send(buffer);
  }

  @Get('import/template')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'import', 'employees')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Download employee import template' })
  async getImportTemplate(@Res({ passthrough: false }) res: Response) {
    const buffer = this.importService.getTemplateCsv();
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="employee_import_template.csv"',
      'Content-Length': buffer.length,
    });
    return new StreamableFile(buffer);
  }

  @Post('import')
  @UseGuards(PermissionGuard, SeatLimitGuard)
  @RequirePermission('employee_management', 'import', 'employees')
  @CheckSeatLimit()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
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
  @ApiOperation({ summary: 'Import employees from CSV' })
  async importEmployees(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @UploadedFile() file: { buffer: Buffer; originalname?: string; size?: number },
    @Body() body: { sendWelcomeEmails?: string; dryRun?: string },
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('No file uploaded');
    }
    const sendWelcomeEmails = body?.sendWelcomeEmails !== 'false';
    const dryRun = body?.dryRun === 'true';
    const result = await this.importService.importEmployees(
      tenant,
      userId,
      file,
      sendWelcomeEmails,
      dryRun,
    );
    return { success: true, data: result };
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'employees')
  @ApiOperation({ summary: 'Get employee detail' })
  async findOne(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.employeesService.findOne(
      tenant,
      userId,
      roles ?? [],
      id,
    );
    return { success: true, data };
  }

  @Get(':id/reportees')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'employees')
  @ApiOperation({ summary: 'Get direct reportees' })
  async getReportees(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.employeesService.getReportees(
      tenant,
      userId,
      roles ?? [],
      id,
    );
    return { success: true, data };
  }

  @Get(':id/timeline')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'employees')
  @ApiOperation({ summary: 'Get employee audit timeline' })
  async getTimeline(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('permissions') permissions: string[],
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.employeesService.getTimeline(
      tenant,
      userId,
      permissions ?? [],
      id,
    );
    return { success: true, ...result };
  }

  @Put(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'edit', 'employees')
  @ApiOperation({ summary: 'Update employee' })
  async update(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    const data = await this.employeesService.update(tenant, userId, id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'delete', 'employees')
  @ApiOperation({ summary: 'Archive employee (soft delete)' })
  async archive(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.employeesService.archive(tenant, userId, id);
    return { success: true, data };
  }
}
