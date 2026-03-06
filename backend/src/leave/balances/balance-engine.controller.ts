import { Controller, Post, Get, Put, Body, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BalanceEngineService } from './balance-engine.service';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantInfo } from '../../tenant/tenant.interface';
import { GenerateBalancesDto } from './dto/generate-balances.dto';
import { SetBalanceDto } from './dto/set-balance.dto';

@ApiTags('Leave Balances')
@ApiBearerAuth()
@Controller('leave/balances')
@UseGuards(TenantAuthGuard)
export class BalanceEngineController {
  constructor(private readonly balanceEngineService: BalanceEngineService) {}

  @Post('generate')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'create', 'leave_policies')
  @ApiOperation({ summary: 'Generate leave balances for a year' })
  async generate(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: GenerateBalancesDto,
  ) {
    const data = await this.balanceEngineService.generateBalancesForYear(
      tenant.schemaName,
      dto.year,
      { userId: dto.userId, dryRun: dto.dryRun ?? false, auditUserId: userId },
    );
    return { success: true, data };
  }

  @Get('users')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'leave_policies')
  @ApiOperation({ summary: 'List users for admin balance adjustment' })
  async listUsers(@TenantContext() tenant: TenantInfo) {
    const data = await this.balanceEngineService.getUsersForBalance(tenant.schemaName);
    return { success: true, data };
  }

  @Get('status')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'leave_policies')
  @ApiOperation({ summary: 'Get balance generation status for a year' })
  async status(
    @TenantContext() tenant: TenantInfo,
    @Query('year') year: string,
  ) {
    const y = parseInt(year ?? '0', 10);
    if (!year || !Number.isFinite(y) || y < 2020 || y > 2099) {
      throw new BadRequestException('Query parameter year is required and must be between 2020 and 2099');
    }
    const data = await this.balanceEngineService.getBalanceStatus(tenant.schemaName, y);
    return { success: true, data };
  }

  @Get('list')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'view', 'leave_policies')
  @ApiOperation({ summary: 'List all users with leave balances for a year (admin grid)' })
  async list(
    @TenantContext() tenant: TenantInfo,
    @Query('year') year: string,
  ) {
    const y = parseInt(year ?? '0', 10);
    if (!year || !Number.isFinite(y) || y < 2020 || y > 2099) {
      throw new BadRequestException('Query parameter year is required and must be between 2020 and 2099');
    }
    const data = await this.balanceEngineService.listBalancesForAdmin(tenant.schemaName, y);
    return { success: true, data };
  }

  @Put('set')
  @UseGuards(PermissionGuard)
  @RequirePermission('leave', 'edit', 'leave_policies')
  @ApiOperation({ summary: 'Set leave balance for a user (admin)' })
  async setBalance(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: SetBalanceDto,
  ) {
    const data = await this.balanceEngineService.setBalance(
      tenant.schemaName,
      {
        userId: dto.userId,
        leaveTypeId: dto.leaveTypeId,
        year: dto.year,
        totalAllocated: dto.totalAllocated,
      },
      userId,
    );
    return { success: true, data };
  }
}
