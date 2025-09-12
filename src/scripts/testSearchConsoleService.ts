import { PrismaClient } from '@prisma/client';
import { SearchConsoleService } from '../services/searchConsole';
import moment from 'moment';

const prisma = new PrismaClient();
const searchConsoleService = new SearchConsoleService();

async function testSearchConsoleService() {
  try {
    console.log('Testing updated SearchConsoleService implementation...');
    
    // Get an active campaign and its Google account
    const campaign = await prisma.campaign.findFirst({
      where: { status: 'ACTIVE' },
      include: { googleAccount: true }
    });
    
    if (!campaign || !campaign.googleAccount) {
      console.error('No active campaign with Google account found');
      return;
    }
    
    console.log(`Using campaign: ${campaign.name} (${campaign.id})`);
    console.log(`Search Console site: ${campaign.searchConsoleSite}`);
    
    // Set date range for the last 7 days
    const endAt = moment();
    const startAt = moment().subtract(7, 'days');
    
    console.log(`Fetching data from ${startAt.format('YYYY-MM-DD')} to ${endAt.format('YYYY-MM-DD')}`);
    
    // Test the getAnalytics method with date, query, and page dimensions
    const analytics = await searchConsoleService.getAnalytics({
      campaign,
      googleAccount: campaign.googleAccount,
      startAt,
      endAt,
      dimensions: ['query', 'page']
    });
    
    if (!analytics || analytics.length === 0) {
      console.log('No analytics data found');
      return;
    }
    
    console.log(`Retrieved ${analytics.length} rows of data`);
    
    // Log the first 5 rows to verify the data structure
    console.log('Sample data:');
    analytics.slice(0, 5).forEach((row, index) => {
      console.log(`Row ${index + 1}:`);
      console.log(`  Keys: ${row.keys?.join(', ')}`);
      console.log(`  Clicks: ${row.clicks}`);
      console.log(`  Impressions: ${row.impressions}`);
      console.log(`  CTR: ${row.ctr}`);
      console.log(`  Position: ${row.position}`);
    });
    
    console.log('Test completed successfully');
  } catch (error) {
    console.error('Error testing SearchConsoleService:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testSearchConsoleService();