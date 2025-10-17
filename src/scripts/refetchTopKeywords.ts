import { prisma } from '../utils/prisma';

/**
 * Script to clear and refetch top keywords data
 * This fixes the issue where dates were stored instead of keywords
 */
async function refetchTopKeywords() {
  try {
    console.log('🚀 Starting top keywords data cleanup...');

    // Get all campaigns
    const campaigns = await prisma.campaign.findMany({
      select: {
        id: true,
        name: true,
      },
    });

    console.log(`📊 Found ${campaigns.length} campaigns`);

    // Delete all TopKeywordData entries
    const deleteResult = await prisma.topKeywordData.deleteMany({});
    
    console.log(`🗑️  Deleted ${deleteResult.count} old top keyword entries`);
    console.log('✅ Cleanup complete!');
    console.log('');
    console.log('📝 Next steps:');
    console.log('   1. Refresh your dashboard');
    console.log('   2. The data will be automatically refetched from GSC with the correct keywords');
    console.log('   3. Or wait for the daily cron job at 7:00 AM UTC to refetch automatically');

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
refetchTopKeywords()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
