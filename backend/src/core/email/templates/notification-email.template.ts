// TODO: Migrate to template engine (Handlebars/Mjml) in future sprint

const BRAND_COLOR = '#011552';

export function buildNotificationEmailHtml(params: {
  title: string;
  message: string;
  actionUrl?: string;
  actionText?: string;
}): string {
  const { title, message, actionUrl, actionText } = params;
  return `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: ${BRAND_COLOR}; margin-bottom: 16px;">${title}</h2>
      <p>${message}</p>
      ${actionUrl && actionText ? `
        <div style="margin: 24px 0;">
          <a href="${actionUrl}" style="display: inline-block; background: ${BRAND_COLOR}; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">${actionText}</a>
        </div>
      ` : ''}
    </div>
  `;
}
