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
import { PlatformBillingService } from './platform-billing.service';
import {
  ListBillingQueryDto,
  GenerateBillingDto,
  UpdateBillingStatusDto,
} from './dto';

@ApiTags('Platform')
@Controller('platform/billing')
@UseGuards(PlatformAuthGuard)
@ApiBearerAuth()
export class PlatformBillingController {
  constructor(private readonly billingService: PlatformBillingService) {}

  @Get()
  @ApiOperation({ summary: 'List billing records with filters and pagination' })
  @ApiResponse({ status: 200, description: 'Paginated billing list' })
  async list(@Query() query: ListBillingQueryDto) {
    const result = await this.billingService.list(query);
    return { success: true, ...result };
  }

  @Post('generate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate a new billing record' })
  @ApiResponse({ status: 201, description: 'Billing record created' })
  @ApiResponse({ status: 400, description: 'Invalid period or tenant cancelled' })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  @ApiResponse({ status: 409, description: 'Billing record already exists for period' })
  async generate(@Body() dto: GenerateBillingDto) {
    const data = await this.billingService.generate(dto);
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get billing record by ID' })
  @ApiResponse({ status: 200, description: 'Billing record detail' })
  @ApiResponse({ status: 404, description: 'Billing record not found' })
  async getById(@Param('id') id: string) {
    const data = await this.billingService.getById(id);
    return { success: true, data };
  }

  @Put(':id/status')
  @ApiOperation({ summary: 'Update billing record status (paid/overdue)' })
  @ApiResponse({ status: 200, description: 'Status updated' })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  @ApiResponse({ status: 404, description: 'Billing record not found' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateBillingStatusDto,
  ) {
    const data = await this.billingService.updateStatus(id, dto);
    return { success: true, data };
  }
}
