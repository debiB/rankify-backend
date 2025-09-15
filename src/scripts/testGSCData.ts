import { PrismaClient } from '@prisma/client';
import { SearchConsoleService } from '../services/searchConsole';
import moment from 'moment-timezone';

const prisma = new PrismaClient();
const searchConsoleService = new SearchConsoleService();

/**
 * Test script to examine Google Search Console API data structure
 * This will help us understand what data is actually returned from GSC
 */
async function testGSCData() {
  try {
    console.log('🔍 Testing Google Search Console API data retrieval...\n');

    // Get the first active campaign with a Google account
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
      console.log('❌ No active campaign with Google account found');
      return;
    }

    if (!campaign.googleAccount) {
      console.log('❌ No Google account associated with campaign');
      return;
    }

    console.log(`📊 Testing with campaign: ${campaign.name}`);
    console.log(`🔗 Search Console Site: ${campaign.searchConsoleSite}`);
    console.log(`👤 Google Account: ${campaign.googleAccount.email}\n`);

    // Test 1: Get basic keyword data (last 7 days)
    console.log('=== TEST 1: Basic Keyword Data (Last 7 Days) ===');
    const endDate = moment().subtract(3, 'days'); // GSC has 3-day delay
    const startDate = endDate.clone().subtract(7, 'days');
    
    console.log(`📅 Date range: ${startDate.format('YYYY-MM-DD')} to ${endDate.format('YYYY-MM-DD')}`);

    const basicData = await searchConsoleService.getAnalytics({
      campaign,
      googleAccount: campaign.googleAccount,
      startAt: startDate,
      endAt: endDate,
      dimensions: ['query'],
      waitForAllData: false
    });

    if (basicData && basicData.length > 0) {
      console.log(`✅ Retrieved ${basicData.length} keyword rows`);
      console.log('\n📝 Sample basic data structure:');
      console.log(JSON.stringify(basicData.slice(0, 3), null, 2));
    } else {
      console.log('❌ No basic keyword data returned');
    }

    // Test 2: Get keyword + page data (what cannibalization service uses)
    console.log('\n=== TEST 2: Keyword + Page Data (Cannibalization Format) ===');
    
    const keywordPageData = await searchConsoleService.getAnalytics({
      campaign,
      googleAccount: campaign.googleAccount,
      startAt: startDate,
      endAt: endDate,
      dimensions: ['query', 'page'],
      waitForAllData: false
    });

    if (keywordPageData && keywordPageData.length > 0) {
      console.log(`✅ Retrieved ${keywordPageData.length} keyword-page combination rows`);
      console.log('\n📝 Sample keyword-page data structure:');
      console.log(JSON.stringify(keywordPageData.slice(0, 3), null, 2));
      
      // Analyze the data structure
      console.log('\n🔍 Data Structure Analysis:');
      const sampleRow = keywordPageData[0];
      console.log('Keys structure:', sampleRow.keys);
      console.log('Available metrics:', {
        impressions: sampleRow.impressions,
        clicks: sampleRow.clicks,
        ctr: sampleRow.ctr,
        position: sampleRow.position
      });

      // Find keywords with multiple pages (potential cannibalization)
      const keywordGroups = new Map<string, any[]>();
      keywordPageData.forEach(row => {
        if (row.keys && row.keys.length >= 2) {
          const keyword = row.keys[0];
          if (!keywordGroups.has(keyword)) {
            keywordGroups.set(keyword, []);
          }
          keywordGroups.get(keyword)!.push(row);
        }
      });

      const multiPageKeywords = Array.from(keywordGroups.entries())
        .filter(([_, pages]) => pages.length > 1)
        .slice(0, 5);

      if (multiPageKeywords.length > 0) {
        console.log('\n🎯 Sample keywords with multiple pages (potential cannibalization):');
        multiPageKeywords.forEach(([keyword, pages]) => {
          console.log(`\nKeyword: "${keyword}" (${pages.length} pages)`);
          pages.forEach((page, index) => {
            console.log(`  Page ${index + 1}: ${page.keys[1]} - ${page.impressions} impressions`);
          });
        });
      } else {
        console.log('\n📝 No keywords found with multiple pages in this sample');
      }

    } else {
      console.log('❌ No keyword-page data returned');
    }

    // Test 3: Test with different date ranges
    console.log('\n=== TEST 3: Different Date Ranges ===');
    
    // Last 30 days
    const thirtyDaysData = await searchConsoleService.getAnalytics({
      campaign,
      googleAccount: campaign.googleAccount,
      startAt: endDate.clone().subtract(30, 'days'),
      endAt: endDate,
      dimensions: ['query', 'page'],
      waitForAllData: false
    });

    console.log(`📊 Last 30 days: ${thirtyDaysData?.length || 0} rows`);

    // Last 90 days (initial audit period)
    const ninetyDaysData = await searchConsoleService.getAnalytics({
      campaign,
      googleAccount: campaign.googleAccount,
      startAt: endDate.clone().subtract(90, 'days'),
      endAt: endDate,
      dimensions: ['query', 'page'],
      waitForAllData: false
    });

    console.log(`📊 Last 90 days: ${ninetyDaysData?.length || 0} rows`);

    console.log('\n✅ GSC API test completed successfully!');

  } catch (error) {
    console.error('❌ Error testing GSC API:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testGSCData().catch(console.error);
