import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { TenantAuthGuard } from './guards/tenant-auth.guard';
import { TenantContext } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import * as Tenant from '../tenant/tenant.interface';
import {
  TenantLoginDto,
  TenantRefreshDto,
  TenantForgotPasswordDto,
  TenantVerifyOtpDto,
  TenantResetPasswordDto,
  ForceChangePasswordDto,
  ReAuthenticateDto,
} from './dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 300000 } }) // 5 per 5 minutes
  @ApiOperation({ summary: 'Tenant user login' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @TenantContext() tenant: Tenant.TenantInfo,
    @Body() dto: TenantLoginDto,
    @Req() req: Request,
  ) {
    const deviceInfo = this.getDeviceInfo(req);
    const result = await this.authService.login(tenant, dto.email, dto.password, deviceInfo);
    return { success: true, data: result };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh token pair' })
  async refresh(@TenantContext() tenant: Tenant.TenantInfo, @Body() dto: TenantRefreshDto) {
    const result = await this.authService.refresh(tenant, dto.refreshToken);
    return { success: true, data: result };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TenantAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout' })
  async logout(
    @TenantContext() tenant: Tenant.TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() body?: { refreshToken?: string },
  ) {
    await this.authService.logout(tenant, userId, body?.refreshToken);
    return { success: true, data: { message: 'Logged out successfully' } };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 900000 } }) // 3 per 15 minutes
  @ApiOperation({ summary: 'Send password reset OTP' })
  async forgotPassword(
    @TenantContext() tenant: Tenant.TenantInfo,
    @Body() dto: TenantForgotPasswordDto,
  ) {
    const result = await this.authService.forgotPassword(tenant, dto.email);
    return { success: true, data: result };
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 300000 } }) // 5 per 5 minutes
  @ApiOperation({ summary: 'Verify OTP and get reset token' })
  async verifyOtp(
    @TenantContext() tenant: Tenant.TenantInfo,
    @Body() dto: TenantVerifyOtpDto,
  ) {
    const result = await this.authService.verifyOtp(tenant, dto.email, dto.otp);
    return { success: true, data: result };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 900000 } }) // 3 per 15 minutes
  @ApiOperation({ summary: 'Reset password with token' })
  async resetPassword(@Body() dto: TenantResetPasswordDto) {
    const result = await this.authService.resetPassword(dto.resetToken, dto.newPassword);
    return { success: true, data: result };
  }

  @Post('force-change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TenantAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Force password change (first login)' })
  async forceChangePassword(
    @TenantContext() tenant: Tenant.TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: ForceChangePasswordDto,
  ) {
    const result = await this.authService.forceChangePassword(tenant, userId, dto.newPassword);
    return { success: true, data: result };
  }

  @Post('re-authenticate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TenantAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 300000 } }) // 5 per 5 minutes
  @ApiOperation({ summary: 'Re-authenticate for compensation access' })
  async reAuthenticate(
    @TenantContext() tenant: Tenant.TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: ReAuthenticateDto,
  ) {
    const result = await this.authService.reAuthenticate(tenant, userId, dto.password);
    return { success: true, data: result };
  }

  @Get('me')
  @UseGuards(TenantAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user' })
  async me(@TenantContext() tenant: Tenant.TenantInfo, @CurrentUser('userId') userId: string) {
    const user = await this.authService.getMe(tenant, userId);
    return { success: true, data: user };
  }

  private getDeviceInfo(req: Request): Record<string, unknown> {
    const r = req as Request & { socket?: { remoteAddress?: string }; headers?: Record<string, string> };
    return {
      ip: r?.ip || r?.socket?.remoteAddress,
      userAgent: r?.headers?.['user-agent'] || 'unknown',
    };
  }
}
