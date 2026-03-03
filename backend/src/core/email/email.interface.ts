export interface EmailOptions {
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}

export interface IEmailProvider {
  send(
    to: string,
    subject: string,
    htmlBody: string,
    options?: EmailOptions,
  ): Promise<void>;
  sendBulk(
    recipients: string[],
    subject: string,
    htmlBody: string,
    options?: EmailOptions,
  ): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}
