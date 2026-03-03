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
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { PlatformAuthGuard } from '../platform-auth/guards/platform-auth.guard';
import { PlatformTenantsService } from './platform-tenants.service';
import { CreateTenantDto, UpdateTenantDto, ListTenantsQueryDto } from './dto';

@ApiTags('Platform')
@Controller('platform/tenants')
@UseGuards(PlatformAuthGuard)
@ApiBearerAuth()
export class PlatformTenantsController {
  constructor(private readonly tenantsService: PlatformTenantsService) {}

  @Get()
  @ApiOperation({ summary: 'List tenants with filters and pagination' })
  @ApiResponse({ status: 200, description: 'Paginated tenant list' })
  async list(@Query() query: ListTenantsQueryDto) {
    const result = await this.tenantsService.list(query);
    return { success: true, ...result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get tenant detail by ID' })
  @ApiResponse({ status: 200, description: 'Tenant detail with usage, admin, billing' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async getById(@Param('id') id: string) {
    const data = await this.tenantsService.getById(id);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create and provision a new tenant' })
  @ApiResponse({ status: 201, description: 'Tenant provisioned, welcome email sent' })
  @ApiResponse({ status: 409, description: 'Slug already taken' })
  async create(@Body() dto: CreateTenantDto) {
    const data = await this.tenantsService.create(dto);
    return { success: true, data };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update tenant' })
  @ApiResponse({ status: 200, description: 'Updated tenant' })
  @ApiResponse({ status: 400, description: 'Validation error (e.g. max users below current)' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  @ApiResponse({ status: 409, description: 'Custom domain already in use' })
  async update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    const data = await this.tenantsService.update(id, dto);
    return { success: true, data };
  }

  @Put(':id/suspend')
  @ApiOperation({ summary: 'Suspend tenant' })
  @ApiResponse({ status: 200, description: 'Tenant suspended' })
  @ApiResponse({ status: 400, description: 'Already suspended or cancelled' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async suspend(@Param('id') id: string) {
    const data = await this.tenantsService.suspend(id);
    return { success: true, data };
  }

  @Put(':id/reactivate')
  @ApiOperation({ summary: 'Reactivate suspended tenant' })
  @ApiResponse({ status: 200, description: 'Tenant reactivated' })
  @ApiResponse({ status: 400, description: 'Only suspended tenants can be reactivated' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async reactivate(@Param('id') id: string) {
    const data = await this.tenantsService.reactivate(id);
    return { success: true, data };
  }

  @Put(':id/cancel')
  @ApiOperation({ summary: 'Cancel tenant (soft cancel, data preserved)' })
  @ApiResponse({ status: 200, description: 'Tenant cancelled' })
  @ApiResponse({ status: 400, description: 'Already cancelled' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async cancel(@Param('id') id: string) {
    const data = await this.tenantsService.cancel(id);
    return { success: true, data };
  }
}
