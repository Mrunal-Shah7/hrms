import {
  Controller,
  Get,
  Post,
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
import { PlatformRegistrationsService } from './platform-registrations.service';
import { ListRegistrationsQueryDto } from './dto';

@ApiTags('Platform')
@Controller('platform/registrations')
@UseGuards(PlatformAuthGuard)
@ApiBearerAuth()
export class PlatformRegistrationsController {
  constructor(
    private readonly registrationsService: PlatformRegistrationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List registration requests with filters' })
  @ApiResponse({ status: 200, description: 'Paginated registration list' })
  async list(@Query() query: ListRegistrationsQueryDto) {
    const result = await this.registrationsService.list(query);
    return { success: true, ...result };
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry failed provisioning' })
  @ApiResponse({ status: 200, description: 'Provisioning retry successful' })
  @ApiResponse({ status: 400, description: 'Only failed registrations can be retried or provisioning failed' })
  @ApiResponse({ status: 404, description: 'Registration not found' })
  async retry(@Param('id') id: string) {
    const data = await this.registrationsService.retry(id);
    return { success: true, data };
  }

  @Post(':id/resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend verification email for pending registration' })
  @ApiResponse({ status: 200, description: 'Verification email resent' })
  @ApiResponse({ status: 400, description: 'Only pending registrations can resend' })
  @ApiResponse({ status: 404, description: 'Registration not found' })
  async resendVerification(@Param('id') id: string) {
    const data = await this.registrationsService.resendVerification(id);
    return { success: true, data };
  }
}
