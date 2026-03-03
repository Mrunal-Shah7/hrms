# Sprint 1C — Platform Auth (Super Admin)

## Goal
Build the complete super admin authentication system: login, JWT token pair with refresh rotation, session tracking, password reset via OTP email, and the `PlatformAuthGuard`. By the end of this sprint, a super admin can log in at `/platform/login`, receive tokens, refresh them, reset their password, and all `/api/platform/*` routes are protected by the platform guard. Includes a minimal functional frontend login page.

---

## 1. Pre-Requisite: Add Missing `platform.super_admin_otps` Table

The PRD specifies OTP-based password reset for super admins but the original platform schema didn't include an OTP table. We need to add one.

### 1.1 Update Platform Setup SQL
**File:** `backend/prisma/setup-platform.sql`

Add this table creation at the end of the file, after the `registration_requests` table:

```sql
CREATE TABLE IF NOT EXISTS platform.super_admin_otps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    super_admin_id UUID NOT NULL REFERENCES platform.super_admins(id) ON DELETE CASCADE,
    otp_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 1.2 Update Prisma Schema
**File:** `backend/prisma/schema.prisma`

Add the new model right after `PlatformSuperAdminSession`:

```prisma
model PlatformSuperAdminOtp {
  id           String   @id @default(uuid()) @db.Uuid
  superAdminId String   @map("super_admin_id") @db.Uuid
  otpHash      String   @map("otp_hash") @db.VarChar(255)
  expiresAt    DateTime @map("expires_at")
  used         Boolean  @default(false)
  createdAt    DateTime @default(now()) @map("created_at")

  superAdmin PlatformSuperAdmin @relation(fields: [superAdminId], references: [id], onDelete: Cascade)

  @@map("super_admin_otps")
}
```

Also add the relation to the `PlatformSuperAdmin` model:

```prisma
model PlatformSuperAdmin {
  // ... existing fields ...

  sessions PlatformSuperAdminSession[]
  otps     PlatformSuperAdminOtp[]       // ← add this line

  @@map("super_admins")
}
```

### 1.3 Apply Migration

```bash
cd backend

# If the table doesn't exist yet in your DB, run the SQL manually:
# psql -d hrms -c "CREATE TABLE IF NOT EXISTS platform.super_admin_otps (...)"
# Or re-run the seed which executes setup-platform.sql:
npx prisma db seed

# Regenerate Prisma client to pick up new model
npx prisma generate
```

---

## 2. Backend: Platform Auth Module

### 2.1 Directory Structure

```
backend/src/platform/platform-auth/
├── platform-auth.module.ts
├── platform-auth.controller.ts
├── platform-auth.service.ts
├── strategies/
│   └── platform-jwt.strategy.ts
├── guards/
│   └── platform-auth.guard.ts
└── dto/
    ├── platform-login.dto.ts
    ├── platform-refresh.dto.ts
    ├── platform-forgot-password.dto.ts
    ├── platform-verify-otp.dto.ts
    └── platform-reset-password.dto.ts
