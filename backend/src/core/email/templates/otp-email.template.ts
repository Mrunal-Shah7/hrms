// TODO: Migrate to template engine (Handlebars/Mjml) in future sprint

const BRAND_COLOR = '#011552';

export function buildOtpEmailHtml(params: {
  recipientName: string;
  otp: string;
  orgName?: string;
  subjectContext?: string;
}): string {
  const { recipientName, otp, orgName = 'HRMS Platform', subjectContext = 'Password Reset' } = params;
  return `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: ${BRAND_COLOR}; margin-bottom: 16px;">${subjectContext}</h2>
      <p>Hi ${recipientName},</p>
      <p>You requested a password reset for your ${orgName} account. Use the OTP below to proceed:</p>
      <div style="background: #f4f4f5; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
        <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: ${BRAND_COLOR};">${otp}</span>
      </div>
      <p style="color: #71717a; font-size: 14px;">This OTP expires in <strong>10 minutes</strong>. If you didn't request this, please ignore this email.</p>
    </div>
  `;
}
