import nodemailer from 'nodemailer';

// Create SMTP transporter using environment variables
const createTransporter = () => {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587');
  const secure = process.env.SMTP_SECURE === 'true'; // true for 465, false for other ports
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    throw new Error(
      'SMTP_USER and SMTP_PASS environment variables are required'
    );
  }

  console.log(
    `Creating SMTP transporter for ${host}:${port} (secure: ${secure})`
  );

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });
};

// Verify SMTP connection
export const verifySMTPConnection = async () => {
  try {
    const transporter = createTransporter();
    await transporter.verify();
    console.log('SMTP connection verified successfully');
    return true;
  } catch (error) {
    console.error('SMTP connection failed:', error);
    return false;
  }
};

export const sendTemporaryPassword = async (
  email: string,
  name: string,
  tempPassword: string
) => {
  try {
    const transporter = createTransporter();

    // Get the frontend URL from environment or default to localhost
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const loginUrl = `${frontendUrl}/login`;

    const mailOptions = {
      from: process.env.SMTP_FROM || '"Rankify Team" <noreply@rankify.com>',
      to: email,
      subject: 'Welcome to Rankify - Your Temporary Password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #8b5cf6;">Welcome to Rankify!</h2>
          <p>Hello ${name},</p>
          <p>Your account has been created successfully. Here are your login credentials:</p>
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Temporary Password:</strong> ${tempPassword}</p>
          </div>
          <p><strong>Important:</strong> You must change your password on your first login for security reasons.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${loginUrl}" style="background-color: #8b5cf6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
              Login to Your Account
            </a>
          </div>
          <p style="text-align: center; color: #666; font-size: 14px;">
            Or copy and paste this link: <a href="${loginUrl}" style="color: #8b5cf6;">${loginUrl}</a>
          </p>
          <p>Best regards,<br>The Rankify Team</p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);

    console.log('Email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error('Failed to send email');
  }
};