```

### 2.2 DTOs

**File:** `backend/src/platform/platform-auth/dto/platform-login.dto.ts`

```typescript
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PlatformLoginDto {
  @ApiProperty({ example: 'admin@hrms-platform.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'SuperAdmin@123' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
```

**File:** `backend/src/platform/platform-auth/dto/platform-refresh.dto.ts`

```typescript
import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PlatformRefreshDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
```

**File:** `backend/src/platform/platform-auth/dto/platform-forgot-password.dto.ts`

```typescript
import { IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PlatformForgotPasswordDto {
  @ApiProperty({ example: 'admin@hrms-platform.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
```

**File:** `backend/src/platform/platform-auth/dto/platform-verify-otp.dto.ts`

```typescript
import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PlatformVerifyOtpDto {
  @ApiProperty({ example: 'admin@hrms-platform.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: '482913' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  otp: string;
}
```

**File:** `backend/src/platform/platform-auth/dto/platform-reset-password.dto.ts`

```typescript
import { IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PlatformResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  resetToken: string;

  @ApiProperty({ example: 'NewSecure@123' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/, {
    message: 'Password must contain at least 1 uppercase, 1 lowercase, 1 number, and 1 special character',
  })
  newPassword: string;
}
```

Create a barrel export for convenience:

**File:** `backend/src/platform/platform-auth/dto/index.ts`

```typescript
export { PlatformLoginDto } from './platform-login.dto';
export { PlatformRefreshDto } from './platform-refresh.dto';
export { PlatformForgotPasswordDto } from './platform-forgot-password.dto';
export { PlatformVerifyOtpDto } from './platform-verify-otp.dto';
export { PlatformResetPasswordDto } from './platform-reset-password.dto';
```

---

### 2.3 Platform JWT Strategy

**File:** `backend/src/platform/platform-auth/strategies/platform-jwt.strategy.ts`

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

export interface PlatformJwtPayload {
  superAdminId: string;
  type: 'platform';
}

@Injectable()
export class PlatformJwtStrategy extends PassportStrategy(Strategy, 'platform-jwt') {
  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('PLATFORM_JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: PlatformJwtPayload) {
    // Reject tokens that aren't platform type (prevents tenant tokens from working)
    if (payload.type !== 'platform') {
      throw new UnauthorizedException('Invalid token type');
    }

    return {
      superAdminId: payload.superAdminId,
      type: payload.type,
    };
  }
}
```

---

### 2.4 Platform Auth Guard

**File:** `backend/src/platform/platform-auth/guards/platform-auth.guard.ts`

```typescript
import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard for all /api/platform/* routes (except auth endpoints).
 * Validates the JWT using the 'platform-jwt' strategy.
 * Ensures the token type is 'platform' (not 'tenant').
 */
@Injectable()
export class PlatformAuthGuard extends AuthGuard('platform-jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('Platform authentication required');
    }
    return user;
  }
}
```

Also create a convenience export at the common guards location:

**File:** `backend/src/common/guards/platform-auth.guard.ts`

```typescript
// Re-export from the platform-auth module for convenience
export { PlatformAuthGuard } from '../../platform/platform-auth/guards/platform-auth.guard';
```

---

### 2.5 Platform Auth Service

**File:** `backend/src/platform/platform-auth/platform-auth.service.ts`

```typescript
import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PlatformJwtPayload } from './strategies/platform-jwt.strategy';

@Injectable()
export class PlatformAuthService {
  private readonly logger = new Logger(PlatformAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ========================================================================
  // LOGIN
  // ========================================================================

  async login(email: string, password: string, deviceInfo: Record<string, any>) {
    // Find super admin in platform schema
    const admins = await this.prisma.queryRaw<any>(
      `SELECT id, email, password_hash, name, is_active FROM platform.super_admins WHERE email = $1 LIMIT 1`,
      email,
    );

    if (admins.length === 0) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const admin = admins[0];

    if (!admin.is_active) {
      throw new UnauthorizedException('Your account has been deactivated');
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, admin.password_hash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Generate token pair
    const tokens = await this.generateTokens(admin.id);

    // Store refresh token session
    const refreshTokenHash = await bcrypt.hash(tokens.refreshToken, 10);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.prisma.executeRaw(
      `INSERT INTO platform.super_admin_sessions (id, super_admin_id, refresh_token_hash, device_info, expires_at, created_at)
       VALUES (gen_random_uuid(), '${admin.id}', '${refreshTokenHash}', '${JSON.stringify(deviceInfo).replace(/'/g, "''")}', '${expiresAt.toISOString()}', NOW())`,
    );

    // Update last login
    await this.prisma.executeRaw(
      `UPDATE platform.super_admins SET last_login_at = NOW() WHERE id = '${admin.id}'`,
    );

    this.logger.log(`Super admin logged in: ${email}`);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      superAdmin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
      },
    };
  }

  // ========================================================================
  // REFRESH TOKEN
  // ========================================================================

  async refresh(refreshToken: string) {
    // Find all non-expired sessions
    const sessions = await this.prisma.queryRaw<any>(
      `SELECT id, super_admin_id, refresh_token_hash FROM platform.super_admin_sessions WHERE expires_at > NOW()`,
    );

    // Find the session matching this refresh token
    let matchedSession: any = null;
    for (const session of sessions) {
      const isMatch = await bcrypt.compare(refreshToken, session.refresh_token_hash);
      if (isMatch) {
        matchedSession = session;
        break;
      }
    }

    if (!matchedSession) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Verify the super admin is still active
    const admins = await this.prisma.queryRaw<any>(
      `SELECT id, is_active FROM platform.super_admins WHERE id = $1 LIMIT 1`,
      matchedSession.super_admin_id,
    );

    if (admins.length === 0 || !admins[0].is_active) {
      // Invalidate the session
      await this.prisma.executeRaw(
        `DELETE FROM platform.super_admin_sessions WHERE id = '${matchedSession.id}'`,
      );
      throw new UnauthorizedException('Account deactivated');
    }

    // Rotation: Delete old session, create new one
    await this.prisma.executeRaw(
      `DELETE FROM platform.super_admin_sessions WHERE id = '${matchedSession.id}'`,
    );

    // Generate new token pair
    const tokens = await this.generateTokens(matchedSession.super_admin_id);

    // Store new refresh token session
    const newRefreshHash = await bcrypt.hash(tokens.refreshToken, 10);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.executeRaw(
      `INSERT INTO platform.super_admin_sessions (id, super_admin_id, refresh_token_hash, device_info, expires_at, created_at)
       VALUES (gen_random_uuid(), '${matchedSession.super_admin_id}', '${newRefreshHash}', '{}', '${expiresAt.toISOString()}', NOW())`,
    );

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  // ========================================================================
  // LOGOUT
  // ========================================================================

  async logout(superAdminId: string, refreshToken?: string) {
    if (refreshToken) {
      // Invalidate the specific session matching this refresh token
      const sessions = await this.prisma.queryRaw<any>(
        `SELECT id, refresh_token_hash FROM platform.super_admin_sessions WHERE super_admin_id = $1`,
        superAdminId,
      );

      for (const session of sessions) {
        const isMatch = await bcrypt.compare(refreshToken, session.refresh_token_hash);
        if (isMatch) {
          await this.prisma.executeRaw(
            `DELETE FROM platform.super_admin_sessions WHERE id = '${session.id}'`,
          );
          break;
        }
      }
    } else {
      // No refresh token provided — invalidate ALL sessions for this admin
      await this.prisma.executeRaw(
        `DELETE FROM platform.super_admin_sessions WHERE super_admin_id = '${superAdminId}'`,
      );
    }

    this.logger.log(`Super admin logged out: ${superAdminId}`);
  }

  // ========================================================================
  // FORGOT PASSWORD — Send OTP
  // ========================================================================

  async forgotPassword(email: string) {
    const admins = await this.prisma.queryRaw<any>(
      `SELECT id, email, name FROM platform.super_admins WHERE email = $1 AND is_active = TRUE LIMIT 1`,
      email,
    );

    // Always return success (no user enumeration)
    if (admins.length === 0) {
      this.logger.warn(`Forgot password attempted for non-existent/inactive email: ${email}`);
      return { message: 'If an account exists with this email, an OTP has been sent.' };
    }

    const admin = admins[0];

    // Invalidate any existing unused OTPs for this admin
    await this.prisma.executeRaw(
      `UPDATE platform.super_admin_otps SET used = TRUE WHERE super_admin_id = '${admin.id}' AND used = FALSE`,
    );

    // Generate 6-digit OTP
    const otp = this.generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP
    await this.prisma.executeRaw(
      `INSERT INTO platform.super_admin_otps (id, super_admin_id, otp_hash, expires_at, used, created_at)
       VALUES (gen_random_uuid(), '${admin.id}', '${otpHash}', '${expiresAt.toISOString()}', FALSE, NOW())`,
    );

    // Send OTP via email
    // NOTE: Using nodemailer directly here since EmailService (Sprint 1G) isn't built yet.
    // This will be refactored to use the EmailService abstraction in Sprint 1G.
    await this.sendOtpEmail(admin.email, admin.name, otp);

    this.logger.log(`OTP sent to super admin: ${email}`);

    return { message: 'If an account exists with this email, an OTP has been sent.' };
  }

  // ========================================================================
  // VERIFY OTP
  // ========================================================================

  async verifyOtp(email: string, otp: string) {
    const admins = await this.prisma.queryRaw<any>(
      `SELECT id FROM platform.super_admins WHERE email = $1 AND is_active = TRUE LIMIT 1`,
      email,
    );

    if (admins.length === 0) {
      throw new BadRequestException('Invalid OTP');
    }

    const adminId = admins[0].id;

    // Find valid (unused, non-expired) OTPs for this admin
    const otps = await this.prisma.queryRaw<any>(
      `SELECT id, otp_hash FROM platform.super_admin_otps
       WHERE super_admin_id = $1 AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 5`,
      adminId,
    );

    // Check if any OTP matches
    let matchedOtp: any = null;
    for (const record of otps) {
      const isMatch = await bcrypt.compare(otp, record.otp_hash);
      if (isMatch) {
        matchedOtp = record;
        break;
      }
    }

    if (!matchedOtp) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    // Mark OTP as used
    await this.prisma.executeRaw(
      `UPDATE platform.super_admin_otps SET used = TRUE WHERE id = '${matchedOtp.id}'`,
    );

    // Generate a short-lived reset token (15 minutes)
    const resetToken = this.jwtService.sign(
      { superAdminId: adminId, purpose: 'password_reset', type: 'platform' },
      {
        secret: this.config.get<string>('PLATFORM_JWT_ACCESS_SECRET'),
        expiresIn: '15m',
      },
    );

    return { resetToken };
  }

  // ========================================================================
  // RESET PASSWORD
  // ========================================================================

  async resetPassword(resetToken: string, newPassword: string) {
    // Verify reset token
    let payload: any;
    try {
      payload = this.jwtService.verify(resetToken, {
        secret: this.config.get<string>('PLATFORM_JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new BadRequestException('Invalid or expired reset token');
    }

    if (payload.purpose !== 'password_reset' || payload.type !== 'platform') {
      throw new BadRequestException('Invalid reset token');
    }

    const adminId = payload.superAdminId;

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Update password
    await this.prisma.executeRaw(
      `UPDATE platform.super_admins SET password_hash = '${passwordHash}' WHERE id = '${adminId}'`,
    );

    // Invalidate ALL sessions (force re-login everywhere)
    await this.prisma.executeRaw(
      `DELETE FROM platform.super_admin_sessions WHERE super_admin_id = '${adminId}'`,
    );

    // Mark all remaining OTPs as used
    await this.prisma.executeRaw(
      `UPDATE platform.super_admin_otps SET used = TRUE WHERE super_admin_id = '${adminId}' AND used = FALSE`,
    );

    this.logger.log(`Password reset completed for super admin: ${adminId}`);

    return { message: 'Password reset successfully. Please log in with your new password.' };
  }

  // ========================================================================
  // GET CURRENT ADMIN (for validating tokens / getting profile)
  // ========================================================================

  async getCurrentAdmin(superAdminId: string) {
    const admins = await this.prisma.queryRaw<any>(
      `SELECT id, email, name, is_active, last_login_at, created_at FROM platform.super_admins WHERE id = $1 LIMIT 1`,
      superAdminId,
    );

    if (admins.length === 0) {
      throw new UnauthorizedException('Admin not found');
    }

    return admins[0];
  }

  // ========================================================================
  // PRIVATE HELPERS
  // ========================================================================

  private async generateTokens(superAdminId: string) {
    const payload: PlatformJwtPayload = {
      superAdminId,
      type: 'platform',
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('PLATFORM_JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRY', '15m'),
    });

    const refreshToken = this.jwtService.sign(
      { ...payload, tokenType: 'refresh' },
      {
        secret: this.config.get<string>('PLATFORM_JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRY', '7d'),
      },
    );

    return { accessToken, refreshToken };
  }

  private generateOtp(): string {
    // Generate a cryptographically secure 6-digit OTP
    return crypto.randomInt(100000, 999999).toString();
  }

  private async sendOtpEmail(to: string, name: string, otp: string): Promise<void> {
    // Direct nodemailer usage — will be replaced by EmailService in Sprint 1G
    const nodemailer = require('nodemailer');

    const transporter = nodemailer.createTransport({
      host: this.config.get<string>('MAIL_HOST'),
      port: parseInt(this.config.get<string>('MAIL_PORT', '587')),
      secure: this.config.get<string>('MAIL_SECURE') === 'true',
      auth: {
        user: this.config.get<string>('MAIL_USER'),
        pass: this.config.get<string>('MAIL_PASSWORD'),
      },
    });

    await transporter.sendMail({
      from: `"HRMS Platform" <${this.config.get<string>('MAIL_FROM')}>`,
      to,
      subject: 'HRMS Platform — Password Reset OTP',
      html: `
        <div style="font-family: Inter, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #011552; margin-bottom: 16px;">Password Reset</h2>
          <p>Hi ${name},</p>
          <p>You requested a password reset for your HRMS Platform admin account. Use the OTP below to proceed:</p>
          <div style="background: #f4f4f5; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #011552;">${otp}</span>
          </div>
          <p style="color: #71717a; font-size: 14px;">This OTP expires in <strong>10 minutes</strong>. If you didn't request this, please ignore this email.</p>
        </div>
      `,
    });
  }
}
```

---

### 2.6 Platform Auth Controller

**File:** `backend/src/platform/platform-auth/platform-auth.controller.ts`

```typescript
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
import { Request } from 'express';
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

  /**
   * POST /api/platform/auth/login
   * Super admin login — no auth required
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Super admin login' })
  @ApiResponse({ status: 200, description: 'Login successful, returns token pair' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: PlatformLoginDto, @Req() req: Request) {
    const deviceInfo = {
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] || 'unknown',
      browser: this.parseBrowser(req.headers['user-agent']),
      os: this.parseOS(req.headers['user-agent']),
    };

    const result = await this.authService.login(dto.email, dto.password, deviceInfo);

    return {
      success: true,
      data: result,
    };
  }

  /**
   * POST /api/platform/auth/refresh
   * Refresh token pair — no auth guard (uses refresh token in body)
   */
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

  /**
   * POST /api/platform/auth/logout
   * Invalidate session — requires platform auth
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PlatformAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Super admin logout' })
  async logout(@CurrentUser('superAdminId') superAdminId: string, @Body() body: { refreshToken?: string }) {
    await this.authService.logout(superAdminId, body.refreshToken);

    return {
      success: true,
      data: { message: 'Logged out successfully' },
    };
  }

  /**
   * POST /api/platform/auth/forgot-password
   * Send OTP to super admin email — no auth required
   */
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send password reset OTP' })
  async forgotPassword(@Body() dto: PlatformForgotPasswordDto) {
    const result = await this.authService.forgotPassword(dto.email);

    return {
      success: true,
      data: result,
    };
  }

  /**
   * POST /api/platform/auth/verify-otp
   * Verify OTP → returns reset token — no auth required
   */
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
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

  /**
   * POST /api/platform/auth/reset-password
   * Reset password using reset token — no auth required
   */
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

  /**
   * GET /api/platform/auth/me
   * Get current super admin profile — requires platform auth
   */
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

  // --- Private helpers for device info parsing ---

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
```

---

### 2.7 Platform Auth Module

**File:** `backend/src/platform/platform-auth/platform-auth.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformJwtStrategy } from './strategies/platform-jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'platform-jwt' }),
    JwtModule.register({}), // We pass secrets per sign() call, so no global config needed
  ],
  controllers: [PlatformAuthController],
  providers: [PlatformAuthService, PlatformJwtStrategy],
  exports: [PlatformAuthService, PlatformJwtStrategy],
})
export class PlatformAuthModule {}
```

---

### 2.8 Register in AppModule

**File:** Update `backend/src/app.module.ts`

```typescript
import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { TenantModule } from './tenant/tenant.module';
import { PlatformAuthModule } from './platform/platform-auth/platform-auth.module';
import { TenantMiddleware } from './common/middleware/tenant.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    TenantModule,
    PlatformAuthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware)
      .exclude(
        { path: 'api/platform/(.*)', method: RequestMethod.ALL },
        { path: 'api/public/(.*)', method: RequestMethod.ALL },
      )
      .forRoutes('*');
  }
}
```

---

## 3. Frontend: Minimal Platform Login Page

### 3.1 Platform Login Page

**File:** Replace `frontend/src/app/(platform)/platform/login/page.tsx`

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import api from '@/services/api';

export default function PlatformLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [step, setStep] = useState<'login' | 'forgot' | 'verify-otp' | 'reset'>('login');
  const [message, setMessage] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.post('/platform/auth/login', { email, password });
      const { accessToken, refreshToken, superAdmin } = res.data.data;

      localStorage.setItem('platformAccessToken', accessToken);
      localStorage.setItem('platformRefreshToken', refreshToken);
      localStorage.setItem('platformAdmin', JSON.stringify(superAdmin));

      router.push('/platform/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.post('/platform/auth/forgot-password', { email: forgotEmail });
      setMessage('If an account exists, an OTP has been sent to your email.');
      setStep('verify-otp');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.post('/platform/auth/verify-otp', { email: forgotEmail, otp });
      setResetToken(res.data.data.resetToken);
      setStep('reset');
      setMessage('');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Invalid or expired OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.post('/platform/auth/reset-password', { resetToken, newPassword });
      setMessage('Password reset successfully! Please log in.');
      setStep('login');
      setResetToken('');
      setNewPassword('');
      setOtp('');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-lg bg-brand flex items-center justify-center">
            <span className="text-white font-bold text-lg">H</span>
          </div>
          <CardTitle className="text-2xl text-brand">
            {step === 'login' && 'Platform Admin'}
            {step === 'forgot' && 'Forgot Password'}
            {step === 'verify-otp' && 'Verify OTP'}
            {step === 'reset' && 'Reset Password'}
          </CardTitle>
          <CardDescription>
            {step === 'login' && 'Sign in to the HRMS Platform Admin Portal'}
            {step === 'forgot' && 'Enter your email to receive a password reset OTP'}
            {step === 'verify-otp' && 'Enter the 6-digit OTP sent to your email'}
            {step === 'reset' && 'Enter your new password'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {message && (
            <Alert className="mb-4">
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}

          {/* LOGIN FORM */}
          {step === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@hrms-platform.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
              <button
                type="button"
                className="w-full text-sm text-muted-foreground hover:text-brand transition-colors"
                onClick={() => { setStep('forgot'); setError(''); setMessage(''); }}
              >
                Forgot password?
              </button>
            </form>
          )}

          {/* FORGOT PASSWORD FORM */}
          {step === 'forgot' && (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  placeholder="admin@hrms-platform.com"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending OTP...' : 'Send OTP'}
              </Button>
              <button
                type="button"
                className="w-full text-sm text-muted-foreground hover:text-brand transition-colors"
                onClick={() => { setStep('login'); setError(''); setMessage(''); }}
              >
                Back to login
              </button>
            </form>
          )}

          {/* VERIFY OTP FORM */}
          {step === 'verify-otp' && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="otp">6-Digit OTP</Label>
                <Input
                  id="otp"
                  type="text"
                  placeholder="000000"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  maxLength={6}
                  className="text-center text-2xl tracking-widest"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || otp.length !== 6}>
                {loading ? 'Verifying...' : 'Verify OTP'}
              </Button>
              <button
                type="button"
                className="w-full text-sm text-muted-foreground hover:text-brand transition-colors"
                onClick={() => { setStep('forgot'); setError(''); setMessage(''); }}
              >
                Resend OTP
              </button>
            </form>
          )}

          {/* RESET PASSWORD FORM */}
          {step === 'reset' && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                />
                <p className="text-xs text-muted-foreground">
                  Min 8 characters with uppercase, lowercase, number, and special character.
                </p>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Resetting...' : 'Reset Password'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

### 3.2 Remove Platform Layout for Login

The login page should NOT use the platform admin shell layout (sidebar/header). It needs a blank layout.

**File:** Create `frontend/src/app/(platform)/platform/login/layout.tsx`

```typescript
export default function PlatformLoginLayout({ children }: { children: React.ReactNode }) {
  // Plain layout — no sidebar, no header. Just the children (login form).
  return <>{children}</>;
}
```

### 3.3 Platform Auth API Helper

**File:** Create `frontend/src/services/platform-auth.ts`

```typescript
import api from './api';

