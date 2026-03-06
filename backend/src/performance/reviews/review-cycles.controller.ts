import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ParseUUIDPipe } from '@nestjs/common/pipes';
import { ReviewCyclesService } from './review-cycles.service';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantInfo } from '../../tenant/tenant.interface';
import { CreateCycleDto, UpdateCycleDto } from './dto';

@ApiTags('Review Cycles')
@ApiBearerAuth()
@Controller('performance/review-cycles')
@UseGuards(TenantAuthGuard)
export class ReviewCyclesController {
  constructor(private readonly reviewCyclesService: ReviewCyclesService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('performance', 'view', 'review_cycles')
  @ApiOperation({ summary: 'List review cycles' })
  async list(
    @TenantContext() tenant: TenantInfo,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    const result = await this.reviewCyclesService.list(tenant, {
      page,
      limit,
      status,
      sortBy,
      sortOrder,
    });
    return { success: true, ...result };
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission('performance', 'create', 'review_cycles')
  @ApiOperation({ summary: 'Create review cycle' })
  async create(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateCycleDto,
  ) {
    const data = await this.reviewCyclesService.create(tenant, userId, dto);
    return { success: true, data };
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('performance', 'view', 'review_cycles')
  @ApiOperation({ summary: 'Get review cycle by id' })
  async findOne(
    @TenantContext() tenant: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.reviewCyclesService.findOne(tenant, id);
    return { success: true, data };
  }

  @Put(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('performance', 'edit', 'review_cycles')
  @ApiOperation({ summary: 'Update review cycle' })
  async update(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCycleDto,
  ) {
    const data = await this.reviewCyclesService.update(tenant, userId, id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('performance', 'edit', 'review_cycles')
  @ApiOperation({ summary: 'Delete review cycle (draft only)' })
  async remove(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.reviewCyclesService.remove(tenant, userId, id);
    return { success: true, ...result };
  }
}
