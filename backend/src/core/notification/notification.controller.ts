import { Controller, Get, Put, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { TenantContext } from '../../common/decorators/tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantInfo } from '../../tenant/tenant.interface';
import { NotificationQueryDto } from './dto/notification-query.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(TenantAuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'List own notifications (paginated)' })
  async findAll(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Query() query: NotificationQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const unreadOnly = query.unreadOnly === true;
    const result = await this.notificationService.findAll(
      userId,
      tenant.schemaName,
      page,
      limit,
      unreadOnly,
    );
    return { success: true, ...result };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  async getUnreadCount(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
  ) {
    const count = await this.notificationService.getUnreadCount(userId, tenant.schemaName);
    return { success: true, data: { count } };
  }

  @Put('read-all')
  @ApiOperation({ summary: 'Mark all own notifications as read' })
  async markAllAsRead(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
  ) {
    await this.notificationService.markAllAsRead(userId, tenant.schemaName);
    return { success: true, data: { message: 'All notifications marked as read' } };
  }

  @Put(':id/read')
  @ApiOperation({ summary: 'Mark single notification as read' })
  async markAsRead(
    @TenantContext() tenant: TenantInfo,
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    await this.notificationService.markAsRead(id, userId, tenant.schemaName);
    return { success: true, data: { message: 'Notification marked as read' } };
  }
}
