import { sendTestEmail } from '../utils/email';

async function sendTestEmailToAddress() {
  try {
    const email = 'deborahberhau644@gmail.com';
    console.log(`Sending test email to ${email}...`);
    const result = await sendTestEmail(email);
    console.log('✅ Test email sent successfully!', result);
  } catch (error) {
    console.error('❌ Error sending test email:', error);
  }
}

// Run the test
void sendTestEmailToAddress();
