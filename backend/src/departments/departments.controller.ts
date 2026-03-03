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
import { DepartmentsService } from './departments.service';
import { DepartmentImportService } from './import/department-import.service';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { TenantContext } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TenantInfo } from '../tenant/tenant.interface';
import { CreateDepartmentDto, UpdateDepartmentDto, ListDepartmentsQueryDto } from './dto';

@ApiTags('Departments')
@ApiBearerAuth()
@Controller('departments')
@UseGuards(TenantAuthGuard)
export class DepartmentsController {
  constructor(
    private readonly departmentsService: DepartmentsService,
    private readonly departmentImportService: DepartmentImportService,
  ) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'departments')
  @ApiOperation({ summary: 'List all departments' })
  async list(
    @TenantContext() tenant: TenantInfo,
    @Query() query: ListDepartmentsQueryDto,
  ) {
    const result = await this.departmentsService.list(tenant, query);
    return { success: true, ...result };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'create', 'departments')
  @ApiOperation({ summary: 'Create department' })
  @ApiResponse({ status: 201, description: 'Department created' })
  @ApiResponse({ status: 409, description: 'Department code or name already exists' })
  async create(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateDepartmentDto,
  ) {
    const data = await this.departmentsService.create(tenant, userId, dto);
    return { success: true, data };
  }

  @Get('tree')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'departments')
  @ApiOperation({ summary: 'Get department hierarchy tree' })
  async getTree(@TenantContext() tenant: TenantInfo) {
    const data = await this.departmentsService.getTree(tenant);
    return { success: true, data };
  }

  @Get('export')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'departments')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Export departments' })
  async export(
    @TenantContext() tenant: TenantInfo,
    @Query('format') format: 'csv' | 'xlsx' = 'csv',
    @Res({ passthrough: false }) res: Response,
  ) {
    if (!['csv', 'xlsx'].includes(format)) {
      format = 'csv';
    }
    const buffer = await this.departmentsService.export(tenant, format);
    const filename = `departments_${new Date().toISOString().slice(0, 10)}.${format}`;
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
  @RequirePermission('employee_management', 'create', 'departments')
  @ApiOperation({ summary: 'Download department import template' })
  async getImportTemplate(@Res({ passthrough: false }) res: Response) {
    const buffer = this.departmentImportService.getTemplate();
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="department_import_template.csv"',
      'Content-Length': buffer.length,
    });
    return new StreamableFile(buffer);
  }

  @Post('import')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'create', 'departments')
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
  @ApiOperation({ summary: 'Import departments from CSV' })
  async importDepartments(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @UploadedFile() file: { buffer: Buffer; originalname?: string; size?: number },
    @Body() body: { dryRun?: string },
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('No file uploaded');
    }
    const dryRun = body?.dryRun === 'true';
    const result = await this.departmentImportService.import(tenant, userId, file, dryRun);
    return { success: true, data: result };
  }

  @Get(':id/members')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'departments')
  @ApiOperation({ summary: 'Get department members' })
  async getMembers(
    @TenantContext() tenant: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    const result = await this.departmentsService.getMembers(tenant, id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search,
      sortBy,
      sortOrder,
    });
    return { success: true, ...result };
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'departments')
  @ApiOperation({ summary: 'Get department detail' })
  async findOne(
    @TenantContext() tenant: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.departmentsService.findOne(tenant, id);
    return { success: true, data };
  }

  @Put(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'edit', 'departments')
  @ApiOperation({ summary: 'Update department' })
  async update(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    const data = await this.departmentsService.update(tenant, userId, id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'delete', 'departments')
  @ApiOperation({ summary: 'Delete department' })
  @ApiResponse({ status: 400, description: 'Cannot delete department with employees or sub-departments' })
  async delete(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.departmentsService.delete(tenant, userId, id);
    return { success: true, ...result };
  }
}
