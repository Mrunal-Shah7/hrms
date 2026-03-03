import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RbacService } from './rbac.service';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { TenantContext } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TenantInfo } from '../tenant/tenant.interface';
import { AssignRolesDto } from './dto';

@ApiTags('RBAC')
@ApiBearerAuth()
@Controller('users')
@UseGuards(TenantAuthGuard)
export class UserRolesController {
  constructor(private readonly rbacService: RbacService) {}

  @Get(':id/roles')
  @ApiOperation({ summary: "Get user's roles (self or with settings:view:rbac)" })
  @ApiResponse({ status: 200, description: 'User roles' })
  @ApiResponse({ status: 403, description: 'Permission denied when viewing another user' })
  async getUserRoles(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser() user: { userId: string; permissions?: string[] },
    @Param('id') userId: string,
  ) {
    const isSelf = user.userId === userId;
    if (!isSelf) {
      const hasPermission = user.permissions?.includes('settings:view:rbac');
      if (!hasPermission) {
        throw new ForbiddenException({
          success: false,
          error: {
            code: 'PERMISSION_DENIED',
            message: 'You do not have permission to perform this action.',
            details: {
              required: 'settings:view:rbac',
              module: 'settings',
              action: 'view',
              resource: 'rbac',
            },
          },
        });
      }
    }
    const data = await this.rbacService.getUserRoles(tenant, userId);
    return { success: true, data };
  }

  @Post(':id/roles')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequirePermission('settings', 'edit', 'rbac')
  @ApiOperation({ summary: 'Assign roles to user' })
  async assignRoles(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') currentUserId: string,
    @Param('id') userId: string,
    @Body() dto: AssignRolesDto,
  ) {
    const data = await this.rbacService.assignRolesToUser(
      tenant,
      userId,
      dto.roleIds,
      currentUserId,
    );
    return { success: true, data };
  }

  @Delete(':userId/roles/:roleId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequirePermission('settings', 'edit', 'rbac')
  @ApiOperation({ summary: 'Remove role from user' })
  async removeRole(
    @TenantContext() tenant: TenantInfo,
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
  ) {
    const data = await this.rbacService.removeRoleFromUser(
      tenant,
      userId,
      roleId,
    );
    return { success: true, data };
  }
}
