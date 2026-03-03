import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmtpEmailProvider } from './providers/smtp.provider';
import type { SmtpConfig } from './email.interface';

@Injectable()
export class PlatformEmailService {
  private readonly provider: SmtpEmailProvider;

  constructor(private readonly configService: ConfigService) {
    const from = this.configService.get<string>('MAIL_FROM', 'noreply@hrms.local');
    const smtpConfig: SmtpConfig = {
      host: this.configService.get<string>('MAIL_HOST', 'localhost'),
      port: parseInt(this.configService.get<string>('MAIL_PORT', '587'), 10),
      secure: this.configService.get<string>('MAIL_SECURE') === 'true',
      user: this.configService.get<string>('MAIL_USER'),
      pass: this.configService.get<string>('MAIL_PASSWORD'),
      from: `"HRMS Platform" <${from}>`,
    };
    this.provider = new SmtpEmailProvider(smtpConfig);
  }

  async send(to: string, subject: string, htmlBody: string): Promise<void> {
    await this.provider.send(to, subject, htmlBody);
  }

  async sendBulk(recipients: string[], subject: string, htmlBody: string): Promise<void> {
    await this.provider.sendBulk(recipients, subject, htmlBody);
  }
}
