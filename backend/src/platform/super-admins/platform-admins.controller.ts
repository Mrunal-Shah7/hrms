import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { PlatformAuthGuard } from '../platform-auth/guards/platform-auth.guard';
import { PlatformAdminsService } from './platform-admins.service';
import { CreateAdminDto, UpdateAdminDto } from './dto';

interface PlatformRequest {
  user: { superAdminId: string; type: string };
}

@ApiTags('Platform')
@Controller('platform/admins')
@UseGuards(PlatformAuthGuard)
@ApiBearerAuth()
export class PlatformAdminsController {
  constructor(private readonly adminsService: PlatformAdminsService) {}

  @Get()
  @ApiOperation({ summary: 'List all super admins' })
  @ApiResponse({ status: 200, description: 'List of super admins' })
  async list() {
    const data = await this.adminsService.list();
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new super admin' })
  @ApiResponse({ status: 201, description: 'Super admin created, welcome email sent' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  async create(@Body() dto: CreateAdminDto) {
    const data = await this.adminsService.create(dto);
    return { success: true, data };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update super admin' })
  @ApiResponse({ status: 200, description: 'Updated super admin' })
  @ApiResponse({ status: 400, description: 'Cannot deactivate self or last active admin' })
  @ApiResponse({ status: 404, description: 'Super admin not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAdminDto,
    @Request() req: PlatformRequest,
  ) {
    const data = await this.adminsService.update(
      id,
      dto,
      req.user.superAdminId,
    );
    return { success: true, data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate super admin (soft)' })
  @ApiResponse({ status: 200, description: 'Super admin deactivated' })
  @ApiResponse({ status: 400, description: 'Cannot deactivate self or last active admin' })
  @ApiResponse({ status: 404, description: 'Super admin not found' })
  async deactivate(
    @Param('id') id: string,
    @Request() req: PlatformRequest,
  ) {
    const data = await this.adminsService.deactivate(id, req.user.superAdminId);
    return { success: true, data };
  }
}
