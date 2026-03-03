import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { buildNotificationEmailHtml } from '../email/templates/notification-email.template';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async create(
    userId: string,
    type: string,
    title: string,
    message: string,
    schemaName: string,
    data?: Record<string, unknown>,
  ): Promise<string> {
    const settings = await this.getNotificationSettings(schemaName, type);
    if (!settings.inAppEnabled && !settings.emailEnabled) {
      this.logger.warn(`Notification type ${type} is disabled`);
      return '';
    }

    let notificationId = '';
    if (settings.inAppEnabled) {
      const rows = (await this.prisma.withTenantSchema(schemaName, async (tx) => {
        return tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO notifications (id, user_id, type, title, message, data, is_read, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, FALSE, NOW())
           RETURNING id`,
          userId,
          type,
          title,
          message,
          data ? JSON.stringify(data) : '{}',
        );
      })) as { id: string }[];
      notificationId = rows[0]?.id ?? '';
    }

    if (settings.emailEnabled) {
      const userRows = (await this.prisma.withTenantSchema(schemaName, async (tx) => {
        return tx.$queryRawUnsafe<{ email: string }[]>(
          `SELECT email FROM users WHERE id = $1`,
          userId,
        );
      })) as { email: string }[];
      if (userRows.length > 0) {
        try {
          const html = buildNotificationEmailHtml({ title, message });
          await this.emailService.send(
            userRows[0].email,
            title,
            html,
            schemaName,
          );
        } catch (err) {
          this.logger.warn(`Failed to send notification email: ${(err as Error).message}`);
        }
      }
    }

    return notificationId;
  }

  async findAll(
    userId: string,
    schemaName: string,
    page: number,
    limit: number,
    unreadOnly?: boolean,
  ) {
    const offset = (page - 1) * limit;
    const whereClause = unreadOnly
      ? `WHERE user_id = $1 AND is_read = FALSE`
      : `WHERE user_id = $1`;

    const rows = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{ id: string; type: string; title: string; message: string; data: unknown; is_read: boolean; created_at: Date }>
      >(
        `SELECT id, type, title, message, data, is_read, created_at
         FROM notifications ${whereClause}
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        userId,
        limit,
        offset,
      );
    });

    const countResult = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<{ count: string }[]>(
        `SELECT COUNT(*)::text as count FROM notifications ${whereClause}`,
        userId,
      );
    });

    const total = parseInt(countResult[0]?.count ?? '0', 10);
    const totalPages = Math.ceil(total / limit);

    return {
      data: rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        message: r.message,
        data: r.data,
        isRead: r.is_read,
        createdAt: r.created_at,
      })),
      meta: { page, limit, total, totalPages },
    };
  }

  async markAsRead(notificationId: string, userId: string, schemaName: string): Promise<void> {
    const result = await this.prisma.withTenantSchema(schemaName, async (tx) => {
      const rows = await tx.$queryRawUnsafe<{ n: number }[]>(
        `UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING 1`,
        notificationId,
        userId,
      );
      return rows.length;
    });
    if (result === 0) throw new NotFoundException('Notification not found');
  }

  async markAllAsRead(userId: string, schemaName: string): Promise<void> {
    await this.prisma.withTenantSchema(schemaName, async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE notifications SET is_read = TRUE WHERE user_id = $1`,
        userId,
      );
    });
  }

  async getUnreadCount(userId: string, schemaName: string): Promise<number> {
    const rows = (await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<{ count: string }[]>(
        `SELECT COUNT(*)::text as count FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
        userId,
      );
    })) as { count: string }[];
    return parseInt(rows[0]?.count ?? '0', 10);
  }

  private async getNotificationSettings(
    schemaName: string,
    type: string,
  ): Promise<{ inAppEnabled: boolean; emailEnabled: boolean }> {
    const rows = (await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{ in_app_enabled: boolean; email_enabled: boolean }>
      >(
        `SELECT in_app_enabled, email_enabled FROM notification_settings WHERE notification_type = $1`,
        type,
      );
    })) as Array<{ in_app_enabled: boolean; email_enabled: boolean }>;
    if (rows.length === 0) {
      return { inAppEnabled: true, emailEnabled: true };
    }
    return {
      inAppEnabled: rows[0].in_app_enabled,
      emailEnabled: rows[0].email_enabled,
    };
  }
}
