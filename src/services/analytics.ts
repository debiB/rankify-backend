import { prisma } from '../utils/prisma';
import { Campaign, GoogleAccount } from '@prisma/client';
import moment from 'moment-timezone';
import { webmasters_v3 } from 'googleapis';
import { searchConsoleService } from './searchConsole';

import * as path from 'path';

// Debug logging function
const debugLog = (message: string) => {
  const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
  console.log(`[${timestamp}] ${message}`);
};

const DAY_TO_FETCH_MONTHLY_POSITION = 28;

export class AnalyticsService {
  async fetchAndSaveAnalytics({
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

      const keywordsData = await this.fetchKeywordsData({
        campaign,
        googleAccount,
        waitForAllData,
      });
      if (!keywordsData) {
        return false;
      }

      const saved = await this.saveKeywordsData(keywordsData, campaign);
      if (!saved) {
        return false;
      }

      // Fetch and save traffic data
      const trafficData = await this.fetchTrafficData({
        campaign,
        googleAccount,
        waitForAllData,
      });
      if (trafficData) {
        await this.saveTrafficData(trafficData, campaign);
      }

      // Log data summary
      await this.logSearchConsoleDataSummary(keywordsData, campaign);

      return true;
    } catch (error) {
      console.error('Error fetching and saving analytics:', error);
      return false;
    }
  }

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