export const platformAuthApi = {
  login: (email: string, password: string) =>
    api.post('/platform/auth/login', { email, password }),

  refresh: (refreshToken: string) =>
    api.post('/platform/auth/refresh', { refreshToken }),

  logout: (refreshToken?: string) =>
    api.post('/platform/auth/logout', { refreshToken }),

  forgotPassword: (email: string) =>
    api.post('/platform/auth/forgot-password', { email }),

  verifyOtp: (email: string, otp: string) =>
    api.post('/platform/auth/verify-otp', { email, otp }),

  resetPassword: (resetToken: string, newPassword: string) =>
    api.post('/platform/auth/reset-password', { resetToken, newPassword }),

  me: () => api.get('/platform/auth/me'),
};
```

---

## 4. Session Cleanup (Optional Cron)

Expired sessions accumulate in the database. Add a simple cleanup mechanism.

**File:** Create `backend/src/platform/platform-auth/session-cleanup.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SessionCleanupService {
  private readonly logger = new Logger(SessionCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Clean up expired super admin sessions daily at midnight.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanExpiredSessions() {
    try {
      await this.prisma.executeRaw(
        `DELETE FROM platform.super_admin_sessions WHERE expires_at < NOW()`,
      );

      await this.prisma.executeRaw(
        `DELETE FROM platform.super_admin_otps WHERE expires_at < NOW() OR used = TRUE`,
      );

      this.logger.log('Expired platform sessions and OTPs cleaned up');
    } catch (error) {
      this.logger.error(`Session cleanup failed: ${error.message}`);
    }
  }
}
```

Install the schedule module:

```bash
cd backend
npm install @nestjs/schedule
```

Register in the module:

**File:** Update `backend/src/platform/platform-auth/platform-auth.module.ts` to include the cleanup service:

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ScheduleModule } from '@nestjs/schedule';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformJwtStrategy } from './strategies/platform-jwt.strategy';
import { SessionCleanupService } from './session-cleanup.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'platform-jwt' }),
    JwtModule.register({}),
    ScheduleModule.forRoot(),
  ],
  controllers: [PlatformAuthController],
  providers: [PlatformAuthService, PlatformJwtStrategy, SessionCleanupService],
  exports: [PlatformAuthService, PlatformJwtStrategy],
})
export class PlatformAuthModule {}
```

---

## 5. Verification & Acceptance Criteria

### 5.1 API Testing (use Swagger UI at `/api/docs` or cURL/Postman)

**Test 1: Login**
```bash
curl -X POST http://localhost:3001/api/platform/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@hrms-platform.com","password":"SuperAdmin@123"}'
```
Expected: `{ success: true, data: { accessToken, refreshToken, superAdmin: { id, email, name } } }`

**Test 2: Get Profile (with token)**
```bash
curl http://localhost:3001/api/platform/auth/me \
  -H "Authorization: Bearer <accessToken>"
```
Expected: `{ success: true, data: { id, email, name, is_active, last_login_at } }`

**Test 3: Refresh Token**
```bash
curl -X POST http://localhost:3001/api/platform/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<refreshToken>"}'
```
Expected: New token pair. Using the OLD refresh token again should fail (rotation).

**Test 4: Invalid Token Rejected**
```bash
curl http://localhost:3001/api/platform/auth/me \
  -H "Authorization: Bearer invalid-token-here"
```
Expected: `401 Unauthorized`

**Test 5: Forgot Password → OTP → Reset**
```bash
# Step 1: Request OTP
curl -X POST http://localhost:3001/api/platform/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@hrms-platform.com"}'
# → Check email for OTP

# Step 2: Verify OTP
curl -X POST http://localhost:3001/api/platform/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@hrms-platform.com","otp":"<6-digit-otp>"}'
# → Returns resetToken

# Step 3: Reset Password
curl -X POST http://localhost:3001/api/platform/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"resetToken":"<resetToken>","newPassword":"NewSecure@123"}'
# → Password reset, all sessions invalidated

# Step 4: Login with new password
curl -X POST http://localhost:3001/api/platform/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@hrms-platform.com","password":"NewSecure@123"}'
# → Should succeed
```

**Test 6: Logout**
```bash
curl -X POST http://localhost:3001/api/platform/auth/logout \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<refreshToken>"}'
```
Expected: Session invalidated. Refresh with old token fails.

### 5.2 Frontend Testing

1. Visit `http://localhost:3000/platform/login` — form renders with brand styling
2. Enter seeded credentials → redirects to `/platform/dashboard`
3. Tokens stored in localStorage (`platformAccessToken`, `platformRefreshToken`)
4. Click "Forgot password?" → OTP flow steps through all 3 stages
5. After reset → can log in with new password

### 5.3 Full Checklist

- [ ] Super admin login authenticates against `platform.super_admins` — never against any tenant schema
- [ ] Platform JWT has `type: 'platform'` in payload
- [ ] Access token expires in 15 minutes
- [ ] Refresh token expires in 7 days
- [ ] Refresh token rotation works — old token invalid after use
- [ ] Session stored in `platform.super_admin_sessions` with device info
- [ ] `PlatformAuthGuard` rejects requests without valid platform JWT
- [ ] `PlatformAuthGuard` rejects tenant JWTs (different `type` field)
- [ ] Deactivated admin cannot log in (returns "account deactivated")
- [ ] Login failure returns generic message — no user enumeration
- [ ] Forgot password sends 6-digit OTP to email
- [ ] Forgot password for non-existent email returns same response (no enumeration)
- [ ] OTP expires after 10 minutes
- [ ] OTP can only be used once
- [ ] Password reset invalidates ALL sessions
- [ ] New password requires: min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char
- [ ] `/api/platform/auth/me` returns current admin profile
- [ ] Swagger docs at `/api/docs` show all 7 platform auth endpoints
- [ ] Frontend login page renders at `/platform/login` with brand theme
- [ ] Expired sessions cleaned up by daily cron job

---

*Sprint 1C Complete. Next: Sprint 1D — Self-Service Tenant Registration*
