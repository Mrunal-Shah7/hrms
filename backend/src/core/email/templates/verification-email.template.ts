// TODO: Migrate to template engine (Handlebars/Mjml) in future sprint

const BRAND_COLOR = '#011552';

export function buildVerificationEmailHtml(params: {
  adminName: string;
  organizationName: string;
  verifyUrl: string;
}): string {
  const { adminName, organizationName, verifyUrl } = params;
  return `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: ${BRAND_COLOR}; margin-bottom: 16px;">Verify your email</h2>
      <p>Hi ${adminName},</p>
      <p>You registered <strong>${organizationName}</strong> on the HRMS Platform. Click the button below to verify your email and activate your organization.</p>
      <div style="margin: 24px 0;">
        <a href="${verifyUrl}" style="display: inline-block; background: ${BRAND_COLOR}; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">Verify Email Address</a>
      </div>
      <p style="font-size: 14px; color: #71717a;">Or copy this link: <a href="${verifyUrl}">${verifyUrl}</a></p>
      <p style="color: #71717a; font-size: 14px;">This link expires in 24 hours.</p>
    </div>
  `;
}
