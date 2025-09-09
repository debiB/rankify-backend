import { PrismaClient } from '@prisma/client';
import moment from 'moment';
import { Campaign, GoogleAccount } from '@prisma/client';
import { SearchConsoleService } from './searchConsole';
import { webmasters_v3 } from 'googleapis';

const prisma = new PrismaClient();
const searchConsoleService = new SearchConsoleService();

const debugLog = (message: string) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
};

export class AnalyticsService {
  /**
   * Fetch and save daily keyword positions and traffic data
   * This is called by the daily cron job
   */
  async fetchAndSaveDailyData({
    campaignId,
    waitForAllData,
  }: {
    campaignId: string;
    waitForAllData: boolean;
  }): Promise<boolean> {
    try {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
      });

      if (!campaign) {
        throw new Error('Campaign not found');
      }

      const googleAccount = await prisma.googleAccount.findUnique({
        where: { id: campaign.googleAccountId },
      });
      if (!googleAccount) {
        throw new Error('Google account not found');
      }

      // Get date for daily data (respect 3-day delay from Google Search Console)
      const threeDaysAgo = moment().subtract(3, 'days');
      const startAt = threeDaysAgo.startOf('day');
      const endAt = threeDaysAgo.endOf('day');

      // Fetch and save daily keyword positions (date/query dimensions)
      const dailyKeywordsData = await this.fetchDailyKeywordsData({
        campaign,
        googleAccount,
        startAt,
        endAt,
        waitForAllData,
      });
      if (dailyKeywordsData) {
        await this.saveDailyKeywordsData(dailyKeywordsData, campaign);
      }

      // Fetch and save daily keyword data with page dimensions
      const dailyKeywordDataWithDimensions =
        await this.fetchDailyKeywordDataWithDimensions({
          campaign,
          googleAccount,
          startAt,
          endAt,
          waitForAllData,
        });
      if (dailyKeywordDataWithDimensions) {
        await this.saveDailyKeywordDataWithDimensions(
          dailyKeywordDataWithDimensions,
          campaign
        );
      }

      // Fetch and save daily traffic data
      const dailyTrafficData = await this.fetchDailyTrafficData({
        campaign,
        googleAccount,
        startAt,
        endAt,
        waitForAllData,
      });
      if (dailyTrafficData) {
        await this.saveDailyTrafficData(dailyTrafficData, campaign);
      }

