import { Controller, Post, Get, Put, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RegistrationService } from './registration.service';
import { CreateRegistrationDto, ResendVerificationDto, UpdateRegistrationEmailDto } from './dto';

@ApiTags('Public Registration')
@Controller('public/register')
export class RegistrationController {
  constructor(private readonly registrationService: RegistrationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 3600000 } }) // 5 per 60 minutes (PRD 5.6)
  @ApiOperation({ summary: 'Submit registration' })
  @ApiResponse({ status: 201, description: 'Verification email sent' })
  @ApiResponse({ status: 409, description: 'Slug or email already taken' })
  @ApiResponse({ status: 400, description: 'Validation errors' })
  async register(@Body() dto: CreateRegistrationDto) {
    const result = await this.registrationService.register({
      organizationName: dto.organizationName,
      slug: dto.slug,
      adminName: dto.adminName,
      adminEmail: dto.adminEmail,
      password: dto.password,
      subscriptionTier: dto.subscriptionTier,
      maxUsers: dto.maxUsers,
    });

    return { success: true, data: result };
  }

  @Get('verify')
  @ApiOperation({ summary: 'Verify email and provision tenant' })
  @ApiResponse({ status: 200, description: 'Verification result (provisioned, already_provisioned, already_verified, or failed)' })
  @ApiResponse({ status: 404, description: 'Invalid token' })
  @ApiResponse({ status: 400, description: 'Token expired' })
  async verify(@Query('token') token: string) {
    const result = await this.registrationService.verifyEmail(token);
    return { success: true, data: result };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 3600000 } }) // 3 per 60 minutes (PRD 5.6)
  @ApiOperation({ summary: 'Resend verification email' })
  async resendVerification(@Body() dto: ResendVerificationDto) {
    const result = await this.registrationService.resendVerification(dto.email);
    return { success: true, data: result };
  }

  @Put('update-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change admin email before verification' })
  @ApiResponse({ status: 200, description: 'Verification email sent to new address' })
  @ApiResponse({ status: 404, description: 'Registration not found or already verified' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async updateEmail(@Body() dto: UpdateRegistrationEmailDto) {
    const result = await this.registrationService.updateEmail(
      dto.registrationId,
      dto.currentEmail,
      dto.newEmail,
    );
    return { success: true, data: result };
  }

  @Get('check-slug')
  @ApiOperation({ summary: 'Check slug availability' })
  async checkSlug(@Query('slug') slug: string) {
    const result = await this.registrationService.checkSlug(slug);
    return { success: true, data: result };
  }

  @Get('check-email')
  @ApiOperation({ summary: 'Check email availability' })
  async checkEmail(@Query('email') email: string) {
    const result = await this.registrationService.checkEmail(email);
    return { success: true, data: result };
  }
}
