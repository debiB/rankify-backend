import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Test script to check campaign keywords and update them for testing
 */
async function testCampaignKeywords() {
  try {
    console.log('🔍 Checking campaign keywords...\n');

    // Get the test campaign
    const campaign = await prisma.campaign.findFirst({
      where: {
        googleAccount: {
          isActive: true
        }
      },
      include: {
        googleAccount: true
      }
    });

    if (!campaign) {
      console.log('❌ No active campaign found');
      return;
    }

    console.log(`📊 Campaign: ${campaign.name} (${campaign.id})`);
    console.log(`🔗 Search Console Site: ${campaign.searchConsoleSite}`);
    
    // Show current keywords
    const currentKeywords = campaign.keywords
      .split('\n')
      .map((k: string) => k.trim())
      .filter((k: string) => k.length > 0);
    
    console.log(`\n📝 Current keywords (${currentKeywords.length}):`);
    currentKeywords.forEach((keyword, index) => {
      console.log(`  ${index + 1}. "${keyword}"`);
    });

    // Update keywords to include Hebrew drone keywords for testing
    const hebrewDroneKeywords = [
      'רחפן',
      'רחפנים', 
      'רחפן לילדים',
      'רחפנים מקצועיים',
      'דרונקס',
      'רחפנים למכירה יד 2'
    ];

    console.log(`\n🔄 Updating campaign keywords to include Hebrew drone keywords...`);
    
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        keywords: hebrewDroneKeywords.join('\n')
      }
    });

    console.log(`✅ Updated campaign keywords:`);
    hebrewDroneKeywords.forEach((keyword, index) => {
      console.log(`  ${index + 1}. "${keyword}"`);
    });

    console.log(`\n🎯 Campaign is now ready for cannibalization testing with matching keywords!`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testCampaignKeywords().catch(console.error);
