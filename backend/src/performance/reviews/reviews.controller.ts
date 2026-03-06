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
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ParseUUIDPipe } from '@nestjs/common/pipes';
import { ReviewsService } from './reviews.service';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantInfo } from '../../tenant/tenant.interface';
import { CreateReviewDto, SubmitReviewDto } from './dto';

@ApiTags('Reviews')
@ApiBearerAuth()
@Controller('performance/reviews')
@UseGuards(TenantAuthGuard)
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('performance', 'view', 'reviews')
  @ApiOperation({ summary: 'List reviews' })
  async list(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Query('cycleId') cycleId?: string,
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    const result = await this.reviewsService.list(tenant, userId, roles ?? [], {
      cycleId,
      status,
      page,
      limit,
      sortBy,
      sortOrder,
    });
    return { success: true, ...result };
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission('performance', 'create', 'reviews')
  @ApiOperation({ summary: 'Create review (manual)' })
  async create(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateReviewDto,
  ) {
    const data = await this.reviewsService.create(tenant, userId, dto);
    return { success: true, data };
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission('performance', 'view', 'reviews')
  @ApiOperation({ summary: 'Get review by id' })
  async findOne(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.reviewsService.findOne(tenant, userId, roles ?? [], id);
    return { success: true, data };
  }

  @Put(':id/submit')
  @UseGuards(PermissionGuard)
  @RequirePermission('performance', 'create', 'reviews')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit review' })
  async submit(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitReviewDto,
  ) {
    const data = await this.reviewsService.submit(
      tenant,
      userId,
      roles ?? [],
      id,
      dto,
    );
    return { success: true, data };
  }

  @Put(':id/acknowledge')
  @UseGuards(PermissionGuard)
  @RequirePermission('performance', 'view', 'reviews')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Acknowledge review (employee)' })
  async acknowledge(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.reviewsService.acknowledge(
      tenant,
      userId,
      roles ?? [],
      id,
    );
    return { success: true, data };
  }
}
