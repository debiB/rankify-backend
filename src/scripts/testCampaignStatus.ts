import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Test script to check campaign and Google account status
 */
async function testCampaignStatus() {
  try {
    console.log('🔍 Checking campaign and Google account status...\n');

    // Get all campaigns
    const allCampaigns = await prisma.campaign.findMany({
      include: {
        googleAccount: true
      }
    });

    console.log(`📊 Total campaigns found: ${allCampaigns.length}`);
    
    allCampaigns.forEach((campaign, index) => {
      console.log(`\n${index + 1}. Campaign: ${campaign.name} (${campaign.id})`);
      console.log(`   Google Account: ${campaign.googleAccount?.email || 'None'}`);
      console.log(`   Google Account Active: ${campaign.googleAccount?.isActive || false}`);
      console.log(`   Search Console Site: ${campaign.searchConsoleSite}`);
      console.log(`   Keywords: ${campaign.keywords.split('\n').filter(k => k.trim()).length}`);
    });

    // Get all Google accounts
    const allGoogleAccounts = await prisma.googleAccount.findMany();
    
    console.log(`\n📧 Total Google accounts: ${allGoogleAccounts.length}`);
    allGoogleAccounts.forEach((account, index) => {
      console.log(`${index + 1}. ${account.email} - Active: ${account.isActive}`);
    });

    // Try to activate the first Google account if none are active
    const activeAccount = allGoogleAccounts.find(acc => acc.isActive);
    if (!activeAccount && allGoogleAccounts.length > 0) {
      console.log(`\n🔄 No active Google account found. Activating first account...`);
      await prisma.googleAccount.update({
        where: { id: allGoogleAccounts[0].id },
        data: { isActive: true }
      });
      console.log(`✅ Activated account: ${allGoogleAccounts[0].email}`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testCampaignStatus().catch(console.error);
