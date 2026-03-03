import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RbacService } from './rbac.service';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { TenantContext } from '../common/decorators/tenant.decorator';
import type { TenantInfo } from '../tenant/tenant.interface';

@ApiTags('RBAC')
@ApiBearerAuth()
@Controller('permissions')
@UseGuards(TenantAuthGuard, PermissionGuard)
@RequirePermission('settings', 'view', 'rbac')
export class PermissionsController {
  constructor(private readonly rbacService: RbacService) {}

  @Get()
  @ApiOperation({ summary: 'List all permissions grouped by module' })
  async listPermissionsGrouped(@TenantContext() tenant: TenantInfo) {
    const data = await this.rbacService.listPermissionsGrouped(tenant);
    return { success: true, data };
  }
}
