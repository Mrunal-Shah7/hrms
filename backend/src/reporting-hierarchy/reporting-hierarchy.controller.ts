import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ParseUUIDPipe } from '@nestjs/common/pipes';
import { ReportingHierarchyService } from './reporting-hierarchy.service';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { TenantContext } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TenantInfo } from '../tenant/tenant.interface';
import { UpdateHierarchyDto } from './dto';

@ApiTags('Reporting Hierarchy')
@ApiBearerAuth()
@Controller('reporting-hierarchy')
@UseGuards(TenantAuthGuard)
export class ReportingHierarchyController {
  constructor(private readonly reportingHierarchyService: ReportingHierarchyService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'view', 'reporting_hierarchy')
  @ApiOperation({ summary: 'Get full hierarchy' })
  async getHierarchy(@TenantContext() tenant: TenantInfo) {
    const data = await this.reportingHierarchyService.getHierarchy(tenant);
    return { success: true, data };
  }

  @Put()
  @UseGuards(PermissionGuard)
  @RequirePermission('employee_management', 'edit', 'reporting_hierarchy')
  @ApiOperation({ summary: 'Update full hierarchy (bulk replace)' })
  async updateHierarchy(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateHierarchyDto,
  ) {
    const data = await this.reportingHierarchyService.updateHierarchy(
      tenant,
      userId,
      dto.entries,
    );
    return { success: true, data };
  }

  @Get('suggestions/:designationId')
  @ApiOperation({ summary: 'Get suggested managers for a designation' })
  async getSuggestions(
    @TenantContext() tenant: TenantInfo,
    @Param('designationId', ParseUUIDPipe) designationId: string,
  ) {
    const data = await this.reportingHierarchyService.getSuggestions(
      tenant,
      designationId,
    );
    return { success: true, data };
  }
}
