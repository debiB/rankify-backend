import { prisma } from '../utils/prisma';
import { WhatsAppService } from '../services/whatsappService';
import { MilestoneService } from '../services/milestoneService';
import { sendTestEmail } from '../utils/email';

async function testWhatsAppMessage() {
  try {
    console.log('Testing WhatsApp message sending...');
    const whatsappService = new WhatsAppService();
    // Replace with a valid WhatsApp group ID from your database
    const testGroup = await prisma.whatsAppGroup.findFirst();
    
    if (!testGroup) {
      console.error('No WhatsApp groups found in the database. Please add a group first.');
      return;
    }

    const testMessage = whatsappService.formatMilestoneMessage(
      'Test Campaign',
      'Position Milestone',
      1,
      'test keyword',
      'https://rankify.com/dashboard',
      new Date()
    );

    const response = await whatsappService.sendMessage(testGroup.groupId, testMessage);
    console.log('✅ WhatsApp test message sent successfully!', response);
  } catch (error) {
    console.error('❌ Error sending WhatsApp test message:', error);
  }
}

async function testEmail() {
  try {
    console.log('\nTesting email sending...');
    // Replace with a valid email from your database
    const testUser = await prisma.user.findFirst();
    
    if (!testUser) {
      console.error('No users found in the database. Please add a user first.');
      return;
    }

    const result = await sendTestEmail(testUser.email);
    console.log('✅ Test email sent successfully!', result);
  } catch (error) {
    console.error('❌ Error sending test email:', error);
  }
}

async function testMilestoneCheck() {
  try {
    console.log('\nTesting milestone check...');
    const milestoneService = new MilestoneService();
    
    // Get an active campaign
    const campaign = await prisma.campaign.findFirst({
      where: { status: 'ACTIVE' }
    });

    if (!campaign) {
      console.error('No active campaigns found.');
      return;
    }

    console.log(`Running milestone check for campaign: ${campaign.name}`);
    const result = await milestoneService.checkCampaignMilestones(campaign.id);
    console.log('✅ Milestone check completed!', result);
  } catch (error) {
    console.error('❌ Error running milestone check:', error);
  }
}

async function runTests() {
  console.log('🚀 Starting notification system tests...');
  
  // Test WhatsApp message
  await testWhatsAppMessage();
  
  // Test email
  await testEmail();
  
  // Test milestone check (this will send actual notifications if conditions are met)
  console.log('\n⚠️  Note: The milestone check will send actual notifications if conditions are met.');
  await testMilestoneCheck();
  
  console.log('\n✅ All tests completed!');
  await prisma.$disconnect();
}

// Run the tests
runTests().catch(console.error);
