import { Controller, Get, Post, UseGuards, Res, UseInterceptors, UploadedFile, BadRequestException, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { StreamableFile } from '@nestjs/common';
import { BalanceImportService } from './balance-import.service';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantInfo } from '../../tenant/tenant.interface';

@ApiTags('Leave Balance Import')
@ApiBearerAuth()
@Controller('leave/balances/import')
@UseGuards(TenantAuthGuard)
export class BalanceImportController {
  constructor(private readonly balanceImportService: BalanceImportService) {}

  @Get('template')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'create', 'leave_policies')
  @ApiOperation({ summary: 'Download balance import template' })
  async getTemplate(@Res({ passthrough: false }) res: Response) {
    const buffer = this.balanceImportService.getTemplateCsv();
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="leave_balance_import_template.csv"',
      'Content-Length': buffer.length,
    });
    return new StreamableFile(buffer);
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'create', 'leave_policies')
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
  @ApiOperation({ summary: 'Bulk import leave balances' })
  async import(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @UploadedFile() file: { buffer: Buffer },
    @Body() body: { dryRun?: string },
  ) {
    if (!file?.buffer) throw new BadRequestException('No file uploaded');
    const dryRun = body?.dryRun === 'true';
    const data = await this.balanceImportService.import(tenant, userId, file, dryRun);
    return { success: true, data };
  }
}
