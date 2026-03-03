import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { AccountService } from './account.service';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { TenantContext } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import * as Tenant from '../tenant/tenant.interface';
import {
  UpdateProfileDto,
  ChangePasswordDto,
  UpdatePreferencesDto,
  UpdateOrganizationDto,
} from './dto';

@ApiTags('Account')
@Controller('account')
@UseGuards(TenantAuthGuard)
@ApiBearerAuth()
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get own profile' })
  @ApiResponse({ status: 200, description: 'Profile with personal info, preferences, org defaults' })
  async getProfile(
    @TenantContext() tenant: Tenant.TenantInfo,
    @CurrentUser('userId') userId: string,
  ) {
    const data = await this.accountService.getProfile(tenant, userId);
    return { success: true, data };
  }

  @Put('profile')
  @ApiOperation({ summary: 'Update own profile' })
  @ApiResponse({ status: 200, description: 'Updated profile' })
  async updateProfile(
    @TenantContext() tenant: Tenant.TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    const data = await this.accountService.updateProfile(tenant, userId, dto);
    return { success: true, data };
  }

  @Put('profile/photo')
  @UseInterceptors(FileInterceptor('photo'))
  @ApiOperation({ summary: 'Upload profile photo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        photo: { type: 'string', format: 'binary' },
      },
      required: ['photo'],
    },
  })
  @ApiResponse({ status: 200, description: 'Photo URL' })
  async uploadPhoto(
    @TenantContext() tenant: Tenant.TenantInfo,
    @CurrentUser('userId') userId: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number; originalname?: string },
  ) {
    const result = await this.accountService.uploadPhoto(tenant, userId, file);
    return { success: true, data: result };
  }

  @Delete('profile/photo')
  @ApiOperation({ summary: 'Delete profile photo' })
  @ApiResponse({ status: 200, description: 'Photo deleted' })
  async deletePhoto(
    @TenantContext() tenant: Tenant.TenantInfo,
    @CurrentUser('userId') userId: string,
  ) {
    const result = await this.accountService.deletePhoto(tenant, userId);
    return { success: true, data: result };
  }

  @Put('change-password')
  @ApiOperation({ summary: 'Change password' })
  @ApiResponse({ status: 200, description: 'Password changed, other sessions revoked' })
  async changePassword(
    @TenantContext() tenant: Tenant.TenantInfo,
    @CurrentUser() user: { userId: string; sessionId?: string },
    @Body() dto: ChangePasswordDto,
  ) {
    const result = await this.accountService.changePassword(
      tenant,
      user.userId,
      user.sessionId,
      dto,
    );
    return { success: true, data: result };
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List active sessions' })
  @ApiResponse({ status: 200, description: 'Sessions with device info and isCurrent flag' })
  async getSessions(
    @TenantContext() tenant: Tenant.TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('sessionId') sessionId: string | undefined,
  ) {
    const data = await this.accountService.getSessions(tenant, userId, sessionId);
    return { success: true, data };
  }

  @Delete('sessions/:id')
  @ApiOperation({ summary: 'Revoke a session' })
  @ApiResponse({ status: 200, description: 'Session revoked' })
  @ApiResponse({ status: 400, description: 'Cannot revoke current session' })
  async revokeSession(
    @TenantContext() tenant: Tenant.TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('sessionId') sessionId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.accountService.revokeSession(
      tenant,
      userId,
      id,
      sessionId,
    );
    return { success: true, data: result };
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Get user preferences' })
  @ApiResponse({ status: 200, description: 'Preferences with org defaults' })
  async getPreferences(
    @TenantContext() tenant: Tenant.TenantInfo,
    @CurrentUser('userId') userId: string,
  ) {
    const data = await this.accountService.getPreferences(tenant, userId);
    return { success: true, data };
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Update user preferences' })
  @ApiResponse({ status: 200, description: 'Updated preferences' })
  async updatePreferences(
    @TenantContext() tenant: Tenant.TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdatePreferencesDto,
  ) {
    const data = await this.accountService.updatePreferences(tenant, userId, dto);
    return { success: true, data };
  }

  @Get('organization')
  @ApiOperation({ summary: 'Get organization info' })
  @ApiResponse({ status: 200, description: 'Org settings + subscription' })
  async getOrganization(@TenantContext() tenant: Tenant.TenantInfo) {
    const data = await this.accountService.getOrganization(tenant);
    return { success: true, data };
  }

  @Put('organization')
  @UseGuards(PermissionGuard)
  @RequirePermission('settings', 'edit', 'organization')
  @ApiOperation({ summary: 'Update organization settings (Admin only)' })
  @ApiResponse({ status: 200, description: 'Updated org settings' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  async updateOrganization(
    @TenantContext() tenant: Tenant.TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('permissions') permissions: string[],
    @Body() dto: UpdateOrganizationDto,
  ) {
    const data = await this.accountService.updateOrganization(
      tenant,
      userId,
      permissions ?? [],
      {
        orgName: dto.orgName,
        companyEmailDomain: dto.companyEmailDomain,
        defaultTimezone: dto.defaultTimezone,
        dateFormat: dto.dateFormat,
        financialYearStartMonth: dto.financialYearStartMonth,
        defaultCurrency: dto.defaultCurrency,
      },
    );
    return { success: true, data };
  }
}
