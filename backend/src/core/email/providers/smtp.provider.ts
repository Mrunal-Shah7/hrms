import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { IEmailProvider, EmailOptions, SmtpConfig } from '../email.interface';

@Injectable()
export class SmtpEmailProvider implements IEmailProvider {
  private transporter: nodemailer.Transporter;
  private fromAddress: string;

  constructor(config: SmtpConfig) {
    this.fromAddress = config.from;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
    });
  }

  async send(
    to: string,
    subject: string,
    htmlBody: string,
    options?: EmailOptions,
  ): Promise<void> {
    const mailOptions: nodemailer.SendMailOptions = {
      from: this.fromAddress,
      to,
      subject,
      html: htmlBody,
      cc: options?.cc,
      bcc: options?.bcc,
      replyTo: options?.replyTo,
      attachments: options?.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    };
    await this.transporter.sendMail(mailOptions);
  }

  async sendBulk(
    recipients: string[],
    subject: string,
    htmlBody: string,
    options?: EmailOptions,
  ): Promise<void> {
    for (const to of recipients) {
      await this.send(to, subject, htmlBody, options);
    }
  }

}