      return true;
    } catch (error) {
      console.error('Error fetching and saving daily data:', error);
      return false;
    }
  }

  /**
   * Fetch and save historical daily data for a campaign
   * This is used when creating a new campaign or updating keywords
   */
  async fetchHistoricalDailyData({
    campaignId,
    waitForAllData,
  }: {
    campaignId: string;
    waitForAllData: boolean;
  }): Promise<boolean> {
    try {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
      });

      if (!campaign) {
        throw new Error('Campaign not found');
      }

      const googleAccount = await prisma.googleAccount.findUnique({
        where: { id: campaign.googleAccountId },
      });
      if (!googleAccount) {
        throw new Error('Google account not found');
      }

      // Calculate date range for historical data
      // Start from campaign starting date, end at 3 days ago (respecting delay)
      const campaignStartDate = moment(campaign.startingDate);
      const threeDaysAgo = moment().subtract(3, 'days');

      // Don't fetch data beyond 3 days ago
      const endDate = threeDaysAgo.isBefore(campaignStartDate)
        ? campaignStartDate
        : threeDaysAgo;

      // Fetch historical daily data month by month to avoid API limits
      let currentDate = campaignStartDate.clone();

      while (currentDate.isSameOrBefore(endDate)) {
        const monthStart = currentDate.clone().startOf('month');
        const monthEnd = currentDate.clone().endOf('month');

        // Don't go beyond the end date
        const actualEnd = monthEnd.isAfter(endDate) ? endDate : monthEnd;

        // Fetch daily keyword positions for this month
        const dailyKeywordsData = await this.fetchDailyKeywordsData({
          campaign,
          googleAccount,
          startAt: monthStart,
          endAt: actualEnd,
          waitForAllData,
        });

        if (dailyKeywordsData) {
          await this.saveHistoricalDailyKeywords(
            dailyKeywordsData,
            campaign,
            monthStart,
            actualEnd
          );
        }

        // Move to next month
        currentDate.add(1, 'month').startOf('month');
      }

      return true;
    } catch (error) {
      console.error('Error fetching and saving historical daily data:', error);
      return false;
    }
  }

  /**
   * Fetch and save daily site traffic data (dimensions: ['date'])
   * This fetches overall site performance data by day
   */
  async fetchDailySiteTraffic({
    campaignId,
    waitForAllData,
  }: {
    campaignId: string;
    waitForAllData: boolean;
  }): Promise<boolean> {
    try {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
      });

      if (!campaign) {
        throw new Error('Campaign not found');
      }

      const googleAccount = await prisma.googleAccount.findUnique({
        where: { id: campaign.googleAccountId },
      });
      if (!googleAccount) {
        throw new Error('Google account not found');
      }

      // Calculate date range for historical data
      const campaignStartDate = moment(campaign.startingDate);
      const threeDaysAgo = moment().subtract(3, 'days');
      const endDate = threeDaysAgo.isBefore(campaignStartDate)
        ? campaignStartDate
        : threeDaysAgo;

      // Fetch daily site traffic data
      const dailySiteTraffic = await this.fetchDailySiteTrafficData({
        campaign,
        googleAccount,
        startAt: campaignStartDate,
        endAt: endDate,
        waitForAllData,
      });

      if (dailySiteTraffic) {
        await this.saveDailySiteTrafficData(dailySiteTraffic, campaign);
      }

      return true;
    } catch (error) {
      console.error('Error fetching daily site traffic:', error);
      return false;
    }
  }

  /**
   * Fetch and save monthly traffic data for the last 12 months
   * This fetches overall site traffic data by month
   */
  async fetchAndSaveMonthlyTrafficData({
    campaignId,
    waitForAllData,
  }: {
    campaignId: string;
    waitForAllData: boolean;
  }): Promise<boolean> {
    try {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
      });

      if (!campaign) {
        throw new Error('Campaign not found');
      }

      const googleAccount = await prisma.googleAccount.findUnique({
        where: { id: campaign.googleAccountId },
      });
      if (!googleAccount) {
        throw new Error('Google account not found');
      }

      // Fetch traffic data for the last 12 months
      const trafficData = await this.fetchTrafficData({
        campaign,
        googleAccount,
        waitForAllData,
      });

      if (trafficData) {
        await this.saveTrafficData(trafficData, campaign);
      }

      return true;
    } catch (error) {
      console.error('Error fetching monthly traffic data:', error);
      return false;
    }
  }

  /**
   * Fetch and save daily keyword data (dimensions: ['date', 'query'])
   * This fetches keyword-specific daily performance data
   */
  async fetchDailyKeywordData({
    campaignId,
    waitForAllData,
  }: {
    campaignId: string;
    waitForAllData: boolean;
  }): Promise<boolean> {
    try {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
      });

      if (!campaign) {
        throw new Error('Campaign not found');
      }

      const googleAccount = await prisma.googleAccount.findUnique({
        where: { id: campaign.googleAccountId },
      });
      if (!googleAccount) {
        throw new Error('Google account not found');
      }

      // Calculate date range for historical data
      const campaignStartDate = moment(campaign.startingDate);
      const threeDaysAgo = moment().subtract(3, 'days');
      const endDate = threeDaysAgo.isBefore(campaignStartDate)
        ? campaignStartDate
        : threeDaysAgo;

      // Fetch daily keyword data month by month to avoid API limits and ensure no gaps
      let currentDate = campaignStartDate.clone();

      while (currentDate.isSameOrBefore(endDate)) {
        const monthStart = currentDate.clone().startOf('month');
        const monthEnd = currentDate.clone().endOf('month');

        // Don't go beyond the end date
        const actualEnd = monthEnd.isAfter(endDate) ? endDate : monthEnd;

        // Check if we already have complete data for this month
        const hasCompleteMonthData = await this.checkIfMonthHasCompleteData(
          monthStart,
          actualEnd,
          this.parseCampaignKeywords(campaign),
          campaign.searchConsoleSite
        );

        if (hasCompleteMonthData) {
          currentDate.add(1, 'month').startOf('month');
          continue;
        }

        // First fetch daily keyword data with date/query dimensions for this month
        const dailyKeywordsData = await this.fetchDailyKeywordsData({
          campaign,
          googleAccount,
          startAt: monthStart,
          endAt: actualEnd,
          waitForAllData,
        });

        if (dailyKeywordsData) {
          await this.saveHistoricalDailyKeywords(
            dailyKeywordsData,
            campaign,
            monthStart,
            actualEnd
          );
        }

        // Then fetch daily keyword data with page dimensions for this month
        const dailyKeywordData = await this.fetchDailyKeywordDataWithDimensions(
          {
            campaign,
            googleAccount,
            startAt: monthStart,
            endAt: actualEnd,
            waitForAllData,
          }
        );

        if (dailyKeywordData) {
          await this.saveDailyKeywordDataWithDimensions(
            dailyKeywordData,
            campaign
          );
        }

        // Move to next month
        currentDate.add(1, 'month').startOf('month');
      }

      // Also fetch 7 days before campaign start date for initial positions
      const initialPositionStartDate = campaignStartDate
        .clone()
        .subtract(7, 'days');
      const initialPositionEndDate = campaignStartDate
        .clone()
        .subtract(1, 'day');

      const initialPositionData =
        await this.fetchDailyKeywordDataWithDimensions({
          campaign,
          googleAccount,
          startAt: initialPositionStartDate,
          endAt: initialPositionEndDate,
          waitForAllData,
        });

      if (initialPositionData) {
        await this.saveInitialPositionData(initialPositionData, campaign);
      }

      return true;
    } catch (error) {
      console.error('Error fetching daily keyword data:', error);
      return false;
    }
  }

  private aggregateRowsMetrics = (rows: webmasters_v3.Schema$ApiDataRow[]) => {
    const totalStats = rows.reduce(
      (
        acc: {
          totalClicks: number;
          totalImpressions: number;
          sumOfPositions: number;
        },
        curr
      ) => {
        acc.totalClicks += curr.clicks || 0;
        acc.totalImpressions += curr.impressions || 0;
        acc.sumOfPositions += (curr.position || 0) * (curr.impressions || 0);

        return acc;
      },
      {
        totalClicks: 0,
        totalImpressions: 0,
        sumOfPositions: 0,
      }
    );

    return {
      totalClicks: totalStats.totalClicks,
      totalImpressions: totalStats.totalImpressions,
      averageCtr:
        totalStats.totalImpressions > 0
          ? Math.round(
              (totalStats.totalClicks / totalStats.totalImpressions) * 100 * 10
            ) / 10
          : 0,
      averagePosition:
        totalStats.totalImpressions > 0
          ? Math.round(
              (totalStats.sumOfPositions / totalStats.totalImpressions) * 10
            ) / 10
          : 0,
    };
  };

  private mergeQueryMetrics = (queryAnalytics: {
    [key: string]: webmasters_v3.Schema$ApiDataRow[];
  }) => {
    const stats = Object.entries(queryAnalytics).reduce(
      (acc, [query, rows]) => {
        const queryStats = this.aggregateRowsMetrics(rows);
        const weightedPosition =
          queryStats.averagePosition * queryStats.totalImpressions;

        return {
          ...acc,
          totalClicks: acc.totalClicks + queryStats.totalClicks,
          totalImpressions: acc.totalImpressions + queryStats.totalImpressions,
          sumOfWeightedPositions: acc.sumOfWeightedPositions + weightedPosition,
        };
      },
      {
        totalClicks: 0,
        totalImpressions: 0,
        sumOfWeightedPositions: 0,
      }
    );

    return {
      totalClicks: stats.totalClicks,
      totalImpressions: stats.totalImpressions,
      averageCtr:
        stats.totalImpressions > 0
          ? Math.round(
              (stats.totalClicks / stats.totalImpressions) * 100 * 10
            ) / 10
          : 0,
      averagePosition:
        stats.totalImpressions > 0
          ? Math.round(
              (stats.sumOfWeightedPositions / stats.totalImpressions) * 10
            ) / 10
          : 0,
    };
  };

  private async saveMonthlyData(
    monthData: {
      topRankingPages: Record<
        string,
        { page: string; impressions: number }
      > | null;
      keywordsAnalytics: Record<string, webmasters_v3.Schema$ApiDataRow> | null;
      keywordsPositions: Record<string, webmasters_v3.Schema$ApiDataRow> | null;
    },
    campaign: Campaign,
    monthDate: moment.Moment
  ) {
    try {
      debugLog(
        `saveMonthlyData called for ${monthDate.format(
          'YYYY-MM'
        )} - campaign: ${campaign.name}`
      );
      const siteUrl = campaign.searchConsoleSite;
      const month = monthDate.month() + 1; // moment months are 0-indexed
      const year = monthDate.year();

      // Find existing analytics record or create a new one
      let analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
        where: { siteUrl },
      });

      if (!analytics) {
        analytics = await prisma.searchConsoleKeywordAnalytics.create({
          data: { siteUrl },
        });
      }

      // Get all keywords from the campaign
      const keywords = this.parseCampaignKeywords(campaign);

      // Process each keyword for this month
      for (const keyword of keywords) {
        const trimmedKeyword = keyword.trim();
        if (!trimmedKeyword) continue;

        // Create or update the keyword record (don't overwrite initial position)
        const keywordRecord = await prisma.searchConsoleKeyword.upsert({
          where: {
            analyticsId_keyword: {
              analyticsId: analytics.id,
              keyword: trimmedKeyword,
            },
          },
          update: {
            updatedAt: new Date(),
          },
          create: {
            analyticsId: analytics.id,
            keyword: trimmedKeyword,
            initialPosition: 0, // Will be set by saveInitialPositions method
          },
        });

        // Process monthly stats if we have position data
        if (monthData.keywordsPositions?.[trimmedKeyword]) {
          const positionData = monthData.keywordsPositions[trimmedKeyword];

          // Get top ranking page from topRankingPages and decode it
          const rawTopRankingPage =
            monthData.topRankingPages?.[trimmedKeyword]?.page || '';
          const topRankingPage = rawTopRankingPage
            ? decodeURIComponent(rawTopRankingPage)
            : '';

          // Get search volume from keywordsAnalytics
          const analyticsData = monthData.keywordsAnalytics?.[trimmedKeyword];
          const searchVolume = analyticsData?.impressions || 0;

          // Create or update monthly stat
          await prisma.searchConsoleKeywordMonthlyStat.upsert({
            where: {
              keywordId_month_year: {
                keywordId: keywordRecord.id,
                month,
                year,
              },
            },
            update: {
              averageRank: positionData.position || 0,
              searchVolume,
              topRankingPageUrl: topRankingPage,
              updatedAt: new Date(),
            },
            create: {
              keywordId: keywordRecord.id,
              month,
              year,
              averageRank: positionData.position || 0,
              searchVolume,
              topRankingPageUrl: topRankingPage,
            },
          });
        }
      }
    } catch (error) {
      console.error('Error saving month data:', error);
    }
  }

  private async saveInitialPositions(
    keywordsInitialPositions: Record<string, webmasters_v3.Schema$ApiDataRow>,
    campaign: Campaign
  ) {
    try {
      const siteUrl = campaign.searchConsoleSite;

      // Find existing analytics record or create a new one
      let analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
        where: { siteUrl },
      });

      if (!analytics) {
        analytics = await prisma.searchConsoleKeywordAnalytics.create({
          data: { siteUrl },
        });
      }

      // Get all keywords from the campaign
      const keywords = this.parseCampaignKeywords(campaign);

      // Process each keyword for initial positions
      for (const keyword of keywords) {
        const trimmedKeyword = keyword.trim();
        if (!trimmedKeyword) continue;

        const initialPositionData = keywordsInitialPositions[trimmedKeyword];
        const initialPosition = initialPositionData?.position || 0;

        // Update the keyword record with initial position
        await prisma.searchConsoleKeyword.upsert({
          where: {
            analyticsId_keyword: {
              analyticsId: analytics.id,
              keyword: trimmedKeyword,
            },
          },
          update: {
            initialPosition,
            updatedAt: new Date(),
          },
          create: {
            analyticsId: analytics.id,
            keyword: trimmedKeyword,
            initialPosition,
          },
        });
      }
    } catch (error) {
      console.error('Error saving initial positions:', error);
    }
  }

  /**
   * Fetch top ranking pages for keywords
   * This method follows Google Search Console's dimensions and aggregation methodology
   * by using date, query, and page dimensions and selecting the top page by impressions
   */
  private async fetchTopRankingPages({
    campaign,
    googleAccount,
    startAt,
    endAt,
    waitForAllData,
    keywords,
  }: {
    campaign: Campaign;
    googleAccount: GoogleAccount;
    startAt: moment.Moment;
    endAt: moment.Moment;
    waitForAllData: boolean;
    keywords: string[];
  }): Promise<Record<string, { page: string; impressions: number }> | null> {
    try {
      // Fetch data with date, query and page dimensions
      // This respects GSC's dimensions requirement
      const topRankingPageAnalytics = await searchConsoleService.getAnalytics({
        campaign,
        googleAccount,
        waitForAllData,
        startAt,
        endAt,
        dimensions: ['date', 'query', 'page'],
      });
      if (!topRankingPageAnalytics) {
        return null;
      }

      // Filter to only include our target keywords
      const filteredAnalytics = topRankingPageAnalytics.filter(({ keys }) =>
        keys && keys.length >= 3 && keywords.includes(keys[1] as string)
      );

      // Group by keyword and aggregate impressions by page across all dates
      const groupedAnalytics = filteredAnalytics.reduce(
        (acc, { keys, ...rest }) => {
          if (!keys || keys.length < 3) return acc;
          
          const keyword = keys[1] as string;
          const page = keys[2] as string;
          
          if (!acc[keyword]) {
            acc[keyword] = {};
          }
          
          if (!acc[keyword][page]) {
            acc[keyword][page] = 0;
          }
          
          // Aggregate impressions for each page across all dates
          acc[keyword][page] += rest.impressions ?? 0;
          
          return acc;
        },
        {} as Record<string, Record<string, number>>
      );

      // Find the top page by impressions for each keyword
      const keywordsTopPages: Record<string, { page: string; impressions: number }> = {};
      
      Object.entries(groupedAnalytics).forEach(([keyword, pages]) => {
        let topPage = '';
        let maxImpressions = 0;
        
        // Find the page with the most impressions
        Object.entries(pages).forEach(([page, impressions]) => {
          if (impressions > maxImpressions) {
            maxImpressions = impressions;
            topPage = page;
          }
        });
        
        keywordsTopPages[keyword] = {
          page: topPage,
          impressions: maxImpressions
        };
      });

      return keywordsTopPages;
    } catch (error) {
      console.error('Error fetching top ranking page analytics:', error);
      return null;
    }
  }

  private async fetchKeywordData({
    campaign,
    googleAccount,
    startAt,
    endAt,
    waitForAllData,
    keywords,
  }: {
    campaign: Campaign;
    googleAccount: GoogleAccount;
    startAt: moment.Moment;
    endAt: moment.Moment;
    waitForAllData: boolean;
    keywords: string[];
  }): Promise<Record<string, webmasters_v3.Schema$ApiDataRow> | null> {
    try {
      const analytics = await searchConsoleService.getAnalytics({
        campaign,
        googleAccount,
        waitForAllData,
        startAt,
        endAt,
        dimensions: ['query'],
      });

      const filteredAnalytics = analytics?.filter(({ keys }) =>
        keywords.includes(keys?.[0] as string)
      );

      if (!filteredAnalytics) {
        return null;
      }

      // Group data by keyword
      const groupedAnalytics = filteredAnalytics.reduce(
        (acc, { keys, ...rest }) => {
          const keyword = keys?.[0] as string;
          if (!acc[keyword]) {
            acc[keyword] = rest;
          }
          return acc;
        },
        {} as Record<string, webmasters_v3.Schema$ApiDataRow>
      );

      return groupedAnalytics;
    } catch (error) {
      console.error('Error fetching keyword data:', error);
      return null;
    }
  }

  // Helper methods to check and retrieve data from database
  private findLastDataMonth(
    existingAnalytics: any
  ): { month: number; year: number } | null {
    if (!existingAnalytics?.keywords?.length) return null;

    // Find the latest monthly stat across all keywords
    let latestMonth = 0;
    let latestYear = 0;
    let hasData = false;

    existingAnalytics.keywords.forEach((keyword: any) => {
      if (keyword.monthlyStats?.length) {
        const latestStat = keyword.monthlyStats[0]; // Already ordered by desc
        if (
          !hasData ||
          latestStat.year > latestYear ||
          (latestStat.year === latestYear && latestStat.month > latestMonth)
        ) {
          latestMonth = latestStat.month;
          latestYear = latestStat.year;
          hasData = true;
        }
      }
    });

    return hasData ? { month: latestMonth, year: latestYear } : null;
  }

  private getAllTopRankingPagesFromDB(
    existingAnalytics: any
  ): Record<string, { page: string; impressions: number }> {
    const result: Record<string, { page: string; impressions: number }> = {};

    if (!existingAnalytics?.keywords) return result;

    existingAnalytics.keywords.forEach((keyword: any) => {
      keyword.monthlyStats.forEach((stat: any) => {
        if (stat.topRankingPageUrl) {
          result[keyword.keyword] = {
            page: stat.topRankingPageUrl,
            impressions: stat.searchVolume || 0,
          };
        }
      });
    });

    return result;
  }

  private getAllKeywordAnalyticsFromDB(
    existingAnalytics: any
  ): Record<string, webmasters_v3.Schema$ApiDataRow> {
    const result: Record<string, webmasters_v3.Schema$ApiDataRow> = {};

    if (!existingAnalytics?.keywords) return result;

    existingAnalytics.keywords.forEach((keyword: any) => {
      keyword.monthlyStats.forEach((stat: any) => {
        if (stat.searchVolume !== undefined) {
          result[keyword.keyword] = {
            clicks: stat.searchVolume || 0,
            impressions: stat.searchVolume || 0,
            position: stat.averageRank || 0,
          } as webmasters_v3.Schema$ApiDataRow;
        }
      });
    });

    return result;
  }

  private getAllPositionDataFromDB(
    existingAnalytics: any
  ): Record<string, webmasters_v3.Schema$ApiDataRow> {
    const result: Record<string, webmasters_v3.Schema$ApiDataRow> = {};

    if (!existingAnalytics?.keywords) return result;

    existingAnalytics.keywords.forEach((keyword: any) => {
      keyword.monthlyStats.forEach((stat: any) => {
        if (stat.averageRank !== undefined) {
          result[keyword.keyword] = {
            position: stat.averageRank || 0,
            clicks: stat.searchVolume || 0,
            impressions: stat.searchVolume || 0,
          } as webmasters_v3.Schema$ApiDataRow;
        }
      });
    });

    return result;
  }

  private hasTopRankingPages(
    existingAnalytics: any,
    keywords: string[],
    month: number,
    year: number
  ): boolean {
    if (!existingAnalytics?.keywords) return false;

    return keywords.every((keyword) => {
      const keywordRecord = existingAnalytics.keywords.find(
        (k: any) => k.keyword === keyword
      );
      if (!keywordRecord) return false;

      const monthlyStat = keywordRecord.monthlyStats.find(
        (stat: any) => stat.month === month && stat.year === year
      );

      return monthlyStat && monthlyStat.topRankingPageUrl;
    });
  }

  private findTopRankingPagesFromDB(
    existingAnalytics: any,
    keywords: string[],
    month: number,
    year: number
  ): Record<string, { page: string; impressions: number }> {
    const result: Record<string, { page: string; impressions: number }> = {};

    if (!existingAnalytics?.keywords) return result;

    keywords.forEach((keyword) => {
      const keywordRecord = existingAnalytics.keywords.find(
        (k: any) => k.keyword === keyword
      );
      if (keywordRecord) {
        const monthlyStat = keywordRecord.monthlyStats.find(
          (stat: any) => stat.month === month && stat.year === year
        );
        if (monthlyStat?.topRankingPageUrl) {
          result[keyword] = {
            page: monthlyStat.topRankingPageUrl,
            impressions: monthlyStat.searchVolume || 0,
          };
        }
      }
    });

    return result;
  }

  private hasKeywordAnalytics(
    existingAnalytics: any,
    keywords: string[],
    month: number,
    year: number
  ): boolean {
    if (!existingAnalytics?.keywords) return false;

    return keywords.every((keyword) => {
      const keywordRecord = existingAnalytics.keywords.find(
        (k: any) => k.keyword === keyword
      );
      if (!keywordRecord) return false;

      const monthlyStat = keywordRecord.monthlyStats.find(
        (stat: any) => stat.month === month && stat.year === year
      );

      return monthlyStat && monthlyStat.searchVolume !== undefined;
    });
  }

  private findKeywordAnalyticsFromDB(
    existingAnalytics: any,
    keywords: string[],
    month: number,
    year: number
  ): Record<string, webmasters_v3.Schema$ApiDataRow> {
    const result: Record<string, webmasters_v3.Schema$ApiDataRow> = {};

    if (!existingAnalytics?.keywords) return result;

    keywords.forEach((keyword) => {
      const keywordRecord = existingAnalytics.keywords.find(
        (k: any) => k.keyword === keyword
      );
      if (keywordRecord) {
        const monthlyStat = keywordRecord.monthlyStats.find(
          (stat: any) => stat.month === month && stat.year === year
        );
        if (monthlyStat) {
          result[keyword] = {
            clicks: monthlyStat.searchVolume || 0,
            impressions: monthlyStat.searchVolume || 0,
            position: monthlyStat.averageRank || 0,
          } as webmasters_v3.Schema$ApiDataRow;
        }
      }
    });

    return result;
  }

  private hasPositions(
    existingAnalytics: any,
    keywords: string[],
    month: number,
    year: number
  ): boolean {
    if (!existingAnalytics?.keywords) return false;

    return keywords.every((keyword) => {
      const keywordRecord = existingAnalytics.keywords.find(
        (k: any) => k.keyword === keyword
      );
      if (!keywordRecord) return false;

      const monthlyStat = keywordRecord.monthlyStats.find(
        (stat: any) => stat.month === month && stat.year === year
      );

      return monthlyStat && monthlyStat.averageRank !== undefined;
    });
  }

  private findPositionDataFromDB(
    existingAnalytics: any,
    keywords: string[],
    month: number,
    year: number
  ): Record<string, webmasters_v3.Schema$ApiDataRow> {
    const result: Record<string, webmasters_v3.Schema$ApiDataRow> = {};

    if (!existingAnalytics?.keywords) return result;

    keywords.forEach((keyword) => {
      const keywordRecord = existingAnalytics.keywords.find(
        (k: any) => k.keyword === keyword
      );
      if (keywordRecord) {
        const monthlyStat = keywordRecord.monthlyStats.find(
          (stat: any) => stat.month === month && stat.year === year
        );
        if (monthlyStat) {
          result[keyword] = {
            position: monthlyStat.averageRank || 0,
            clicks: monthlyStat.searchVolume || 0,
            impressions: monthlyStat.searchVolume || 0,
          } as webmasters_v3.Schema$ApiDataRow;
        }
      }
    });

    return result;
  }

  private hasInitialPositions(
    existingAnalytics: any,
    keywords: string[]
  ): boolean {
    if (!existingAnalytics?.keywords) return false;

    return keywords.every((keyword) => {
      const keywordRecord = existingAnalytics.keywords.find(
        (k: any) => k.keyword === keyword
      );
      return keywordRecord && keywordRecord.initialPosition !== undefined;
    });
  }

  private findInitialPositionsFromDB(
    existingAnalytics: any,
    keywords: string[]
  ): Record<string, webmasters_v3.Schema$ApiDataRow> {
    const result: Record<string, webmasters_v3.Schema$ApiDataRow> = {};

    if (!existingAnalytics?.keywords) return result;

    keywords.forEach((keyword) => {
      const keywordRecord = existingAnalytics.keywords.find(
        (k: any) => k.keyword === keyword
      );
      if (keywordRecord && keywordRecord.initialPosition !== undefined) {
        result[keyword] = {
          position: keywordRecord.initialPosition,
          clicks: 0,
          impressions: 0,
        } as webmasters_v3.Schema$ApiDataRow;
      }
    });

    return result;
  }

  private async saveKeywordRecords(
    keywordsData: {
      topRankingPages: Record<string, { page: string; impressions: number }>;
      keywordsAnalytics: Record<string, webmasters_v3.Schema$ApiDataRow>;
      keywordsPositions: Record<string, webmasters_v3.Schema$ApiDataRow>;
      keywordsInitialPositions: Record<string, webmasters_v3.Schema$ApiDataRow>;
    },
    campaign: Campaign
  ): Promise<boolean> {
    try {
      const siteUrl = campaign.searchConsoleSite;

      // Find existing analytics record or create a new one
      let analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
        where: { siteUrl },
      });

      if (!analytics) {
        analytics = await prisma.searchConsoleKeywordAnalytics.create({
          data: { siteUrl },
        });
      } else {
        // Update the existing record
        analytics = await prisma.searchConsoleKeywordAnalytics.update({
          where: { id: analytics.id },
          data: { updatedAt: new Date() },
        });
      }

      // Get all keywords from the campaign
      const keywords = this.parseCampaignKeywords(campaign);

      // Process each keyword
      for (const keyword of keywords) {
        const trimmedKeyword = keyword.trim();
        if (!trimmedKeyword) continue;

        // Get initial position from keywordsInitialPositions
        const initialPositionData =
          keywordsData.keywordsInitialPositions[trimmedKeyword];
        const initialPosition = initialPositionData?.position || 0;

        // Create or update the keyword record
        const keywordRecord = await prisma.searchConsoleKeyword.upsert({
          where: {
            analyticsId_keyword: {
              analyticsId: analytics.id,
              keyword: trimmedKeyword,
            },
          },
          update: {
            initialPosition,
            updatedAt: new Date(),
          },
          create: {
            analyticsId: analytics.id,
            keyword: trimmedKeyword,
            initialPosition,
          },
        });

        // Note: Monthly stats are now handled by saveMonthlyData method
        // This method only creates/updates keyword records and initial positions
      }

      return true;
    } catch (error) {
      console.error('Error saving keywords data:', error);
      return false;
    }
  }

  private async fetchTrafficData({
    campaign,
    googleAccount,
    waitForAllData,
  }: {
    campaign: Campaign;
    googleAccount: GoogleAccount;
    waitForAllData: boolean;
  }): Promise<{
    monthly: Record<
      string,
      { clicks: number; impressions: number; ctr: number; position: number }
    >;
    daily: Record<
      string,
      { clicks: number; impressions: number; ctr: number; position: number }
    >;
  } | null> {
    try {
      // Calculate the last 12 complete months (excluding current month)
      const currentDate = moment();
      const startDate = currentDate
        .clone()
        .subtract(12, 'months')
        .startOf('month');
      const endDate = currentDate.clone().subtract(1, 'month').endOf('month');

      const monthlyData: Record<
        string,
        { clicks: number; impressions: number; ctr: number; position: number }
      > = {};
      const dailyData: Record<
        string,
        { clicks: number; impressions: number; ctr: number; position: number }
      > = {};

      // Fetch monthly traffic data for the last 12 months
      for (let i = 0; i < 12; i++) {
        const startAt = startDate.clone().add(i, 'months');
        const endAt = startAt.clone().endOf('month');

        // Skip if this month is not over yet
        if (endAt.isAfter(moment())) {
          continue;
        }

        const monthKey = `${startAt.format('YYYY-MM')}`;
        const monthTraffic = await this.fetchMonthlyTrafficData({
          campaign,
          googleAccount,
          startAt,
          endAt,
          waitForAllData,
        });

        if (monthTraffic) {
          monthlyData[monthKey] = monthTraffic;
        }
      }

      // Fetch daily traffic data for the current month (from first day to end of month)
      const dailyStartDate = moment().startOf('month').startOf('day');
      const dailyEndDate = moment().endOf('month').endOf('day');

      const dailyTraffic = await this.fetchDailyTrafficData({
        campaign,
        googleAccount,
        startAt: dailyStartDate,
        endAt: dailyEndDate,
        waitForAllData,
      });

      if (dailyTraffic) {
        Object.assign(dailyData, dailyTraffic);
      }

      return {
        monthly: monthlyData,
        daily: dailyData,
      };
    } catch (error) {
      console.error('Error fetching traffic data:', error);
      return null;
    }
  }

  private async fetchMonthlyTrafficData({
    campaign,
    googleAccount,
    startAt,
    endAt,
    waitForAllData,
  }: {
    campaign: Campaign;
    googleAccount: GoogleAccount;
    startAt: moment.Moment;
    endAt: moment.Moment;
    waitForAllData: boolean;
  }): Promise<{
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  } | null> {
    try {
      const analytics = await searchConsoleService.getAnalytics({
        campaign,
        googleAccount,
        waitForAllData,
        startAt,
        endAt,
        dimensions: [], // No dimensions for overall site traffic
      });

      if (!analytics || analytics.length === 0) {
        return null;
      }

      // Sum up all the data for the month
      const totalClicks = analytics.reduce(
        (sum, row) => sum + (row.clicks || 0),
        0
      );
      const totalImpressions = analytics.reduce(
        (sum, row) => sum + (row.impressions || 0),
        0
      );
      const totalPosition = analytics.reduce(
        (sum, row) => sum + (row.position || 0),
        0
      );

      // Calculate CTR (Click-Through Rate)
      const ctr =
        totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

      // Calculate average position
      const avgPosition =
        analytics.length > 0 ? totalPosition / analytics.length : 0;

      return {
        clicks: totalClicks,
        impressions: totalImpressions,
        ctr: parseFloat(ctr.toFixed(2)),
        position: avgPosition,
      };
    } catch (error) {
      console.error('Error fetching monthly traffic data:', error);
      return null;
    }
  }

  private async fetchDailyTrafficData({
    campaign,
    googleAccount,
    startAt,
    endAt,
    waitForAllData,
  }: {
    campaign: Campaign;
    googleAccount: GoogleAccount;
    startAt: moment.Moment;
    endAt: moment.Moment;
    waitForAllData: boolean;
  }): Promise<Record<
    string,
    { clicks: number; impressions: number; ctr: number; position: number }
  > | null> {
    try {
      const analytics = await searchConsoleService.getAnalytics({
        campaign,
        googleAccount,
        waitForAllData,
        startAt,
        endAt,
        dimensions: ['date'], // Include date dimension for daily breakdown
      });

      if (!analytics || analytics.length === 0) {
        return null;
      }

      const dailyData: Record<
        string,
        { clicks: number; impressions: number; ctr: number; position: number }
      > = {};

      analytics.forEach((row) => {
        const dateKey = row.keys?.[0] as string;
        if (dateKey) {
          const clicks = row.clicks || 0;
          const impressions = row.impressions || 0;
          const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;

          dailyData[dateKey] = {
            clicks,
            impressions,
            ctr: parseFloat(ctr.toFixed(2)),
            position: row.position || 0,
          };
        }
      });

      return dailyData;
    } catch (error) {
      console.error('Error fetching daily traffic data:', error);
      return null;
    }
  }

  /**
   * Fetch daily site traffic data with date dimension
   */
  private async fetchDailySiteTrafficData({
    campaign,
    googleAccount,
    startAt,
    endAt,
    waitForAllData,
  }: {
    campaign: Campaign;
    googleAccount: GoogleAccount;
    startAt: moment.Moment;
    endAt: moment.Moment;
    waitForAllData: boolean;
  }): Promise<Record<
    string,
    { clicks: number; impressions: number; ctr: number; position: number }
  > | null> {
    try {
      const analytics = await searchConsoleService.getAnalytics({
        campaign,
        googleAccount,
        waitForAllData,
        startAt,
        endAt,
        dimensions: ['date'], // Site-wide traffic by date
      });

      if (!analytics || analytics.length === 0) {
        return null;
      }

      const dailyData: Record<
        string,
        { clicks: number; impressions: number; ctr: number; position: number }
      > = {};

      analytics.forEach((row) => {
        const dateKey = row.keys?.[0] as string;
        if (dateKey) {
          const clicks = row.clicks || 0;
          const impressions = row.impressions || 0;
          const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;

          dailyData[dateKey] = {
            clicks,
            impressions,
            ctr: parseFloat(ctr.toFixed(2)),
            position: row.position || 0,
          };
        }
      });

      return dailyData;
    } catch (error) {
      console.error('Error fetching daily site traffic data:', error);
      return null;
    }
  }

  /**
   * Fetch daily keyword data with date and query dimensions
   */
  /**
   * Fetch daily keyword data with dimensions (date, query, page)
   * This method respects Google Search Console's dimensions and aggregation methodology
   */
  private async fetchDailyKeywordDataWithDimensions({
    campaign,
    googleAccount,
    startAt,
    endAt,
    waitForAllData,
  }: {
    campaign: Campaign;
    googleAccount: GoogleAccount;
    startAt: moment.Moment;
    endAt: moment.Moment;
    waitForAllData: boolean;
  }): Promise<webmasters_v3.Schema$ApiDataRow[] | null> {
    try {
      const keywords = this.parseCampaignKeywords(campaign);

      if (keywords.length === 0) {
        return null;
      }

      // Fetch data with date, query, and page dimensions
      // This respects GSC's dimensions requirement
      const analytics = await searchConsoleService.getAnalytics({
        campaign,
        googleAccount,
        startAt: startAt,
        endAt: endAt,
        dimensions: ['date', 'query', 'page'], // Daily keyword data with page dimension
      });

      if (!analytics) {
        return null;
      }

      // Filter to only include our target keywords
      const filteredAnalytics = analytics.filter((row) => {
        if (row.keys && row.keys.length >= 3) {
          const query = row.keys[1];
          return keywords.includes(query);
        }
        return false;
      });

      // Group by date and query, then aggregate to get the page with most impressions
      // This follows GSC's methodology for selecting top pages by impressions
      const aggregatedData =
        this.aggregateDataByDateAndQuery(filteredAnalytics);

      return aggregatedData;
    } catch (error) {
      console.error(
        'Error fetching daily keyword data with dimensions:',
        error
      );
      return null;
    }
  }

  /**
   * Aggregate data by date and query, selecting the page with most impressions for each combination
   * This follows Google Search Console's aggregation methodology
   */
  private aggregateDataByDateAndQuery(
    analytics: webmasters_v3.Schema$ApiDataRow[]
  ): webmasters_v3.Schema$ApiDataRow[] {
    const groupedData: Record<string, webmasters_v3.Schema$ApiDataRow[]> = {};

    // Group by date and query
    analytics.forEach((row) => {
      if (row.keys && row.keys.length >= 3) {
        const date = row.keys[0];
        const query = row.keys[1];
        const pageUrl = row.keys[2];
        const key = `${date}_${query}`;

        if (!groupedData[key]) {
          groupedData[key] = [];
        }
        groupedData[key].push(row);
      }
    });

    // Aggregate each group to get the page with most impressions
    // and follow GSC's aggregation methodology
    const aggregatedData: webmasters_v3.Schema$ApiDataRow[] = [];

    Object.entries(groupedData).forEach(([key, rows]) => {
      if (rows.length === 0) return;

      // Find the row with the most impressions (top page)
      const bestRow = rows.reduce((best, current) => {
        const bestImpressions = best.impressions || 0;
        const currentImpressions = current.impressions || 0;
        return currentImpressions > bestImpressions ? current : best;
      });

      // Calculate total impressions across all pages for this date and query
      const totalImpressions = rows.reduce(
        (sum, row) => sum + (row.impressions || 0),
        0
      );

      // Calculate weighted position (GSC methodology)
      // Position is weighted by impressions across all pages
      const weightedPosition = rows.reduce(
        (sum, row) => sum + (row.position || 0) * (row.impressions || 0),
        0
      );

      // Calculate total clicks across all pages for this date and query
      const totalClicks = rows.reduce(
        (sum, row) => sum + (row.clicks || 0),
        0
      );

      // Create aggregated row with the best page URL and GSC aggregation methodology
      const [date, query] = key.split('_');
      const aggregatedRow: webmasters_v3.Schema$ApiDataRow = {
        keys: [date, query, bestRow.keys?.[2] || ''], // date, query, best page URL (highest impressions)
        clicks: totalClicks, // Sum of clicks across all pages
        impressions: totalImpressions, // Sum of impressions across all pages
        ctr: totalImpressions > 0 ? totalClicks / totalImpressions : 0, // Recalculated CTR
        position: totalImpressions > 0 ? weightedPosition / totalImpressions : 0, // Weighted average position
      };

      aggregatedData.push(aggregatedRow);
    });

    return aggregatedData;
  }

  private async saveTrafficData(
    trafficData: {
      monthly: Record<
        string,
        { clicks: number; impressions: number; ctr: number; position: number }
      >;
      daily: Record<
        string,
        { clicks: number; impressions: number; ctr: number; position: number }
      >;
    },
    campaign: Campaign
  ): Promise<void> {
    try {
      const siteUrl = campaign.searchConsoleSite;

      // Find existing traffic analytics record or create a new one
      let analytics = await prisma.searchConsoleTrafficAnalytics.findFirst({
        where: { siteUrl },
      });

      if (!analytics) {
        analytics = await prisma.searchConsoleTrafficAnalytics.create({
          data: { siteUrl },
        });
      }

      // Save monthly traffic data
      for (const [monthKey, data] of Object.entries(trafficData.monthly)) {
        const [year, month] = monthKey.split('-').map(Number);

        await prisma.searchConsoleTrafficMonthly.upsert({
          where: {
            analyticsId_month_year: {
              analyticsId: analytics.id,
              month,
              year,
            },
          },
          update: {
            clicks: data.clicks,
            impressions: data.impressions,
            ctr: data.ctr,
            position: data.position,
            updatedAt: new Date(),
          },
          create: {
            analyticsId: analytics.id,
            month,
            year,
            clicks: data.clicks,
            impressions: data.impressions,
            ctr: data.ctr,
            position: data.position,
          },
        });
      }

      // Save daily traffic data
      for (const [dateKey, data] of Object.entries(trafficData.daily)) {
        const date = moment.utc(dateKey, 'YYYY-MM-DD').startOf('day').toDate();

        await prisma.searchConsoleTrafficDaily.upsert({
          where: {
            analyticsId_date: {
              analyticsId: analytics.id,
              date,
            },
          },
          update: {
            clicks: data.clicks,
            impressions: data.impressions,
            ctr: data.ctr,
            position: data.position,
            updatedAt: new Date(),
          },
          create: {
            analyticsId: analytics.id,
            date,
            clicks: data.clicks,
            impressions: data.impressions,
            ctr: data.ctr,
            position: data.position,
          },
        });
      }
    } catch (error) {
      console.error('Error saving traffic data:', error);
    }
  }

  /**
   * Save daily site traffic data to database
   */
  private async saveDailySiteTrafficData(
    dailySiteTraffic: Record<
      string,
      { clicks: number; impressions: number; ctr: number; position: number }
    >,
    campaign: Campaign
  ): Promise<void> {
    try {
      const siteUrl = campaign.searchConsoleSite;

      // Find existing traffic analytics record or create a new one
      let trafficAnalytics =
        await prisma.searchConsoleTrafficAnalytics.findFirst({
          where: { siteUrl },
        });

      if (!trafficAnalytics) {
        trafficAnalytics = await prisma.searchConsoleTrafficAnalytics.create({
          data: { siteUrl },
        });
      }

      // Get the last recorded date to avoid checking every record
      const lastRecordedDate = await this.getLastRecordedSiteTrafficDate(
        trafficAnalytics.id
      );

      // Process each day's data
      for (const [dateKey, data] of Object.entries(dailySiteTraffic)) {
        const date = moment.utc(dateKey, 'YYYY-MM-DD').startOf('day').toDate();

        // Skip if we already have data for this date or later
        if (lastRecordedDate && date <= lastRecordedDate) {
          continue;
        }

        // Save daily site traffic data
        await prisma.searchConsoleTrafficDaily.create({
          data: {
            analyticsId: trafficAnalytics.id,
            date: date,
            clicks: data.clicks,
            impressions: data.impressions,
            ctr: data.ctr,
            position: data.position,
          },
        });
      }
    } catch (error) {
      console.error('Error saving daily site traffic data:', error);
    }
  }

  /**
   * Save daily keyword data with dimensions to database
   * This method saves data following Google Search Console's aggregation methodology
   * and selects the top page by impressions for each keyword
   */
  private async saveDailyKeywordDataWithDimensions(
    dailyKeywordData: webmasters_v3.Schema$ApiDataRow[],
    campaign: Campaign
  ): Promise<void> {
    try {
      const siteUrl = campaign.searchConsoleSite;

      // Find existing analytics record or create a new one
      let analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
        where: { siteUrl },
      });

      if (!analytics) {
        analytics = await prisma.searchConsoleKeywordAnalytics.create({
          data: { siteUrl },
        });
      }

      // Get all keywords from the campaign
      const keywords = this.parseCampaignKeywords(campaign);

      // Process each row of data
      for (const row of dailyKeywordData) {
        if (!row.keys || row.keys.length < 3) continue; // Must have date, query, and page

        const dateString = row.keys[0];
        const query = row.keys[1];
        const topPageUrl = row.keys[2]; // This is now the top page by impressions from aggregateDataByDateAndQuery

        // Only process data for our target keywords
        if (!keywords.includes(query)) continue;

        // Find the keyword record or create it if it doesn't exist
        let keywordRecord = await prisma.searchConsoleKeyword.findUnique({
          where: {
            analyticsId_keyword: {
              analyticsId: analytics.id,
              keyword: query,
            },
          },
        });

        if (!keywordRecord) {
          keywordRecord = await prisma.searchConsoleKeyword.create({
            data: {
              analyticsId: analytics.id,
              keyword: query,
              initialPosition: 0,
            },
          });
        }

        const date = moment
          .utc(dateString, 'YYYY-MM-DD')
          .startOf('day')
          .toDate();

        // Upsert daily keyword stat with both averageRank and topRankingPageUrl
        // The position value is now calculated using GSC's weighted average methodology
        await prisma.searchConsoleKeywordDailyStat.upsert({
          where: {
            keywordId_date: {
              keywordId: keywordRecord.id,
              date: date,
            },
          },
          update: {
            searchVolume: row.impressions || 0, // Total impressions across all pages
            averageRank: row.position || 0, // Weighted average position across all pages
            topRankingPageUrl: topPageUrl || '', // Top page by impressions
            updatedAt: new Date(),
          },
          create: {
            keywordId: keywordRecord.id,
            date: date,
            searchVolume: row.impressions || 0, // Total impressions across all pages
            averageRank: row.position || 0, // Weighted average position across all pages
            topRankingPageUrl: topPageUrl || '', // Top page by impressions
          },
        });
      }
    } catch (error) {
      console.error('Error saving daily keyword data with dimensions:', error);
    }
  }

  private async saveInitialPositionData(
    initialPositionData: webmasters_v3.Schema$ApiDataRow[],
    campaign: Campaign
  ): Promise<void> {
    try {
      const siteUrl = campaign.searchConsoleSite;

      // Find existing analytics record or create a new one
      let analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
        where: { siteUrl },
      });

      if (!analytics) {
        analytics = await prisma.searchConsoleKeywordAnalytics.create({
          data: { siteUrl },
        });
      }

      // Get all keywords from the campaign
      const keywords = this.parseCampaignKeywords(campaign);

      // Group initial position data by keyword to calculate average
      const keywordInitialPositions: Record<
        string,
        { totalPosition: number; totalImpressions: number; count: number }
      > = {};

      // Process each row of data and calculate weighted average
      for (const row of initialPositionData) {
        if (!row.keys || row.keys.length < 2) {
          continue;
        }

        const dateString = row.keys[0];
        const query = row.keys[1];

        // Only process data for our target keywords
        if (!keywords.includes(query)) {
          continue;
        }

        const position = row.position || 0;
        const impressions = row.impressions || 0;

        if (!keywordInitialPositions[query]) {
          keywordInitialPositions[query] = {
            totalPosition: 0,
            totalImpressions: 0,
            count: 0,
          };
        }

        keywordInitialPositions[query].totalPosition += position * impressions;
        keywordInitialPositions[query].totalImpressions += impressions;
        keywordInitialPositions[query].count += 1;
      }

      // Update keyword records with calculated initial positions
      for (const [query, data] of Object.entries(keywordInitialPositions)) {
        // Find the keyword record or create it if it doesn't exist
        let keywordRecord = await prisma.searchConsoleKeyword.findUnique({
          where: {
            analyticsId_keyword: {
              analyticsId: analytics.id,
              keyword: query,
            },
          },
        });

        if (!keywordRecord) {
          keywordRecord = await prisma.searchConsoleKeyword.create({
            data: {
              analyticsId: analytics.id,
              keyword: query,
              initialPosition: 0,
            },
          });
        }

        // Calculate weighted average initial position
        const weightedAveragePosition =
          data.totalImpressions > 0
            ? data.totalPosition / data.totalImpressions
            : 0;

        // Update the keyword record with the calculated initial position
        const updatedKeyword = await prisma.searchConsoleKeyword.update({
          where: { id: keywordRecord.id },
          data: {
            initialPosition: weightedAveragePosition,
          },
        });
      }

      // Also save the daily records for the initial position period
      let dailyRecordsSaved = 0;

      for (const row of initialPositionData) {
        if (!row.keys || row.keys.length < 2) continue;

        const dateString = row.keys[0];
        const query = row.keys[1];

        // Only process data for our target keywords
        if (!keywords.includes(query)) continue;

        // Find the keyword record
        const keywordRecord = await prisma.searchConsoleKeyword.findUnique({
          where: {
            analyticsId_keyword: {
              analyticsId: analytics.id,
              keyword: query,
            },
          },
        });

        if (!keywordRecord) {
          continue;
        }

        const date = moment
          .utc(dateString, 'YYYY-MM-DD')
          .startOf('day')
          .toDate();

        // Check if daily data already exists for this date
        const existingDailyStat =
          await prisma.searchConsoleKeywordDailyStat.findUnique({
            where: {
              keywordId_date: {
                keywordId: keywordRecord.id,
                date: date,
              },
            },
          });

        if (existingDailyStat) {
          continue;
        }

        // Save initial position daily data
        const savedDailyStat =
          await prisma.searchConsoleKeywordDailyStat.create({
            data: {
              keywordId: keywordRecord.id,
              date: date,
              averageRank: row.position || 0,
              searchVolume: row.impressions || 0,
              topRankingPageUrl: '', // We don't have this in daily data
            },
          });

        dailyRecordsSaved++;
      }
    } catch (error) {
      console.error('❌ Error saving initial position data:', error);
      throw error; // Re-throw to see the full error stack
    }
  }

  private async logAnalyticsSummary(
    keywordsData: {
      topRankingPages: Record<string, { page: string; impressions: number }>;
      keywordsAnalytics: Record<string, webmasters_v3.Schema$ApiDataRow>;
      keywordsPositions: Record<string, webmasters_v3.Schema$ApiDataRow>;
      keywordsInitialPositions: Record<string, webmasters_v3.Schema$ApiDataRow>;
    },
    campaign: Campaign
  ): Promise<void> {
    try {
      const totalKeywords = Object.keys(keywordsData.keywordsAnalytics).length;
      const totalTopRankingPages = Object.keys(
        keywordsData.topRankingPages
      ).length;
      const totalPositionData = Object.keys(
        keywordsData.keywordsPositions
      ).length;
      const totalInitialPositions = Object.keys(
        keywordsData.keywordsInitialPositions
      ).length;
    } catch (error) {
      console.error('Error logging search console data summary:', error);
      // Don't throw error to avoid breaking the main flow
    }
  }

  /**
   * Fetch daily keyword positions for a specific date range
   */
  private async fetchDailyKeywordsData({
    campaign,
    googleAccount,
    startAt,
    endAt,
    waitForAllData,
  }: {
    campaign: Campaign;
    googleAccount: GoogleAccount;
    startAt: moment.Moment;
    endAt: moment.Moment;
    waitForAllData: boolean;
  }): Promise<webmasters_v3.Schema$ApiDataRow[] | null> {
    try {
      const keywords = this.parseCampaignKeywords(campaign);

      if (keywords.length === 0) {
        return null;
      }

      // Use Search Console API to fetch daily data with date, query, and page dimensions
      // This respects GSC's dimensions requirement
      const analytics = await searchConsoleService.getAnalytics({
        campaign,
        googleAccount,
        startAt: startAt,
        endAt: endAt,
        dimensions: ['date', 'query', 'page'],
      });

      if (!analytics) {
        return null;
      }

      // Process the analytics data to match our expected format
      // We need to handle multiple dates per keyword, so we'll use an array
      // Now we're using the aggregateDataByDateAndQuery method to follow GSC's methodology
      const filteredAnalytics = analytics.filter((row) => {
        if (row.keys && row.keys.length >= 3) {
          const query = row.keys[1];
          return keywords.includes(query);
        }
        return false;
      });

      // Group by date and query, then aggregate to get the page with most impressions
      // This follows GSC's methodology for selecting top pages by impressions
      const processedData = this.aggregateDataByDateAndQuery(filteredAnalytics);

      return processedData;
    } catch (error) {
      console.error('Error fetching daily keywords data:', error);
      return null;
    }
  }

  /**
   * Save daily keyword positions to the database
   */
  private async saveDailyKeywordsData(
    dailyKeywordsData: webmasters_v3.Schema$ApiDataRow[],
    campaign: Campaign
  ): Promise<void> {
    try {
      const siteUrl = campaign.searchConsoleSite;
      const targetDate = moment().subtract(3, 'days').startOf('day');
      const targetDateString = targetDate.format('YYYY-MM-DD');

      // Find existing analytics record
      const analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
        where: { siteUrl },
      });

      if (!analytics) {
        return;
      }

      // Get all keywords from the campaign
      const keywords = this.parseCampaignKeywords(campaign);

      // Process each keyword
      for (const keyword of keywords) {
        const trimmedKeyword = keyword.trim();
        if (!trimmedKeyword) continue;

        // Find the keyword record
        const keywordRecord = await prisma.searchConsoleKeyword.findUnique({
          where: {
            analyticsId_keyword: {
              analyticsId: analytics.id,
              keyword: trimmedKeyword,
            },
          },
        });

        if (!keywordRecord) {
          continue;
        }

        // Check if daily data already exists for this date
        const existingDailyStat =
          await prisma.searchConsoleKeywordDailyStat.findUnique({
            where: {
              keywordId_date: {
                keywordId: keywordRecord.id,
                date: targetDate.toDate(),
              },
            },
          });

        // Find position data for this keyword and target date
        // Now we expect data to have date, query, and page dimensions
        const positionData = dailyKeywordsData.find(
          (row) =>
            row.keys &&
            row.keys.length >= 3 &&
            row.keys[0] === targetDateString &&
            row.keys[1] === trimmedKeyword
        );

        if (!positionData) {
          continue;
        }

        const topPageUrl = positionData.keys?.[2] || '';

        // Upsert daily stat to database with both averageRank and topRankingPageUrl
        await prisma.searchConsoleKeywordDailyStat.upsert({
          where: {
            keywordId_date: {
              keywordId: keywordRecord.id,
              date: targetDate.toDate(),
            },
          },
          update: {
            averageRank: positionData.position || 0, // Weighted average position across all pages
            searchVolume: positionData.impressions || 0, // Total impressions across all pages
            topRankingPageUrl: topPageUrl, // Top page by impressions
            updatedAt: new Date(),
          },
          create: {
            keywordId: keywordRecord.id,
            date: targetDate.toDate(),
            averageRank: positionData.position || 0, // Weighted average position across all pages
            searchVolume: positionData.impressions || 0, // Total impressions across all pages
            topRankingPageUrl: topPageUrl, // Top page by impressions
          },
        });
      }
    } catch (error) {
      console.error('Error saving daily keywords data:', error);
    }
  }

  /**
   * Save historical daily keyword positions to the database
   * This method processes data for a date range and handles multiple dates
   */
  private async saveHistoricalDailyKeywords(
    dailyKeywordsData: webmasters_v3.Schema$ApiDataRow[],
    campaign: Campaign,
    startAt: moment.Moment,
    endAt: moment.Moment
  ): Promise<void> {
    try {
      const siteUrl = campaign.searchConsoleSite;

      // Find existing analytics record or create a new one
      let analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
        where: { siteUrl },
      });

      if (!analytics) {
        analytics = await prisma.searchConsoleKeywordAnalytics.create({
          data: { siteUrl },
        });
      }

      // Get all keywords from the campaign
      const keywords = this.parseCampaignKeywords(campaign);

      // Process each row of data
      for (const row of dailyKeywordsData) {
        if (!row.keys || row.keys.length < 2) continue;

        const dateString = row.keys[0];
        const query = row.keys[1];

        // Only process data for our target keywords
        if (!keywords.includes(query)) continue;

        // Find the keyword record or create it if it doesn't exist
        let keywordRecord = await prisma.searchConsoleKeyword.findUnique({
          where: {
            analyticsId_keyword: {
              analyticsId: analytics.id,
              keyword: query,
            },
          },
        });

        if (!keywordRecord) {
          keywordRecord = await prisma.searchConsoleKeyword.create({
            data: {
              analyticsId: analytics.id,
              keyword: query,
              initialPosition: 0,
            },
          });
        }

        const date = moment
          .utc(dateString, 'YYYY-MM-DD')
          .startOf('day')
          .toDate();

        // We now expect all data to have date, query, and page dimensions
        // The data has already been aggregated using GSC's methodology in aggregateDataByDateAndQuery
        if (row.keys && row.keys.length >= 3) {
          const topPageUrl = row.keys[2]; // Top page by impressions
          
          // Save both averageRank and topRankingPageUrl in one operation
          await prisma.searchConsoleKeywordDailyStat.upsert({
            where: {
              keywordId_date: {
                keywordId: keywordRecord.id,
                date: date,
              },
            },
            update: {
              averageRank: row.position || 0, // Weighted average position across all pages
              searchVolume: row.impressions || 0, // Total impressions across all pages
              topRankingPageUrl: topPageUrl || '', // Top page by impressions
              updatedAt: new Date(),
            },
            create: {
              keywordId: keywordRecord.id,
              date: date,
              averageRank: row.position || 0, // Weighted average position across all pages
              searchVolume: row.impressions || 0, // Total impressions across all pages
              topRankingPageUrl: topPageUrl || '', // Top page by impressions
            },
          });
        }
      }
    } catch (error) {
      console.error('Error saving historical daily keywords data:', error);
    }
  }

  /**
   * Save daily traffic data to the database
   */
  private async saveDailyTrafficData(
    dailyTrafficData: Record<
      string,
      { clicks: number; impressions: number; ctr: number; position: number }
    >,
    campaign: Campaign
  ): Promise<void> {
    try {
      const siteUrl = campaign.searchConsoleSite;

      // Find existing traffic analytics record or create a new one
      let trafficAnalytics =
        await prisma.searchConsoleTrafficAnalytics.findFirst({
          where: { siteUrl },
        });

      if (!trafficAnalytics) {
        trafficAnalytics = await prisma.searchConsoleTrafficAnalytics.create({
          data: { siteUrl },
        });
      }

      // Process each day's data
      for (const [dateKey, data] of Object.entries(dailyTrafficData)) {
        const date = moment.utc(dateKey, 'YYYY-MM-DD').toDate();

        // Check if daily data already exists for this date
        const existingDailyData =
          await prisma.searchConsoleTrafficDaily.findUnique({
            where: {
              analyticsId_date: {
                analyticsId: trafficAnalytics.id,
                date: date,
              },
            },
          });

        if (existingDailyData) {
          continue;
        }

        // Save daily traffic data
        await prisma.searchConsoleTrafficDaily.create({
          data: {
            analyticsId: trafficAnalytics.id,
            date: date,
            clicks: data.clicks,
            impressions: data.impressions,
            ctr: data.ctr,
            position: data.position,
          },
        });
      }
    } catch (error) {
      console.error('Error saving daily traffic data:', error);
    }
  }

  /**
   * Parse campaign keywords from the keywords string
   */
  private parseCampaignKeywords(campaign: Campaign): string[] {
    return campaign.keywords.split('\n').filter((k) => k.trim());
  }

  /**
   * Get the last recorded date for daily site traffic data
   */
  private async getLastRecordedSiteTrafficDate(
    analyticsId: string
  ): Promise<Date | null> {
    const lastRecord = await prisma.searchConsoleTrafficDaily.findFirst({
      where: { analyticsId },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    return lastRecord?.date || null;
  }

  /**
   * Get the last recorded date for daily keyword data
   */
  private async getLastRecordedKeywordDate(
    analyticsId: string
  ): Promise<Date | null> {
    const lastRecord = await prisma.searchConsoleKeywordDailyStat.findFirst({
      where: {
        keyword: {
          analyticsId,
        },
      },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    return lastRecord?.date || null;
  }

  /**
   * Get the last recorded date for a specific keyword
   */
  private async getLastRecordedKeywordDateForSpecificKeyword(
    keywordId: string
  ): Promise<Date | null> {
    const lastRecord = await prisma.searchConsoleKeywordDailyStat.findFirst({
      where: {
        keywordId,
      },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    return lastRecord?.date || null;
  }

  /**
   * Check if we have complete daily data for a specific month
   */
  private async checkIfMonthHasCompleteData(
    monthStart: moment.Moment,
    monthEnd: moment.Moment,
    keywords: string[],
    siteUrl: string
  ): Promise<boolean> {
    try {
      const analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
        where: { siteUrl },
        include: {
          keywords: {
            include: {
              dailyStats: {
                where: {
                  date: {
                    gte: monthStart.toDate(),
                    lte: monthEnd.toDate(),
                  },
                },
              },
            },
          },
        },
      });

      if (!analytics || !analytics.keywords.length) return false;

      // Check if we have data for all keywords for all days in the month
      const daysInMonth = monthEnd.diff(monthStart, 'days') + 1;

      for (const keyword of analytics.keywords) {
        if (!keywords.includes(keyword.keyword)) continue;

        // Check if we have daily records for all days in this month
        if (keyword.dailyStats.length < daysInMonth) {
          return false;
        }

        // Check if all records have complete data (both averageRank and topRankingPageUrl)
        for (const dailyStat of keyword.dailyStats) {
          if (
            dailyStat.averageRank === null &&
            dailyStat.topRankingPageUrl === ''
          ) {
            return false;
          }
        }
      }
      return true;
    } catch (error) {
      console.error('Error checking month completeness:', error);
      return false;
    }
  }
}