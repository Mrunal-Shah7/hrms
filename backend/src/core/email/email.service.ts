import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformEmailService } from './platform-email.service';
import { SmtpEmailProvider } from './providers/smtp.provider';
import type { SmtpConfig } from './email.interface';

@Injectable()
export class EmailService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly platformEmail: PlatformEmailService,
  ) {}

  async send(
    to: string,
    subject: string,
    htmlBody: string,
    schemaName: string,
  ): Promise<void> {
    const provider = await this.getProviderForTenant(schemaName);
    await provider.send(to, subject, htmlBody);
  }

  private async getProviderForTenant(schemaName: string): Promise<SmtpEmailProvider> {
    const rows = (await this.prisma.withTenantSchema(schemaName, async (tx) => {
      return tx.$queryRawUnsafe<
        Array<{ provider: string; config: unknown; from_email: string; from_name: string; is_active: boolean }>
      >(
        `SELECT provider, config, from_email, from_name, is_active
         FROM email_config WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 1`,
      );
    })) as Array<{ provider: string; config: unknown; from_email: string; from_name: string; is_active: boolean }>;

    if (rows.length === 0) {
      return this.getPlatformFallbackProvider();
    }

    const r = rows[0];
    if (r.provider === 'smtp') {
      const cfg = r.config as { host?: string; port?: number; secure?: boolean; user?: string; pass?: string };
      const config: SmtpConfig = {
        host: cfg?.host ?? this.config.get<string>('MAIL_HOST', 'localhost'),
        port: cfg?.port ?? parseInt(this.config.get<string>('MAIL_PORT', '587'), 10),
        secure: cfg?.secure ?? false,
        user: cfg?.user,
        pass: cfg?.pass,
        from: `"${r.from_name}" <${r.from_email}>`,
      };
      return new SmtpEmailProvider(config);
    }

    return this.getPlatformFallbackProvider();
  }

  private getPlatformFallbackProvider(): SmtpEmailProvider {
    const from = this.config.get<string>('MAIL_FROM', 'noreply@hrms.local');
    const config: SmtpConfig = {
      host: this.config.get<string>('MAIL_HOST', 'localhost'),
      port: parseInt(this.config.get<string>('MAIL_PORT', '587'), 10),
      secure: this.config.get<string>('MAIL_SECURE') === 'true',
      user: this.config.get<string>('MAIL_USER'),
      pass: this.config.get<string>('MAIL_PASSWORD'),
      from: `"HRMS Platform" <${from}>`,
    };
    return new SmtpEmailProvider(config);
  }
}
