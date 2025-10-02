import { PrismaClient } from '@prisma/client';
import { KeywordCannibalizationService } from '../services/keywordCannibalization';
import moment from 'moment-timezone';

const prisma = new PrismaClient();
const cannibalizationService = new KeywordCannibalizationService();

/**
 * Test script to examine keyword cannibalization detection and data processing
 * This will show us exactly what the cannibalization service detects and returns
 */
async function testCannibalizationData() {
  try {
    console.log('🔍 Testing Keyword Cannibalization Detection...\n');

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

    console.log(`📊 Testing cannibalization for campaign: ${campaign.name}`);
    console.log(`🔗 Search Console Site: ${campaign.searchConsoleSite}\n`);

    // Test 1: Run a manual audit to see the full process
    console.log('=== TEST 1: Running Manual Cannibalization Audit ===');
    
    try {
      // Use a 30-day date range for the manual audit
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      
      const auditId = await cannibalizationService.runCustomAudit(campaign.id, startDate, endDate);
      console.log(`✅ Audit started with ID: ${auditId}`);
      
      // Wait a moment for the audit to process
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check audit status
      const audit = await (prisma as any).keywordCannibalizationAudit.findUnique({
        where: { id: auditId },
        include: {
          results: {
            include: {
              competingPages: true
            }
          }
        }
      });

      if (audit) {
        console.log(`📊 Audit Status: ${audit.status}`);
        console.log(`📅 Date Range: ${audit.startDate} to ${audit.endDate}`);
        console.log(`🔢 Total Keywords Analyzed: ${audit.totalKeywords || 0}`);
        console.log(`⚠️ Keywords with Cannibalization: ${audit.cannibalizationCount || 0}`);
        
        if (audit.results && audit.results.length > 0) {
          console.log(`\n📝 Sample cannibalization results (first 5):`);
          audit.results.slice(0, 5).forEach((result: any, index: number) => {
            console.log(`\n${index + 1}. Keyword: "${result.keyword}"`);
            console.log(`   Top Page: ${result.topPageUrl}`);
            console.log(`   Top Page Impressions: ${result.topPageImpressions}`);
            console.log(`   Competing Pages: ${result.competingPages.length}`);
            
            result.competingPages.forEach((page: any, pageIndex: number) => {
              console.log(`     ${pageIndex + 1}. ${page.pageUrl}`);
              console.log(`        Impressions: ${page.impressions} (${page.overlapPercentage.toFixed(1)}% overlap)`);
              console.log(`        Clicks: ${page.clicks}, Position: ${page.position.toFixed(1)}`);
            });
          });
        }
      }
      
    } catch (error) {
      console.error('❌ Error running audit:', error);
    }

    // Test 2: Get existing cannibalization results
    console.log('\n=== TEST 2: Getting Existing Cannibalization Results ===');
    
    try {
      const existingResults = await cannibalizationService.getCannibalizationResults(campaign.id, 10);
      
      if (existingResults) {
        console.log(`✅ Found existing audit from: ${existingResults.createdAt}`);
        console.log(`📊 Status: ${existingResults.status}`);
        console.log(`🔢 Results count: ${existingResults.results?.length || 0}`);
        
        if (existingResults.results && existingResults.results.length > 0) {
          console.log(`\n📝 Sample existing results (first 3):`);
          existingResults.results.slice(0, 3).forEach((result: any, index: number) => {
            console.log(`\n${index + 1}. "${result.keyword}"`);
            console.log(`   Top: ${result.topPageUrl} (${result.topPageImpressions} impressions)`);
            console.log(`   Competitors: ${result.competingPages?.length || 0} pages`);
            
            if (result.competingPages) {
              result.competingPages.slice(0, 2).forEach((page: any, pageIndex: number) => {
                console.log(`     ${pageIndex + 1}. ${page.pageUrl.substring(0, 60)}...`);
                console.log(`        ${page.impressions} impressions (${page.overlapPercentage.toFixed(1)}% overlap)`);
              });
            }
          });
        }
      } else {
        console.log('❌ No existing cannibalization results found');
      }
      
    } catch (error) {
      console.error('❌ Error getting existing results:', error);
    }

    // Test 3: Get audit history
    console.log('\n=== TEST 3: Getting Audit History ===');
    
    try {
      const history = await cannibalizationService.getAuditHistory(campaign.id);
      
      if (history && history.length > 0) {
        console.log(`✅ Found ${history.length} historical audits:`);
        history.forEach((audit: any, index: number) => {
          console.log(`${index + 1}. ${audit.createdAt} - ${audit.status} (${audit.auditType})`);
          console.log(`   Keywords: ${audit.totalKeywords || 0}, Cannibalization: ${audit.cannibalizationCount || 0}`);
        });
      } else {
        console.log('❌ No audit history found');
      }
      
    } catch (error) {
      console.error('❌ Error getting audit history:', error);
    }

    // Test 4: Check campaigns needing audit
    console.log('\n=== TEST 4: Checking Campaigns Needing Audit ===');
    
    try {
      const campaignsNeedingAudit = await cannibalizationService.getCampaignsNeedingAudit();
      
      if (campaignsNeedingAudit && campaignsNeedingAudit.length > 0) {
        console.log(`✅ Found ${campaignsNeedingAudit.length} campaigns needing audit:`);
        campaignsNeedingAudit.forEach((campaignId: string, index: number) => {
          console.log(`${index + 1}. Campaign ID: ${campaignId}`);
        });
      } else {
        console.log('❌ No campaigns need audit at this time');
      }
      
    } catch (error) {
      console.error('❌ Error checking campaigns needing audit:', error);
    }

    // Test 5: Test different audit types
    console.log('\n=== TEST 5: Testing Different Audit Types ===');
    
    try {
      console.log('📊 Available audit methods:');
      console.log('   - runAudit(campaignId, auditType)');
      console.log('   - runInitialAudit(campaignId) - 3 months data');
      console.log('   - runScheduledAudit(campaignId) - 2 weeks data');
      console.log('   - getCannibalizationResults(campaignId, limit)');
      console.log('   - getAuditHistory(campaignId, limit)');
      console.log('   - getCampaignsNeedingAudit()');
      
    } catch (error) {
      console.error('❌ Error in audit type test:', error);
    }

    console.log('\n✅ Cannibalization test completed!');

  } catch (error) {
    console.error('❌ Error in cannibalization test:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testCannibalizationData().catch(console.error);
