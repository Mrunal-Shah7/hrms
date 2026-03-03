// TODO: Migrate to template engine (Handlebars/Mjml) in future sprint

const BRAND_COLOR = '#011552';

export function buildWelcomeEmailHtml(params: {
  adminName: string;
  organizationName: string;
  loginUrl: string;
  username?: string;
  temporaryPassword?: string;
}): string {
  const { adminName, organizationName, loginUrl, username, temporaryPassword } = params;
  return `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: ${BRAND_COLOR}; margin-bottom: 16px;">Welcome to HRMS Platform!</h2>
      <p>Hi ${adminName},</p>
      <p><strong>${organizationName}</strong> is now set up and ready to use.</p>
      <p><strong>Login URL:</strong> <a href="${loginUrl}">${loginUrl}</a></p>
      ${username ? `<p><strong>Username:</strong> ${username}</p>` : ''}
      ${temporaryPassword ? `<p><strong>Temporary Password:</strong> <code style="background: #f4f4f5; padding: 2px 6px; border-radius: 4px;">${temporaryPassword}</code></p>` : ''}
      <p style="color: #71717a; font-size: 14px;">You'll be asked to set a new password on your first login.</p>
      <div style="margin: 24px 0;">
        <a href="${loginUrl}" style="display: inline-block; background: ${BRAND_COLOR}; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">Go to Login</a>
      </div>
    </div>
  `;
}
