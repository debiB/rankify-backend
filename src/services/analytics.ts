import { prisma } from '../utils/prisma';
import { Campaign, GoogleAccount } from '@prisma/client';
import moment from 'moment-timezone';
import { webmasters_v3 } from 'googleapis';
import { searchConsoleService } from './searchConsole';
import * as fs from 'fs';
import * as path from 'path';

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

      // Save JSON file with all fetched data
      await this.saveSearchConsoleDataToJson(keywordsData, campaign);

      return true;
    } catch (error) {
      console.error('Error fetching and saving analytics:', error);
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

      const monthsCount = moment().diff(fetchStartDate, 'months');

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
      for (let i = 0; i <= monthsCount; i++) {
        let startAt = fetchStartDate.clone().add(i, 'months');
        let endAt = startAt.clone().endOf('month');

        // Skip if this month is not over yet
        if (endAt.isAfter(moment())) {
          continue;
        }

        // Fetch data for this specific month
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

        // Process monthly stats if we have position data
        if (keywordsData.keywordsPositions[trimmedKeyword]) {
          const positionData = keywordsData.keywordsPositions[trimmedKeyword];
          const currentMonth = moment().month() + 1; // moment months are 0-indexed
          const currentYear = moment().year();

          // Get top ranking page from topRankingPages and decode it
          const rawTopRankingPage =
            keywordsData.topRankingPages[trimmedKeyword]?.page || '';
          const topRankingPage = rawTopRankingPage
            ? decodeURIComponent(rawTopRankingPage)
            : '';

          // Get search volume from keywordsAnalytics
          const analyticsData = keywordsData.keywordsAnalytics[trimmedKeyword];
          const searchVolume = analyticsData?.impressions || 0;

          // Create or update monthly stat
          await prisma.searchConsoleKeywordMonthlyStat.upsert({
            where: {
              keywordId_month_year: {
                keywordId: keywordRecord.id,
                month: currentMonth,
                year: currentYear,
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
              month: currentMonth,
              year: currentYear,
              averageRank: positionData.position || 0,
              searchVolume,
              topRankingPageUrl: topRankingPage,
            },
          });
        }
      }

      return true;
    } catch (error) {
      console.error('Error saving keywords data:', error);
      return false;
    }
  }

  private async saveSearchConsoleDataToJson(
    keywordsData: {
      topRankingPages: Record<string, { page: string; impressions: number }>;
      keywordsAnalytics: Record<string, webmasters_v3.Schema$ApiDataRow>;
      keywordsPositions: Record<string, webmasters_v3.Schema$ApiDataRow>;
      keywordsInitialPositions: Record<string, webmasters_v3.Schema$ApiDataRow>;
    },
    campaign: Campaign
  ): Promise<void> {
    try {
      // Create exports directory if it doesn't exist
      const exportDir = path.join(process.cwd(), 'exports');
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }

      // Generate filename with timestamp and campaign info
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const campaignName = campaign.name.replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `search-console-data-${campaignName}-${timestamp}.json`;
      const filepath = path.join(exportDir, filename);

      // Get monthly breakdown data from database
      const analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
        where: { siteUrl: campaign.searchConsoleSite },
        include: {
          keywords: {
            include: {
              monthlyStats: {
                orderBy: [{ year: 'asc' }, { month: 'asc' }],
              },
            },
          },
        },
      });

      // Prepare monthly breakdown data
      const monthlyBreakdown: Record<string, any> = {};
      if (analytics) {
        analytics.keywords.forEach((keyword) => {
          monthlyBreakdown[keyword.keyword] = {
            initialPosition: keyword.initialPosition,
            monthlyStats: keyword.monthlyStats.map((stat) => ({
              month: stat.month,
              year: stat.year,
              averageRank: stat.averageRank,
              searchVolume: stat.searchVolume,
              topRankingPageUrl: stat.topRankingPageUrl,
            })),
          };
        });
      }

      // Prepare the export data
      const exportData = {
        exportDate: new Date().toISOString(),
        campaign: {
          id: campaign.id,
          name: campaign.name,
          searchConsoleSite: campaign.searchConsoleSite,
          startingDate: campaign.startingDate,
        },
        dataSummary: {
          totalKeywords: Object.keys(keywordsData.keywordsAnalytics).length,
          totalTopRankingPages: Object.keys(keywordsData.topRankingPages)
            .length,
          totalPositionData: Object.keys(keywordsData.keywordsPositions).length,
          totalInitialPositions: Object.keys(
            keywordsData.keywordsInitialPositions
          ).length,
          totalMonthlyRecords:
            analytics?.keywords.reduce(
              (total, keyword) => total + keyword.monthlyStats.length,
              0
            ) || 0,
        },
        keywordsData: {
          topRankingPages: keywordsData.topRankingPages,
          keywordsAnalytics: keywordsData.keywordsAnalytics,
          keywordsPositions: keywordsData.keywordsPositions,
          keywordsInitialPositions: keywordsData.keywordsInitialPositions,
        },
        monthlyBreakdown: monthlyBreakdown,
      };

      // Write the JSON file
      fs.writeFileSync(filepath, JSON.stringify(exportData, null, 2));

      console.log(`Successfully saved search console data to: ${filepath}`);
      console.log(
        `Data summary: ${exportData.dataSummary.totalKeywords} keywords, ${exportData.dataSummary.totalTopRankingPages} top pages, ${exportData.dataSummary.totalMonthlyRecords} monthly records`
      );
    } catch (error) {
      console.error('Error saving search console data to JSON:', error);
      // Don't throw error to avoid breaking the main flow
    }
  }
}