      // Fetch and save daily keyword positions
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
  async fetchAndSaveHistoricalDailyData({
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

      console.log(
        `📅 Fetching historical daily data for campaign: ${campaign.name}`
      );
      console.log(`   Start date: ${campaignStartDate.format('YYYY-MM-DD')}`);
      console.log(`   End date: ${endDate.format('YYYY-MM-DD')}`);

      // Fetch historical daily data month by month to avoid API limits
      let currentDate = campaignStartDate.clone();

      while (currentDate.isSameOrBefore(endDate)) {
        const monthStart = currentDate.clone().startOf('month');
        const monthEnd = currentDate.clone().endOf('month');

        // Don't go beyond the end date
        const actualEnd = monthEnd.isAfter(endDate) ? endDate : monthEnd;

        console.log(`   Fetching month: ${monthStart.format('YYYY-MM')}`);

        // Fetch daily keyword positions for this month
        const dailyKeywordsData = await this.fetchDailyKeywordsData({
          campaign,
          googleAccount,
          startAt: monthStart,
          endAt: actualEnd,
          waitForAllData,
        });

        console.log(
          `🔍 DEBUG - Daily keywords data for ${monthStart.format(
            'YYYY-MM-DD'
          )} to ${actualEnd.format('YYYY-MM-DD')}:`,
          dailyKeywordsData?.length || 0
        );

        if (dailyKeywordsData) {
          await this.saveHistoricalDailyKeywordsData(
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

  private async fetchKeywordsData({
    campaign,
    googleAccount,
    waitForAllData,
  }: {
    campaign: Campaign;
    googleAccount: GoogleAccount;
    waitForAllData: boolean;
  }) {
    try {
      const keywords = campaign.keywords.split('\n').filter((k) => k.trim());
      if (!keywords.length) {
        return null;
      }

      const analytics: {
        topRankingPages: Record<string, { page: string; impressions: number }>;
        keywordsAnalytics: Record<string, webmasters_v3.Schema$ApiDataRow>;
        keywordsPositions: Record<string, webmasters_v3.Schema$ApiDataRow>;
        keywordsInitialPositions: Record<
          string,
          webmasters_v3.Schema$ApiDataRow
        >;
      } = {
        topRankingPages: {},
        keywordsAnalytics: {},
        keywordsPositions: {},
        keywordsInitialPositions: {},
      };

      // Get existing analytics record
      const existingAnalytics =
        await prisma.searchConsoleKeywordAnalytics.findFirst({
          where: { siteUrl: campaign.searchConsoleSite },
          include: {
            keywords: {
              include: {
                monthlyStats: {
                  orderBy: [{ year: 'desc' }, { month: 'desc' }],
                },
              },
            },
          },
        });

      // Find the last month we have data for
      const lastDataMonth = this.getLastDataMonth(existingAnalytics);

      // Calculate the starting date for fetching new data
      const startingDate = moment(campaign.startingDate).startOf('month');
      const fetchStartDate = lastDataMonth
        ? moment()
            .year(lastDataMonth.year)
            .month(lastDataMonth.month - 1)
            .add(1, 'month')
            .startOf('month')
        : startingDate;

      // Calculate months to fetch, excluding the current month due to 3-day delay
      const currentDate = moment();
      const endDate = currentDate.clone().subtract(1, 'month').endOf('month');
      const monthsCount = endDate.diff(fetchStartDate, 'months');

      // Ensure we don't fetch the current month
      const finalMonthsCount = Math.max(0, monthsCount);

      debugLog('=== DEBUG: Month Fetching Logic ===');
      debugLog('Current date: ' + currentDate.format('YYYY-MM-DD'));
      debugLog('Fetch start date: ' + fetchStartDate.format('YYYY-MM-DD'));
      debugLog('End date (previous month): ' + endDate.format('YYYY-MM-DD'));
      debugLog('Months count: ' + monthsCount);
      debugLog('Final months count: ' + finalMonthsCount);
      debugLog('Last data month: ' + JSON.stringify(lastDataMonth));
      debugLog('=====================================');

      // Load existing data from database
      if (existingAnalytics && lastDataMonth) {
        analytics.topRankingPages =
          this.getAllTopRankingPagesFromDB(existingAnalytics);
        analytics.keywordsAnalytics =
          this.getAllKeywordsAnalyticsFromDB(existingAnalytics);
        analytics.keywordsPositions =
          this.getAllPositionDataFromDB(existingAnalytics);
        analytics.keywordsInitialPositions = this.getInitialPositionsFromDB(
          existingAnalytics,
          keywords
        );
      }

      // Fetch new data only from the last data month onwards
      debugLog('=== DEBUG: Starting month loop ===');
      debugLog('Loop will run from i=0 to i=' + finalMonthsCount);

      for (let i = 0; i <= finalMonthsCount; i++) {
        let startAt = fetchStartDate.clone().add(i, 'months');
        let endAt = startAt.clone().endOf('month');

        debugLog(
          `Loop iteration ${i}: Processing ${startAt.format(
            'YYYY-MM'
          )} (${startAt.format('YYYY-MM-DD')} to ${endAt.format('YYYY-MM-DD')})`
        );

        // Skip if this month is not over yet
        if (endAt.isAfter(moment())) {
          debugLog(
            `Skipping ${startAt.format('YYYY-MM')} - month not over yet`
          );
          continue;
        }

        // Fetch data for this specific month
        debugLog(`Calling fetchMonthData for ${startAt.format('YYYY-MM')}`);
        const monthData = await this.fetchMonthData({
          campaign,
          googleAccount,
          startAt,
          endAt,
          waitForAllData,
          keywords,
        });

        if (monthData) {
          // Save this month's data immediately
          await this.saveMonthData(monthData, campaign, startAt);

          // Accumulate the data for the JSON export
          if (monthData.topRankingPages) {
            Object.assign(analytics.topRankingPages, monthData.topRankingPages);
          }
          if (monthData.keywordsAnalytics) {
            Object.assign(
              analytics.keywordsAnalytics,
              monthData.keywordsAnalytics
            );
          }
          if (monthData.keywordsPositions) {
            Object.assign(
              analytics.keywordsPositions,
              monthData.keywordsPositions
            );
          }
        }
      }

      // Fetch and save initial positions if we don't have them
      if (!this.hasInitialPositionsData(existingAnalytics, keywords)) {
        const keywordsInitialPositions =
          await this.fetchKeywordsDataOnSpecificDate({
            campaign,
            googleAccount,
            date: moment(campaign.startingDate).startOf('day'),
            waitForAllData,
            keywords,
          });
        if (keywordsInitialPositions) {
          await this.saveInitialPositions(keywordsInitialPositions, campaign);
          // Accumulate initial positions for JSON export
          Object.assign(
            analytics.keywordsInitialPositions,
            keywordsInitialPositions
          );
        }
      }

      return analytics;
    } catch (error) {
      console.error('Error fetching keywords data:', error);
      return null;
    }
  }

  private async fetchMonthData({
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
  }) {
    try {
      // Don't fetch data for the current month due to 3-day delay in Google Search Console
      const currentDate = moment();
      const isCurrentMonth =
        startAt.month() === currentDate.month() &&
        startAt.year() === currentDate.year();

      if (isCurrentMonth) {
        debugLog(
          `Skipping fetch for current month ${startAt.format(
            'YYYY-MM'
          )} - waiting for next month due to 3-day data delay`
        );
        return null;
      }
      // Fetch top ranking pages for this month
      const topRankingPages = await this.fetchKeywordsTopRankingPages({
        campaign,
        googleAccount,
        startAt,
        endAt,
        waitForAllData,
        keywords,
      });

      // Fetch keywords analytics for this month
      const keywordsAnalytics = await this.fetchKeywordsAnalytics({
        campaign,
        googleAccount,
        startAt,
        endAt,
        waitForAllData,
        keywords,
      });

      // Fetch position data for this month
      const keywordsPositions = await this.fetchKeywordsDataOnSpecificDate({
        campaign,
        googleAccount,
        date: startAt
          .clone()
          .date(DAY_TO_FETCH_MONTHLY_POSITION)
          .startOf('day'),
        waitForAllData,
        keywords,
      });

      return {
        topRankingPages,
        keywordsAnalytics,
        keywordsPositions,
      };
    } catch (error) {
      console.error('Error fetching month data:', error);
      return null;
    }
  }

  private async saveMonthData(
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
        `saveMonthData called for ${monthDate.format('YYYY-MM')} - campaign: ${
          campaign.name
        }`
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
      const keywords = campaign.keywords.split('\n').filter((k) => k.trim());

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
      const keywords = campaign.keywords.split('\n').filter((k) => k.trim());

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

  private async fetchKeywordsTopRankingPages({
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
      const topRankingPageAnalytics = await searchConsoleService.getAnalytics({
        campaign,
        googleAccount,
        waitForAllData,
        startAt,
        endAt,
        dimensions: ['query', 'page'],
      });
      if (!topRankingPageAnalytics) {
        return null;
      }

      const filteredAnalytics = topRankingPageAnalytics.filter(({ keys }) =>
        keywords.includes(keys?.[0] as string)
      );

      // Group by keyword
      const groupedAnalytics = filteredAnalytics.reduce(
        (acc, { keys, ...rest }) => {
          const keyword = keys?.[0] as string;
          const page = keys?.[1] as string;
          if (!acc[keyword]) {
            acc[keyword] = [];
          }
          acc[keyword].push({
            impressions: rest.impressions ?? 0,
            page,
          });
          return acc;
        },
        {} as Record<string, { page: string; impressions: number }[]>
      );

      // Keep only the top page by impressions and discard the rest for each keyword
      const keywordsTopPages = Object.entries(groupedAnalytics).map(
        ([keyword, positions]) => ({
          keyword,
          page: positions.sort((a, b) => b.impressions - a.impressions)?.[0]
            ?.page,
          impressions: positions.sort(
            (a, b) => b.impressions - a.impressions
          )?.[0]?.impressions,
        })
      );

      // Change the structure of the data to be keyword: { page: string, impressions: number }
      const groupedKeywordsTopPages = keywordsTopPages.reduce(
        (acc, { keyword, page, impressions }) => {
          acc[keyword] = { page, impressions };
          return acc;
        },
        {} as Record<string, { page: string; impressions: number }>
      );

      return groupedKeywordsTopPages;
    } catch (error) {
      console.error('Error fetching top ranking page analytics:', error);
      return null;
    }
  }

  private async fetchKeywordsAnalytics({
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

      // Change the structure of the data to be keyword: { impressions: number, etc. }
      const groupedAnalytics = filteredAnalytics?.reduce(
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
      console.error('Error fetching impressions:', error);
      return null;
    }
  }

  private async fetchKeywordsDataOnSpecificDate({
    campaign,
    googleAccount,
    date,
    waitForAllData,
    keywords,
  }: {
    campaign: Campaign;
    googleAccount: GoogleAccount;
    date: moment.Moment;
    waitForAllData: boolean;
    keywords: string[];
  }): Promise<Record<string, webmasters_v3.Schema$ApiDataRow> | null> {
    try {
      const data = await searchConsoleService.getAnalytics({
        campaign,
        googleAccount,
        waitForAllData,
        startAt: date,
        endAt: date,
        dimensions: ['query'],
      });

      const filteredData = data?.filter(({ keys }) =>
        keywords.includes(keys?.[0] as string)
      );

      // Change the structure of the data to be keyword: { position: number, etc. }[]
      const groupedData = filteredData?.reduce((acc, { keys, ...rest }) => {
        const keyword = keys?.[0] as string;
        if (!acc[keyword]) {
          acc[keyword] = rest;
        }
        return acc;
      }, {} as Record<string, webmasters_v3.Schema$ApiDataRow>);

      if (!groupedData) {
        return null;
      }

      return groupedData;
    } catch (error) {
      console.error('Error fetching keywords positions:', error);
      return null;
    }
  }

  // Helper methods to check and retrieve data from database
  private getLastDataMonth(
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

  private getAllKeywordsAnalyticsFromDB(
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

  private hasTopRankingPagesData(
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

  private getTopRankingPagesFromDB(
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

  private hasKeywordsAnalyticsData(
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

  private getKeywordsAnalyticsFromDB(
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

  private hasPositionData(
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

  private getPositionDataFromDB(
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

  private hasInitialPositionsData(
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

  private getInitialPositionsFromDB(
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

  private async saveKeywordsData(
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
      const keywords = campaign.keywords.split('\n').filter((k) => k.trim());

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

        // Note: Monthly stats are now handled by saveMonthData method
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
        position: parseFloat(avgPosition.toFixed(2)),
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
            position: parseFloat((row.position || 0).toFixed(2)),
          };
        }
      });

      return dailyData;
    } catch (error) {
      console.error('Error fetching daily traffic data:', error);
      return null;
    }
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
        const date = moment(dateKey).toDate();

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

      console.log(`Successfully saved traffic data for site: ${siteUrl}`);
    } catch (error) {
      console.error('Error saving traffic data:', error);
    }
  }

  private async logSearchConsoleDataSummary(
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

      console.log(
        `📊 Search console data summary for campaign ${campaign.name}:`
      );
      console.log(`   Keywords: ${totalKeywords}`);
      console.log(`   Top ranking pages: ${totalTopRankingPages}`);
      console.log(`   Position data: ${totalPositionData}`);
      console.log(`   Initial positions: ${totalInitialPositions}`);
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
      const keywords = campaign.keywords.split('\n').filter((k) => k.trim());

      if (keywords.length === 0) {
        return null;
      }

      // Use Search Console API to fetch daily data with date and query dimensions
      const analytics = await searchConsoleService.getAnalytics({
        campaign,
        googleAccount,
        startAt: startAt,
        endAt: endAt,
        dimensions: ['date', 'query'],
      });

      console.log('Daily Analytics:', {
        startAt: startAt.format('YYYY-MM-DD'),
        endAt: endAt.format('YYYY-MM-DD'),
        dimensions: ['date', 'query'],
        rows: analytics?.length || 0,
      });

      // Log analytics data for debugging
      if (analytics && analytics.length > 0) {
        console.log(`📊 Daily analytics data: ${analytics.length} rows`);
      }

      if (!analytics) {
        return null;
      }

      // Process the analytics data to match our expected format
      // We need to handle multiple dates per keyword, so we'll use an array
      const processedData: webmasters_v3.Schema$ApiDataRow[] = [];

      analytics.forEach((row: webmasters_v3.Schema$ApiDataRow) => {
        if (row.keys && row.keys.length >= 2) {
          const date = row.keys[0];
          const query = row.keys[1];

          // Only include data for our target keywords
          if (keywords.includes(query)) {
            processedData.push({
              keys: [date, query],
              clicks: row.clicks || 0,
              impressions: row.impressions || 0,
              ctr: row.ctr || 0,
              position: row.position || 0,
            });
          }
        }
      });

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
        console.log('No analytics record found for daily keywords data');
        return;
      }

      // Get all keywords from the campaign
      const keywords = campaign.keywords.split('\n').filter((k) => k.trim());

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
          console.log(`Keyword record not found for: ${trimmedKeyword}`);
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

        if (existingDailyStat) {
          console.log(
            `Daily data already exists for ${trimmedKeyword} on ${targetDateString}`
          );
          continue;
        }

        // Find position data for this keyword and target date
        const positionData = dailyKeywordsData.find(
          (row) =>
            row.keys &&
            row.keys.length >= 2 &&
            row.keys[0] === targetDateString &&
            row.keys[1] === trimmedKeyword
        );

        if (!positionData) {
          console.log(
            `No position data found for keyword: ${trimmedKeyword} on ${targetDateString}`
          );
          continue;
        }

        // Save daily stat
        await prisma.searchConsoleKeywordDailyStat.create({
          data: {
            keywordId: keywordRecord.id,
            date: targetDate.toDate(),
            averageRank: parseFloat((positionData.position || 0).toFixed(2)),
            searchVolume: positionData.impressions || 0,
            topRankingPageUrl: '', // We don't have this in daily data
          },
        });

        console.log(
          `Saved daily data for keyword: ${trimmedKeyword} on ${targetDateString}`
        );
      }
    } catch (error) {
      console.error('Error saving daily keywords data:', error);
    }
  }

  /**
   * Save historical daily keyword positions to the database
   * This method processes data for a date range and handles multiple dates
   */
  private async saveHistoricalDailyKeywordsData(
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
        console.log(`Creating new analytics record for site: ${siteUrl}`);
        analytics = await prisma.searchConsoleKeywordAnalytics.create({
          data: { siteUrl },
        });
      }

      // Get all keywords from the campaign
      const keywords = campaign.keywords.split('\n').filter((k) => k.trim());

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
          console.log(`Creating keyword record for: ${query}`);
          keywordRecord = await prisma.searchConsoleKeyword.create({
            data: {
              analyticsId: analytics.id,
              keyword: query,
              initialPosition: 0,
            },
          });
        }

        const date = moment(dateString, 'YYYY-MM-DD')
          .startOf('day')
          .utc()
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
          console.log(
            `Daily data already exists for ${query} on ${dateString}`
          );
          continue;
        }

        // Save daily stat
        await prisma.searchConsoleKeywordDailyStat.create({
          data: {
            keywordId: keywordRecord.id,
            date: date,
            averageRank: parseFloat((row.position || 0).toFixed(2)),
            searchVolume: row.impressions || 0,
            topRankingPageUrl: '', // We don't have this in daily data
          },
        });

        console.log(
          `Saved historical daily data for keyword: ${query} on ${dateString}`
        );
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
        const date = moment(dateKey).toDate();

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
          console.log(`Daily traffic data already exists for ${dateKey}`);
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

        console.log(`Saved daily traffic data for ${dateKey}`);
      }
    } catch (error) {
      console.error('Error saving daily traffic data:', error);
    }
  }
}
