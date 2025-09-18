import { PrismaClient, Campaign, GoogleAccount } from '@prisma/client';
import moment from 'moment-timezone';
import { SearchConsoleService } from './searchConsole';
import { webmasters_v3 } from 'googleapis';

const prisma = new PrismaClient();
const searchConsoleService = new SearchConsoleService();

const CANNIBALIZATION_THRESHOLD = 20; // 20% overlap threshold

// Define enums 
enum AuditType {
  CUSTOM = 'CUSTOM'
}

enum AuditStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

interface KeywordPageData {
  keyword: string;
  pageUrl: string;
  impressions: number;
}

interface CannibalizationData {
  keyword: string;
  topPage: {
    url: string;
    impressions: number;
  };
  competingPages: Array<{
    url: string;
    impressions: number;
    overlapPercentage: number;
  }>;
}

/**
 * Service for detecting and monitoring keyword cannibalization
 * 
 * Cannibalization occurs when multiple pages from the same site compete for the same keyword.
 * This service identifies pages with ≥20% overlap based on impressions compared to the top-performing page.
 */
export class KeywordCannibalizationService {
  
  /**
   * Run a full keyword cannibalization audit for a campaign with custom date range
   */
  async runAudit(campaignId: string, startDate: Date, endDate: Date): Promise<string> {
    console.log(`Starting custom cannibalization audit for campaign ${campaignId} from ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { googleAccount: true }
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    if (!campaign.googleAccount) {
      throw new Error('Google account not found for campaign');
    }

    // Create audit record
    const audit = await (prisma as any).keywordCannibalizationAudit.create({
      data: {
        campaignId,
        startDate,
        endDate,
        auditType: AuditType.CUSTOM,
        status: AuditStatus.RUNNING
      }
    });

    try {
      // Fetch keyword data from Google Search Console
      const keywordData = await this.fetchKeywordPageData(campaign, campaign.googleAccount, startDate, endDate);
      
      if (!keywordData || keywordData.length === 0) {
        const updatedAudit = await (prisma as any).keywordCannibalizationAudit.update({
          where: { id: audit.id },
          data: { 
            status: AuditStatus.COMPLETED,
            totalKeywords: 0,
            cannibalizationCount: 0
          }
        });
        return updatedAudit.id;
      }

      // Analyze cannibalization
      const cannibalizationResults = this.analyzeCannibalization(keywordData);
      
      // Save results to database
      await this.saveAuditResults(audit.id, cannibalizationResults);
      
      // Update audit status
      await (prisma as any).keywordCannibalizationAudit.update({
        where: { id: audit.id },
        data: { 
          status: AuditStatus.COMPLETED,
          totalKeywords: cannibalizationResults.length,
          cannibalizationCount: cannibalizationResults.filter(r => r.competingPages.length > 0).length
        }
      });

      console.log(`Completed cannibalization audit ${audit.id}. Found ${cannibalizationResults.length} keywords with ${cannibalizationResults.filter(r => r.competingPages.length > 0).length} showing cannibalization.`);
      
      return audit.id;
    } catch (error) {
      console.error(`Error in cannibalization audit ${audit.id}:`, error);
      
      await prisma.keywordCannibalizationAudit.update({
        where: { id: audit.id },
        data: { status: AuditStatus.FAILED }
      });
      
      throw error;
    }
  }


  /**
   * Fetch keyword and page data from Google Search Console
   * Uses campaign keywords as source of truth - only processes keywords defined in campaign
   */
  private async fetchKeywordPageData(
    campaign: Campaign, 
    googleAccount: GoogleAccount, 
    startDate: Date, 
    endDate: Date
  ): Promise<KeywordPageData[]> {
    console.log(`🔍 Fetching GSC data from ${startDate.toISOString()} to ${endDate.toISOString()}`);
    console.log(`📊 Campaign: ${campaign.name} (${campaign.id})`);
    console.log(`🔗 Search Console Site: ${campaign.searchConsoleSite}`);
    
    // Get campaign keywords as source of truth
    const campaignKeywords = campaign.keywords
      .split('\n')
      .map((k: string) => k.trim().toLowerCase())
      .filter((k: string) => k.length > 0);
    
    console.log(`🎯 Campaign has ${campaignKeywords.length} defined keywords`);
    console.log(`📝 Keywords to check: ${campaignKeywords.join(', ')}`);
    
    // Fetch all GSC data with query and page dimensions
    const gscData = await searchConsoleService.getAnalytics({
      campaign,
      googleAccount,
      startAt: moment(startDate),
      endAt: moment(endDate),
      dimensions: ['query', 'page'],
      waitForAllData: true
    });

    console.log(`📈 Raw GSC data returned: ${gscData ? gscData.length : 0} rows`);

    if (!gscData || gscData.length === 0) {
      console.log('❌ No GSC data returned');
      return [];
    }

    // Use a Map to aggregate impressions by keyword-page combination
    const keywordPageMap = new Map<string, { keyword: string; pageUrl: string; impressions: number }>();
    let totalRows = 0;
    let validRows = 0;
    let keywordFilteredOut = 0;

    for (const row of gscData) {
      totalRows++;
      
      if (!row.keys || row.keys.length < 3) {
        continue;
      }
      
      // GSC returns keys as [date, keyword, pageUrl] when using ['query', 'page'] dimensions
      const [date, keyword, pageUrl] = row.keys;
      
      // ONLY process keywords that are defined in the campaign (source of truth)
      const normalizedKeyword = keyword.toLowerCase().trim();
      if (!campaignKeywords.includes(normalizedKeyword)) {
        keywordFilteredOut++;
        continue;
      }
      
      // Verify page is from same domain
      if (!this.isPageFromSameDomain(pageUrl, campaign.searchConsoleSite)) {
        continue;
      }

      validRows++;
      
      // Create a unique key for keyword-page combination
      const mapKey = `${normalizedKeyword}|${pageUrl}`;
      
      // Aggregate impressions for the same keyword-page combination across all dates
      if (keywordPageMap.has(mapKey)) {
        const existing = keywordPageMap.get(mapKey)!;
        existing.impressions += (row.impressions || 0);
      } else {
        keywordPageMap.set(mapKey, {
          keyword: normalizedKeyword,
          pageUrl,
          impressions: row.impressions || 0
        });
      }
    }

    // Convert map back to array
    const keywordPageData: KeywordPageData[] = Array.from(keywordPageMap.values());

    console.log(`📊 Processing Summary:`);
    console.log(`   Total rows from GSC: ${totalRows}`);
    console.log(`   Keywords filtered out (not in campaign): ${keywordFilteredOut}`);
    console.log(`   Valid rows processed: ${validRows}`);
    console.log(`   Unique keyword-page combinations after aggregation: ${keywordPageData.length}`);

    // Log sample of aggregated data
    if (keywordPageData.length > 0) {
      console.log(`📝 Sample aggregated data (first 3):`);
      keywordPageData.slice(0, 3).forEach((item, index) => {
        console.log(`  ${index + 1}. "${item.keyword}" -> ${item.pageUrl} (${item.impressions} total impressions)`);
      });
    }
    
    return keywordPageData;
  }

  /**
   * Check if a page URL belongs to the same domain as the campaign site
   */
  private isPageFromSameDomain(pageUrl: string, campaignSite: string): boolean {
    try {
      // Handle sc-domain: prefix for Search Console domain properties
      let normalizedCampaignSite = campaignSite;
      if (campaignSite.startsWith('sc-domain:')) {
        normalizedCampaignSite = 'https://' + campaignSite.replace('sc-domain:', '');
      }
      
      const pageHost = new URL(pageUrl).hostname.toLowerCase();
      const campaignHost = new URL(normalizedCampaignSite).hostname.toLowerCase();
      
      // Remove 'www.' prefix for comparison
      const normalizeHost = (host: string) => host.replace(/^www\./, '');
      
      return normalizeHost(pageHost) === normalizeHost(campaignHost);
    } catch {
      return false;
    }
  }

  /**
   * Analyze keyword data to identify cannibalization
   */
  private analyzeCannibalization(keywordData: KeywordPageData[]): CannibalizationData[] {
    // Group data by keyword
    const keywordGroups = new Map<string, KeywordPageData[]>();
    
    for (const data of keywordData) {
      if (!keywordGroups.has(data.keyword)) {
        keywordGroups.set(data.keyword, []);
      }
      keywordGroups.get(data.keyword)!.push(data);
    }

    const cannibalizationResults: CannibalizationData[] = [];

    for (const [keyword, pages] of keywordGroups) {
      // Skip keywords with only one page
      if (pages.length <= 1) {
        continue;
      }

      // Data is already aggregated by keyword-page combination in fetchKeywordPageData
      // Just sort by impressions
      const aggregatedPages = pages.map(page => ({
        url: page.pageUrl,
        impressions: page.impressions
      })).sort((a, b) => b.impressions - a.impressions);

      if (aggregatedPages.length <= 1) {
        continue;
      }

      const topPage = aggregatedPages[0];
      const competingPages = [];

      // Add top page as 100% overlap
      competingPages.push({
        url: topPage.url,
        impressions: topPage.impressions,
        overlapPercentage: 100
      });
      
      // Check each other page for cannibalization
      for (let i = 1; i < aggregatedPages.length; i++) {
        const page = aggregatedPages[i];
        const overlapPercentage = (page.impressions / topPage.impressions) * 100;
        
        if (overlapPercentage >= CANNIBALIZATION_THRESHOLD) {
          competingPages.push({
            url: page.url,
            impressions: page.impressions,
            overlapPercentage
          });
        }
      }

      // Only include keywords that have cannibalization (more than just the top page)
      if (competingPages.length > 1) {
        cannibalizationResults.push({
          keyword,
          topPage: {
            url: topPage.url,
            impressions: topPage.impressions
          },
          competingPages
        });
      }
    }

    return cannibalizationResults;
  }

  /**
   * Save audit results to database
   */
  private async saveAuditResults(auditId: string, results: CannibalizationData[]): Promise<void> {
    for (const result of results) {
      const cannibalizationResult = await (prisma as any).keywordCannibalizationResult.create({
        data: {
          auditId,
          keyword: result.keyword,
          topPageUrl: result.topPage.url,
          topPageImpressions: result.topPage.impressions
        }
      });

      // Save competing pages
      if (result.competingPages.length > 0) {
        await (prisma as any).keywordCompetingPage.createMany({
          data: result.competingPages.map(page => ({
            resultId: cannibalizationResult.id,
            pageUrl: page.url,
            impressions: page.impressions,
            overlapPercentage: page.overlapPercentage
          }))
        });
      }
    }
  }

  /**
   * Get cannibalization results for a campaign
   */
  async getCannibalizationResults(
    campaignId: string, 
    limit: number = 50, 
    startDate?: Date, 
    endDate?: Date
  ) {
    // Build where clause for audit filtering
    const auditWhere: any = { 
      campaignId,
      status: AuditStatus.COMPLETED
    };

    // If date range is provided, find audits that overlap with this date range
    // We want audits where the audit period overlaps with our requested period
    if (startDate && endDate) {
      auditWhere.AND = [
        { 
          OR: [
            // Audit starts before our end date AND audit ends after our start date
            {
              AND: [
                { startDate: { lte: endDate } },
                { endDate: { gte: startDate } }
              ]
            }
          ]
        }
      ];
    }

    const existingAudit = await (prisma as any).keywordCannibalizationAudit.findFirst({
      where: auditWhere,
      orderBy: { createdAt: 'desc' },
      include: {
        results: {
          include: {
            competingPages: {
              orderBy: { overlapPercentage: 'desc' }
            }
          },
          where: {
            competingPages: {
              some: {} // Only include results that have competing pages
            }
          },
          take: limit,
          orderBy: { keyword: 'asc' }
        }
      }
    });

    // If no results found or no cannibalization, return null to trigger no overlap message
    if (!existingAudit || !existingAudit.results || existingAudit.results.length === 0) {
      return null;
    }

    return existingAudit;
  }

  /**
   * Get audit history for a campaign
   */
  async getAuditHistory(campaignId: string, limit: number = 10) {
    return await (prisma as any).keywordCannibalizationAudit.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        auditType: true,
        status: true,
        startDate: true,
        endDate: true,
        totalKeywords: true,
        cannibalizationCount: true,
        createdAt: true
      }
    });
  }

  /**
   * Run audit with custom date range
   */
  async runCustomAudit(campaignId: string, startDate: Date, endDate: Date): Promise<string> {
    return this.runAudit(campaignId, startDate, endDate);
  }

  /**
   * Run initial cannibalization audit for a new campaign (3 months of data)
   */
  async runInitialAudit(campaignId: string): Promise<string> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 3); // 3 months ago
    
    console.log(`Running initial cannibalization audit for campaign ${campaignId} with 3 months of data (${startDate.toISOString()} to ${endDate.toISOString()})`);
    
    return this.runAudit(campaignId, startDate, endDate);
  }

  /**
   * Run scheduled cannibalization audit for daily cron job (2 weeks of data)
   */
  async runScheduledAudit(campaignId: string): Promise<string> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 14); // 2 weeks ago
    
    console.log(`Running scheduled cannibalization audit for campaign ${campaignId} with 2 weeks of data (${startDate.toISOString()} to ${endDate.toISOString()})`);
    
    return this.runAudit(campaignId, startDate, endDate);
  }

  /**
   * Get campaigns that need daily cannibalization audits
   * Returns all active campaigns
   */
  async getCampaignsNeedingAudit(): Promise<string[]> {
    const campaigns = await prisma.campaign.findMany({
      where: {
        status: 'ACTIVE'
      },
      select: {
        id: true
      }
    });
    
    return campaigns.map(campaign => campaign.id);
  }

}

export const keywordCannibalizationService = new KeywordCannibalizationService();
