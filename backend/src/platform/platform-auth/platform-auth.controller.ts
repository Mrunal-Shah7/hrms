import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Get,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAuthGuard } from './guards/platform-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  PlatformLoginDto,
  PlatformRefreshDto,
  PlatformForgotPasswordDto,
  PlatformVerifyOtpDto,
  PlatformResetPasswordDto,
} from './dto';

@ApiTags('Platform Auth')
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly authService: PlatformAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 300000 } })
  @ApiOperation({ summary: 'Super admin login' })
  @ApiResponse({ status: 200, description: 'Login successful, returns token pair' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: PlatformLoginDto, @Req() req: Request) {
    const deviceInfo = {
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'] || 'unknown',
      browser: this.parseBrowser(req.headers['user-agent'] as string),
      os: this.parseOS(req.headers['user-agent'] as string),
    };

    const result = await this.authService.login(dto.email, dto.password, deviceInfo);

    return {
      success: true,
      data: result,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh token pair' })
  @ApiResponse({ status: 200, description: 'New token pair returned' })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refresh(@Body() dto: PlatformRefreshDto) {
    const result = await this.authService.refresh(dto.refreshToken);

    return {
      success: true,
      data: result,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PlatformAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Super admin logout' })
  async logout(
    @CurrentUser('superAdminId') superAdminId: string,
    @Body() body: { refreshToken?: string },
  ) {
    await this.authService.logout(superAdminId, body?.refreshToken);

    return {
      success: true,
      data: { message: 'Logged out successfully' },
    };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 900000 } })
  @ApiOperation({ summary: 'Send password reset OTP' })
  async forgotPassword(@Body() dto: PlatformForgotPasswordDto) {
    const result = await this.authService.forgotPassword(dto.email);

    return {
      success: true,
      data: result,
    };
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 300000 } })
  @ApiOperation({ summary: 'Verify OTP and get reset token' })
  @ApiResponse({ status: 200, description: 'OTP valid, returns resetToken' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  async verifyOtp(@Body() dto: PlatformVerifyOtpDto) {
    const result = await this.authService.verifyOtp(dto.email, dto.otp);

    return {
      success: true,
      data: result,
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with reset token' })
  async resetPassword(@Body() dto: PlatformResetPasswordDto) {
    const result = await this.authService.resetPassword(dto.resetToken, dto.newPassword);

    return {
      success: true,
      data: result,
    };
  }

  @Get('me')
  @UseGuards(PlatformAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current super admin profile' })
  async me(@CurrentUser('superAdminId') superAdminId: string) {
    const admin = await this.authService.getCurrentAdmin(superAdminId);

    return {
      success: true,
      data: admin,
    };
  }

  private parseBrowser(userAgent?: string): string {
    if (!userAgent) return 'Unknown';
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari')) return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    return 'Other';
  }

  private parseOS(userAgent?: string): string {
    if (!userAgent) return 'Unknown';
    if (userAgent.includes('Windows')) return 'Windows';
    if (userAgent.includes('Mac OS')) return 'macOS';
    if (userAgent.includes('Linux')) return 'Linux';
    if (userAgent.includes('Android')) return 'Android';
    if (userAgent.includes('iOS')) return 'iOS';
    return 'Other';
  }
}
