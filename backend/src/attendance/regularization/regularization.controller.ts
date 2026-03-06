import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ParseUUIDPipe } from '@nestjs/common/pipes';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantInfo } from '../../tenant/tenant.interface';
import { RegularizationService } from './regularization.service';
import { CreateRegularizationDto } from './dto/create-regularization.dto';
import { ReviewRegularizationDto } from './dto/review-regularization.dto';

@ApiTags('Attendance - Regularizations')
@ApiBearerAuth()
@Controller('attendance')
@UseGuards(TenantAuthGuard)
export class RegularizationController {
  constructor(private readonly regularizationService: RegularizationService) {}

  @Post('regularize')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('attendance', 'create', 'regularizations')
  @ApiOperation({ summary: 'Request attendance regularization' })
  @ApiResponse({ status: 201, description: 'Request created' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 409, description: 'Pending regularization exists for date' })
  async request(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateRegularizationDto,
  ) {
    const data = await this.regularizationService.request(tenant, userId, dto);
    return { success: true, data };
  }

  @Get('regularizations')
  @UseGuards(PermissionGuard)
  @RequirePermission('attendance', 'create', 'regularizations')
  @ApiOperation({ summary: 'List regularizations (own or all if can approve)' })
  async list(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('permissions') permissions: string[],
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('userId') filterUserId?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    const canApprove = (permissions ?? []).includes('attendance:approve:regularizations');
    const result = await this.regularizationService.list(tenant, userId, canApprove, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      status,
      userId: filterUserId,
      sortBy,
      sortOrder,
    });
    return { success: true, ...result };
  }

  @Get('regularizations/:id')
  @UseGuards(PermissionGuard)
  @ApiOperation({ summary: 'Get regularization detail with existing attendance' })
  async getById(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('permissions') permissions: string[],
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const canApprove = (permissions ?? []).includes('attendance:approve:regularizations');
    const data = await this.regularizationService.getById(tenant, id, userId, canApprove);
    return { success: true, data };
  }

  @Put('regularizations/:id/review')
  @UseGuards(PermissionGuard)
  @RequirePermission('attendance', 'approve', 'regularizations')
  @ApiOperation({ summary: 'Approve or reject regularization' })
  async review(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewRegularizationDto,
  ) {
    const data = await this.regularizationService.review(tenant, userId, id, dto.action);
    return { success: true, data };
  }
}
