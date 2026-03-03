import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RbacService } from './rbac.service';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { TenantContext } from '../common/decorators/tenant.decorator';
import type { TenantInfo } from '../tenant/tenant.interface';
import { CreateRoleDto, UpdateRoleDto, AssignRolesDto } from './dto';

@ApiTags('RBAC')
@ApiBearerAuth()
@Controller('roles')
@UseGuards(TenantAuthGuard)
export class RolesController {
  constructor(private readonly rbacService: RbacService) {}

  @Get()
  @ApiOperation({ summary: 'List all roles' })
  async listRoles(@TenantContext() tenant: TenantInfo) {
    const data = await this.rbacService.listRoles(tenant);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('settings', 'edit', 'rbac')
  @ApiOperation({ summary: 'Create custom role' })
  @ApiResponse({ status: 201, description: 'Role created' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  async createRole(
    @TenantContext() tenant: TenantInfo,
    @Body() dto: CreateRoleDto,
  ) {
    const data = await this.rbacService.createRole(tenant, dto);
    return { success: true, data };
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequirePermission('settings', 'edit', 'rbac')
  @ApiOperation({ summary: 'Update role' })
  async updateRole(
    @TenantContext() tenant: TenantInfo,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    const data = await this.rbacService.updateRole(tenant, id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequirePermission('settings', 'edit', 'rbac')
  @ApiOperation({ summary: 'Delete custom role' })
  async deleteRole(
    @TenantContext() tenant: TenantInfo,
    @Param('id') id: string,
  ) {
    const data = await this.rbacService.deleteRole(tenant, id);
    return { success: true, data };
  }

  @Get(':id/permissions')
  @UseGuards(PermissionGuard)
  @RequirePermission('settings', 'view', 'rbac')
  @ApiOperation({ summary: 'Get permissions for a role' })
  async getRolePermissions(
    @TenantContext() tenant: TenantInfo,
    @Param('id') id: string,
  ) {
    const data = await this.rbacService.getRolePermissions(tenant, id);
    return { success: true, data };
  }

}
