import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, adminProcedure, router } from '../context';
import { prisma } from '../../utils/prisma';
import { AnalyticsService } from '../../services/analytics';
import { keywordCannibalizationService } from '../../services/keywordCannibalization';
import { searchConsoleService } from '../../services/searchConsole';
import fs from 'fs';
import path from 'path';
import moment from 'moment';
// Import Prisma types to ensure proper type checking
import type { Prisma, PrismaClient } from '@prisma/client';

const analyticsService = new AnalyticsService();

/**
 * Utility function to aggregate daily stats for a given period
 * Calculates weighted average position and total search volume for the last N days
 */
const aggregateDailyStats = (stats: any[], days: number = 7) => {
  if (stats.length === 0) return null;

  // Sort by date and get the last N days
  const sortedStats = [...stats].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const lastDaysStats = sortedStats.slice(-days);

  if (lastDaysStats.length === 0) return null;

  // Calculate weighted average position (weighted by search volume)
  let totalSearchVolume = 0;
  let weightedPositionSum = 0;
  let totalImpressions = 0;

  lastDaysStats.forEach((stat) => {
    const searchVolume = stat.searchVolume || 0;
    const position = stat.averageRank || 0;

    totalSearchVolume += searchVolume;
    weightedPositionSum += position * searchVolume;
    totalImpressions += searchVolume; // searchVolume is essentially impressions
  });

  const averagePosition =
    totalImpressions > 0
      ? weightedPositionSum / totalImpressions
      : lastDaysStats[0]?.averageRank || 0;

  return {
    averagePosition: parseFloat(averagePosition.toFixed(2)),
    totalSearchVolume,
    daysCount: lastDaysStats.length,
  };
};

/**
 * Shared helper to process raw Search Console keywords into the frontend format
 * Returns processed keywords and the sorted list of months keys (M/YYYY)
 */
async function processKeywordsForCampaign({
  campaign,
  keywords,
  selectedMonth,
}: {
  campaign: any;
  keywords: any[];
  selectedMonth?: string;
}): Promise<{ keywords: Array<any>; months: string[] }> {
  try {
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

    const processed = keywords.map((keyword) => {
      try {
        const monthlyData: Record<string, number | null> = {};

        // Initialize all months from campaign start to current
        for (
          let year = new Date(campaign.startingDate).getFullYear();
          year <= currentYear;
          year++
        ) {
          const startMonth =
            year === new Date(campaign.startingDate).getFullYear()
              ? new Date(campaign.startingDate).getMonth() + 1
              : 1;
          const endMonth = year === currentYear ? currentMonth : 12;
          for (let month = startMonth; month <= endMonth; month++) {
            const monthKey = `${month}/${year}`;
            monthlyData[monthKey] = null;
          }
        }

        // Initial rank from 7 days before campaign start
        let initialRank = keyword.initialPosition || 0;
        if (keyword.dailyStats && Array.isArray(keyword.dailyStats)) {
          const campaignStartDate = new Date(campaign.startingDate);
          const initialPositionStartDate = new Date(campaignStartDate);
          initialPositionStartDate.setDate(
            initialPositionStartDate.getDate() - 7
          );
          const initialPositionEndDate = new Date(campaignStartDate);
          initialPositionEndDate.setDate(initialPositionEndDate.getDate() - 1);

          const initialPositionStats = keyword.dailyStats.filter(
            (stat: any) => {
              if (stat && stat.date) {
                const statDate = new Date(stat.date);
                return (
                  statDate >= initialPositionStartDate &&
                  statDate <= initialPositionEndDate
                );
              }
              return false;
            }
          );
          if (initialPositionStats.length > 0) {
            const aggregated = aggregateDailyStats(initialPositionStats, 7);
            if (aggregated) initialRank = aggregated.averagePosition;
          }
        }

        // Calculate monthly averages and aggregates from daily stats
        if (keyword.dailyStats && Array.isArray(keyword.dailyStats)) {
          const dailyStatsByMonth: Record<string, any[]> = {};
          keyword.dailyStats.forEach((stat: any) => {
            if (stat && stat.date) {
              const date = new Date(stat.date);
              const monthKey = `${date.getMonth() + 1}/${date.getFullYear()}`;
              if (!dailyStatsByMonth[monthKey])
                dailyStatsByMonth[monthKey] = [];
              dailyStatsByMonth[monthKey].push(stat);
            }
          });

          Object.keys(dailyStatsByMonth).forEach((monthKey) => {
            const stats = dailyStatsByMonth[monthKey];
            const [m, y] = monthKey.split('/').map(Number);
            const isCurrent = m === currentMonth && y === currentYear;
            const daysToUse = isCurrent ? stats.length : 7;
            const aggregated = aggregateDailyStats(stats, daysToUse);
            if (aggregated) monthlyData[monthKey] = aggregated.averagePosition;
          });
        }

        // Selected month snapshot
        let selectedMonthStat: any = null;
        if (selectedMonth) {
          const [name, yearStr] = selectedMonth.split(' ');
          const monthNames = [
            'January',
            'February',
            'March',
            'April',
            'May',
            'June',
            'July',
            'August',
            'September',
            'October',
            'November',
            'December',
          ];
          const selectedMonthNum = monthNames.indexOf(name) + 1;
          const selectedMonthKey = `${selectedMonthNum}/${parseInt(yearStr)}`;
          const selectedMonthValue = monthlyData[selectedMonthKey];
          if (selectedMonthValue !== null && selectedMonthValue !== undefined) {
            const selectedMonthStats = (keyword.dailyStats || []).filter(
              (stat: any) => {
                if (!stat || !stat.date) return false;
                const d = new Date(stat.date);
                return (
                  d.getMonth() + 1 === selectedMonthNum &&
                  d.getFullYear() === parseInt(yearStr)
                );
              }
            );
            const monthSearchVolume = selectedMonthStats.reduce(
              (sum: number, s: any) => sum + (s.searchVolume || 0),
              0
            );
            // Determine top page by impressions
            const pageToImpressions: Record<string, number> = {};
            selectedMonthStats.forEach((s: any) => {
              const url = s.topRankingPageUrl || '';
              if (!url) return;
              pageToImpressions[url] =
                (pageToImpressions[url] || 0) + (s.searchVolume || 0);
            });
            let monthTopPageUrl = '';
            let topImpr = -1;
            Object.keys(pageToImpressions).forEach((url) => {
              const impr = pageToImpressions[url];
              if (impr > topImpr) {
                topImpr = impr;
                monthTopPageUrl = url;
              }
            });
            selectedMonthStat = {
              averageRank: selectedMonthValue,
              searchVolume: monthSearchVolume,
              topRankingPageUrl: monthTopPageUrl,
            };
          }
        }

        // Current stat fallback to latest month with data
        const monthlyValues = Object.values(monthlyData).filter(
          (val) => val !== null
        ) as number[];
        const latestValue =
          monthlyValues.length > 0
            ? monthlyValues[monthlyValues.length - 1]
            : null;
        const currentStat =
          selectedMonthStat ||
          (latestValue ? { averageRank: latestValue } : null);

        // Previous month stat for monthly change
        let previousMonthStat: any = null;
        if (selectedMonthStat && selectedMonth) {
          const [name, yearStr] = selectedMonth.split(' ');
          const monthNames = [
            'January',
            'February',
            'March',
            'April',
            'May',
            'June',
            'July',
            'August',
            'September',
            'October',
            'November',
            'December',
          ];
          const selectedMonthNum = monthNames.indexOf(name) + 1;
          let prevMonth = selectedMonthNum - 1;
          let prevYear = parseInt(yearStr);
          if (prevMonth === 0) {
            prevMonth = 12;
            prevYear--;
          }
          const prevMonthKey = `${prevMonth}/${prevYear}`;
          const prevMonthValue = monthlyData[prevMonthKey];
          if (prevMonthValue !== null && prevMonthValue !== undefined) {
            previousMonthStat = { averageRank: prevMonthValue };
          }
        } else if (monthlyValues.length > 1) {
          previousMonthStat = {
            averageRank: monthlyValues[monthlyValues.length - 2],
          };
        }

        const monthlyChange =
          previousMonthStat && currentStat
            ? (previousMonthStat.averageRank || 0) -
            (currentStat.averageRank || 0)
            : 0;
        const overallChange = currentStat
          ? initialRank - (currentStat.averageRank || 0)
          : 0;

        // Compute search volume for selected/latest month
        let searchVolume = 0;
        try {
          if (selectedMonth) {
            const [name, yearStr] = selectedMonth.split(' ');
            const monthNames = [
              'January',
              'February',
              'March',
              'April',
              'May',
              'June',
              'July',
              'August',
              'September',
              'October',
              'November',
              'December',
            ];
            const selectedMonthNum = monthNames.indexOf(name) + 1;
            const stats = (keyword.dailyStats || []).filter((s: any) => {
              if (!s || !s.date) return false;
              const d = new Date(s.date);
              return (
                d.getMonth() + 1 === selectedMonthNum &&
                d.getFullYear() === parseInt(yearStr)
              );
            });
            searchVolume = stats.reduce(
              (sum: number, s: any) => sum + (s.searchVolume || 0),
              0
            );
          } else if (latestValue) {
            const availableMonthKeys = Object.keys(monthlyData)
              .filter((k) => monthlyData[k] !== null)
              .sort((a, b) => {
                const [mA, yA] = a.split('/').map(Number);
                const [mB, yB] = b.split('/').map(Number);
                return yA - yB || mA - mB;
              });
            const latestMonthKey =
              availableMonthKeys[availableMonthKeys.length - 1];
            const [m, y] = latestMonthKey.split('/').map(Number);
            const stats = (keyword.dailyStats || []).filter((s: any) => {
              if (!s || !s.date) return false;
              const d = new Date(s.date);
              return d.getMonth() + 1 === m && d.getFullYear() === y;
            });
            searchVolume = stats.reduce(
              (sum: number, s: any) => sum + (s.searchVolume || 0),
              0
            );
          }
        } catch {
          searchVolume = 0;
        }

        // Build months list from monthlyData
        const months = Object.keys(monthlyData);

        return {
          id: keyword.id,
          keyword: keyword.keyword,
          initialRank,
          monthlyData,
          monthlyChange,
          overallChange,
          position: currentStat?.averageRank || 0,
          searchVolume,
          topPageLink: (() => {
            try {
              const url = selectedMonthStat?.topRankingPageUrl || '';
              return url ? decodeURIComponent(url) : '';
            } catch {
              return selectedMonthStat?.topRankingPageUrl || '';
            }
          })(),
          _months: months,
        };
      } catch (e) {
        return {
          id: keyword.id,
          keyword: keyword.keyword,
          initialRank: keyword.initialPosition || 0,
          monthlyData: {},
          monthlyChange: 0,
          overallChange: 0,
          position: 0,
          searchVolume: 0,
          topPageLink: '',
          _months: [],
        };
      }
    });

    // Collect and sort months
    const monthsSet = new Set<string>();
    processed.forEach((k) =>
      (k._months || []).forEach((m: string) => monthsSet.add(m))
    );
    const sortedMonths = Array.from(monthsSet).sort((a, b) => {
      const [mA, yA] = a.split('/').map(Number);
      const [mB, yB] = b.split('/').map(Number);
      return yA - yB || mA - mB;
    });

    // Ensure each keyword has all months keys
    const normalizedKeywords = processed.map((k) => {
      const copy = { ...k } as any;
      sortedMonths.forEach((m) => {
        if (!copy.monthlyData[m]) copy.monthlyData[m] = null;
      });
      delete copy._months;
      return copy;
    });

    return { keywords: normalizedKeywords, months: sortedMonths };
  } catch (error) {
    console.error('Error in processKeywordsForCampaign:', error);
    return { keywords: [], months: [] };
  }
}

// Helper function to handle keyword changes
async function handleKeywordChanges(
  oldCampaign: any,
  newCampaign: any
): Promise<void> {
  console.log(
    `🔍 handleKeywordChanges called for campaign: ${newCampaign.name}`
  );

  try {
    const oldKeywords = oldCampaign.keywords
      .split('\n')
      .map((k: string) => k.trim())
      .filter((k: string) => k.length > 0);

    const newKeywords = newCampaign.keywords
      .split('\n')
      .map((k: string) => k.trim())
      .filter((k: string) => k.length > 0);

    // Find removed keywords
    const removedKeywords = oldKeywords.filter(
      (keyword: string) => !newKeywords.includes(keyword)
    );

    // Find added keywords
    const addedKeywords = newKeywords.filter(
      (keyword: string) => !oldKeywords.includes(keyword)
    );

    // Log keyword changes for debugging
    console.log(
      `Campaign ${newCampaign.name
      } keyword changes: Removed: [${removedKeywords.join(
        ', '
      )}], Added: [${addedKeywords.join(', ')}]`
    );

    console.log(
      `🌐 Looking for analytics record for site: ${newCampaign.searchConsoleSite}`
    );

    // Get the analytics record for this campaign
    const analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
      where: { siteUrl: newCampaign.searchConsoleSite },
      include: {
        keywords: {
          include: {
            monthlyStats: true,
          },
        },
      },
    });

    if (!analytics) {
      console.log(
        `⚠️ No analytics record found for site: ${newCampaign.searchConsoleSite}`
      );
      console.log(`📝 Creating new analytics record and fetching data...`);

      // Create analytics record and fetch data
      if (addedKeywords.length > 0) {
        console.log(
          `🔄 Fetching data for ${addedKeywords.length
          } added keywords: ${addedKeywords.join(', ')}`
        );

        // Run data fetching asynchronously without blocking the response
        console.log(`📊 Starting background data fetch for new keywords...`);

        // Use setImmediate to run in the next tick, making it truly asynchronous
        setImmediate(async () => {
          try {
            console.log(`📊 Starting fetchDailySiteTraffic...`);
            await analyticsService.fetchDailySiteTraffic({
              campaignId: newCampaign.id,
              waitForAllData: true,
            });
            console.log(`✅ Completed fetchDailySiteTraffic`);

            // Also fetch daily keyword data for the new keywords
            console.log(`🔍 Starting fetchDailyKeywordData...`);
            await analyticsService.fetchDailyKeywordData({
              campaignId: newCampaign.id,
              waitForAllData: true,
            });
            console.log(`✅ Completed fetchDailyKeywordData`);
          } catch (error) {
            console.error('❌ Error fetching data for added keywords:', error);
            // Don't throw here since this is running asynchronously
          }
        });
      }
      return;
    }

    console.log(
      `✅ Found analytics record: ${analytics.id} with ${analytics.keywords.length} keywords`
    );

    // Delete data for removed keywords
    if (removedKeywords.length > 0) {
      const keywordsToDelete = analytics.keywords.filter((keyword: any) =>
        removedKeywords.includes(keyword.keyword)
      );

      for (const keyword of keywordsToDelete) {
        // Delete monthly stats first (due to foreign key constraints)
        await prisma.searchConsoleKeywordMonthlyStat.deleteMany({
          where: { keywordId: keyword.id },
        });

        // Delete the keyword
        await prisma.searchConsoleKeyword.delete({
          where: { id: keyword.id },
        });
      }
    }

    // Fetch new data for added keywords
    if (addedKeywords.length > 0) {
      console.log(
        `🔄 Fetching data for ${addedKeywords.length
        } added keywords: ${addedKeywords.join(', ')}`
      );

      // Run data fetching asynchronously without blocking the response
      console.log(`📊 Starting background data fetch for new keywords...`);

      // Use setImmediate to run in the next tick, making it truly asynchronous
      setImmediate(async () => {
        try {
          console.log(`📊 Starting fetchDailySiteTraffic...`);
          await analyticsService.fetchDailySiteTraffic({
            campaignId: newCampaign.id,
            waitForAllData: true,
          });
          console.log(`✅ Completed fetchDailySiteTraffic`);

          // Also fetch daily keyword data for the new keywords
          console.log(`🔍 Starting fetchDailyKeywordData...`);
          await analyticsService.fetchDailyKeywordData({
            campaignId: newCampaign.id,
            waitForAllData: true,
          });
          console.log(`✅ Completed fetchDailyKeywordData`);
        } catch (error) {
          console.error('❌ Error fetching data for added keywords:', error);
          // Don't throw here since this is running asynchronously
        }
      });
    }
  } catch (error) {
    console.error('Error handling keyword changes:', error);
    throw error;
  }
}

const createCampaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required'),
  startingDate: z.string().transform((str) => new Date(str)),
  searchConsoleAccount: z.string().min(1, 'Search Console account is required'),
  searchConsoleSite: z.string().min(1, 'Search Console site is required'),
  keywords: z.string().min(1, 'Keywords are required'),
  userId: z.string().min(1, 'User ID is required'),
  googleAccountId: z.string().min(1, 'Google Account ID is required'),
  whatsappGroupIds: z.array(z.string()).optional(), // WhatsApp group IDs
});

const updateCampaignSchema = z.object({
  id: z.string().min(1, 'Campaign ID is required'),
  name: z.string().min(1, 'Campaign name is required').optional(),
  startingDate: z
    .string()
    .transform((str) => new Date(str))
    .optional(),
  searchConsoleAccount: z
    .string()
    .min(1, 'Search Console account is required')
    .optional(),
  searchConsoleSite: z
    .string()
    .min(1, 'Search Console site is required')
    .optional(),
  keywords: z.string().min(1, 'Keywords are required').optional(),
  status: z.enum(['ACTIVE', 'PAUSED']).optional(),
  whatsappGroupIds: z.array(z.string()).optional(), // WhatsApp group IDs
});

export const campaignsRouter = router({
  // Create a new campaign
  createCampaign: adminProcedure
    .input(createCampaignSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        // Verify the user exists
        const user = await prisma.user.findFirst({
          where: { id: input.userId },
        });

        if (!user) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'User not found',
          });
        }

        // Verify the Google account exists
        const googleAccount = await prisma.googleAccount.findFirst({
          where: { id: input.googleAccountId },
        });

        if (!googleAccount) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Google account not found',
          });
        }

        // Create the campaign
        const campaign = await prisma.campaign.create({
          data: {
            name: input.name,
            startingDate: input.startingDate,
            searchConsoleAccount: input.searchConsoleAccount,
            searchConsoleSite: input.searchConsoleSite,
            keywords: input.keywords,
            userId: input.userId,
            googleAccountId: input.googleAccountId,
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            googleAccount: {
              select: {
                id: true,
                accountName: true,
                email: true,
              },
            },
          },
        });

        // Associate WhatsApp groups if provided
        if (input.whatsappGroupIds && input.whatsappGroupIds.length > 0) {
          const groupAssociations = [];
          for (const groupId of input.whatsappGroupIds) {
            // Verify group exists in our database
            const group = await prisma.whatsAppGroup.findFirst({
              where: { groupId },
            });

            if (group) {
              groupAssociations.push({
                campaignId: campaign.id,
                groupId: group.id,
              });
            }
          }

          if (groupAssociations.length > 0) {
            await prisma.campaignWhatsAppGroup.createMany({
              data: groupAssociations,
            });
          }
        }

        // Fetch daily site traffic data (dimensions: ['date'])
        analyticsService.fetchDailySiteTraffic({
          campaignId: campaign.id,
          waitForAllData: true,
        });

        // Fetch daily keyword data (dimensions: ['date', 'query'])
        analyticsService.fetchDailyKeywordData({
          campaignId: campaign.id,
          waitForAllData: true,
        });

        // Fetch monthly traffic data for the last 12 months
        analyticsService.fetchAndSaveMonthlyTrafficData({
          campaignId: campaign.id,
          waitForAllData: true,
        });

        // Run initial cannibalization audit (3 months) asynchronously
        setImmediate(async () => {
          try {
            const auditId = await keywordCannibalizationService.runInitialAudit(
              campaign.id
            );
            console.log(
              `✅ Initial cannibalization audit started for campaign ${campaign.id} (Audit ID: ${auditId})`
            );
          } catch (error) {
            console.error(
              `💥 Failed to start initial cannibalization audit for campaign ${campaign.id}:`,
              error
            );
          }
        });

        return campaign;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create campaign',
        });
      }
    }),

  // Re-fetch campaign data: refresh daily site traffic, daily keyword data, and monthly traffic
  reFetchCampaignData: adminProcedure
    .input(z.object({ campaignId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        const campaign = await prisma.campaign.findFirst({
          where: { id: input.campaignId },
        });
        if (!campaign) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found' });
        }

        let successful = 0;
        let failed = 0;

        const tasks: Array<Promise<boolean>> = [
          analyticsService.fetchDailySiteTraffic({ campaignId: campaign.id, waitForAllData: true }),
          analyticsService.fetchDailyKeywordData({ campaignId: campaign.id, waitForAllData: true }),
          analyticsService.fetchAndSaveMonthlyTrafficData({ campaignId: campaign.id, waitForAllData: true }),
        ];

        for (const p of tasks) {
          try {
            const ok = await p;
            if (ok) successful++; else failed++;
          } catch {
            failed++;
          }
        }

        return {
          campaignName: campaign.name,
          results: { successful, failed },
        };
      } catch (error) {
        console.error('Error in reFetchCampaignData:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to re-fetch campaign data' });
      }
    }),

  // Export raw keyword daily stats for a date range
  exportKeywordRawRange: adminProcedure
    .input(
      z.object({
        campaignId: z.string().min(1),
        startDate: z.string().min(1),
        endDate: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { campaignId, startDate, endDate } = input;
        const campaign = await prisma.campaign.findFirst({ where: { id: campaignId } });
        if (!campaign) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found' });
        }

        const analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
          where: { siteUrl: campaign.searchConsoleSite },
          select: { id: true },
        });
        if (!analytics) return [] as any[];

        const start = new Date(startDate);
        const end = new Date(endDate);

        const rows = await prisma.searchConsoleKeywordDailyStat.findMany({
          where: {
            keyword: { analyticsId: analytics.id },
            date: { gte: start, lte: end },
          },
          include: { keyword: true },
          orderBy: { date: 'asc' },
        });

        const data = rows.map((r) => ({
          keywordId: r.keywordId,
          keyword: r.keyword.keyword,
          date: r.date,
          averageRank: r.averageRank ?? 0,
          impressions: r.searchVolume || 0,
          clicks: 0,
          topRankingPageUrl: (() => {
            try { return r.topRankingPageUrl ? decodeURIComponent(r.topRankingPageUrl) : ''; } catch { return r.topRankingPageUrl || ''; }
          })(),
        }));

        return data;
      } catch (error) {
        console.error('Error in exportKeywordRawRange:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to export raw data' });
      }
    }),

  // Get keywords with CTR < 5% for a selected month (Unused Potential)
  getUnusedPotential: protectedProcedure
    .input(
      z.object({
        campaignId: z.string().min(1),
        selectedMonth: z.string().min(1),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const { campaignId, selectedMonth } = input;

        const campaign = await prisma.campaign.findFirst({ where: { id: campaignId } });
        if (!campaign) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found' });
        }
        if (campaign.userId !== ctx.user.id && ctx.user.role !== 'ADMIN') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this campaign' });
        }

        // Parse month input like "Oct 2025" or "October 2025" or with 2-digit year
        const parseMonth = (m: string) => {
          const ab = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const fu = ['January','February','March','April','May','June','July','August','September','October','November','December'];
          const [ms, ys] = m.split(' ');
          let idx = ab.indexOf(ms);
          if (idx === -1) idx = fu.indexOf(ms);
          const yn = parseInt(ys, 10);
          const y = ys.length === 2 ? 2000 + yn : yn;
          const monthNum = (idx < 0 ? new Date().getMonth() : idx) + 1;
          const yearNum = Number.isNaN(y) ? new Date().getFullYear() : y;
          return { monthNum, yearNum };
        };

        const { monthNum, yearNum } = parseMonth(selectedMonth);

        // Find analytics record for this campaign's site
        const analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
          where: { siteUrl: campaign.searchConsoleSite },
        });
        if (!analytics) {
          return { keywords: [] as any[] };
        }

        // Get computed monthly rows for the selected month/year
        const rows = await prisma.searchConsoleKeywordMonthlyComputed.findMany({
          where: {
            keyword: { analyticsId: analytics.id },
            month: monthNum,
            year: yearNum,
          },
          include: { keyword: true },
        });

        // Filter CTR < 5% (impressions > 0 to avoid divide by zero), sort by impressions desc
        const items = rows
          .map((r) => {
            const impressions = r.impressions || 0;
            const clicks = r.clicks || 0;
            const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
            return {
              id: r.keywordId, // stable per keyword
              keyword: r.keyword.keyword,
              ctr: Number(ctr.toFixed(2)),
              impressions,
              clicks,
              position: r.averageRank || 0,
              // searchVolume is not displayed in UI table; keep for completeness
              searchVolume: impressions,
              topPageLink: (() => {
                try { return r.topRankingPageUrl ? decodeURIComponent(r.topRankingPageUrl) : ''; } catch { return r.topRankingPageUrl || ''; }
              })(),
            };
          })
          .filter((it) => it.impressions > 0 && it.ctr < 5)
          .sort((a, b) => b.impressions - a.impressions);

        return { keywords: items };
      } catch (error) {
        console.error('Error in getUnusedPotential:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch unused potential data' });
      }
    }),

  // Get all campaigns with pagination and filtering
  getCampaigns: adminProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(10),
        search: z.string().optional(),
        statusFilter: z.enum(['all', 'ACTIVE', 'PAUSED']).default('all'),
        userId: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const { page, limit, search, statusFilter, userId } = input;
        const skip = (page - 1) * limit;

        // Build where clause
        const where: any = {};

        if (search) {
          where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { searchConsoleSite: { contains: search, mode: 'insensitive' } },
          ];
        }

        if (statusFilter !== 'all') {
          where.status = statusFilter;
        }

        if (userId) {
          where.userId = userId;
        }

        // Get campaigns with pagination
        const [campaigns, total] = await Promise.all([
          prisma.campaign.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
              googleAccount: {
                select: {
                  id: true,
                  accountName: true,
                  email: true,
                },
              },
            },
          }),
          prisma.campaign.count({ where }),
        ]);

        return {
          campaigns,
          pagination: {
            page,
            limit,
            totalCount: total,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page < Math.ceil(total / limit),
            hasPrevPage: page > 1,
          },
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch campaigns',
        });
      }
    }),

  // Get performance metrics for all campaigns (weekly/monthly change and overall)
  getCampaignPerformanceMetrics: adminProcedure
    .input(z.object({}).optional())
    .query(async () => {
      try {
        // Fetch all campaigns (active and paused)
        const campaigns = await prisma.campaign.findMany({
          select: { id: true, searchConsoleSite: true },
        });

        const results = await Promise.all(
          campaigns.map(async (campaign) => {
            const base = {
              campaignId: campaign.id,
              weeklyChange: { up: 0, neutral: 0, down: 0 },
              weeklyPercentage: 0,
              monthlyChange: { up: 0, neutral: 0, down: 0 },
              monthlyPercentage: 0,
              overallPerformance: 0,
            } as {
              campaignId: string
              weeklyChange: { up: number; neutral: number; down: number }
              weeklyPercentage: number
              monthlyChange: { up: number; neutral: number; down: number }
              monthlyPercentage: number
              overallPerformance: number
            };

            // Find analytics record for site
            const analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
              where: { siteUrl: campaign.searchConsoleSite },
              select: { id: true },
            });

            if (!analytics) return base;

            // ----- Monthly change using SearchConsoleKeywordMonthlyComputed -----
            let monthlyUp = 0;
            let monthlyDown = 0;
            let monthlyNeutral = 0;
            try {
              const now = new Date();
              const currentMonth = now.getMonth() + 1;
              const currentYear = now.getFullYear();
              let prevMonth = currentMonth - 1;
              let prevYear = currentYear;
              if (prevMonth === 0) {
                prevMonth = 12;
                prevYear = currentYear - 1;
              }

              const [currRows, prevRows] = await Promise.all([
                prisma.searchConsoleKeywordMonthlyComputed.findMany({
                  where: {
                    keyword: { analyticsId: analytics.id },
                    month: currentMonth,
                    year: currentYear,
                  },
                  select: { keywordId: true, averageRank: true },
                }),
                prisma.searchConsoleKeywordMonthlyComputed.findMany({
                  where: {
                    keyword: { analyticsId: analytics.id },
                    month: prevMonth,
                    year: prevYear,
                  },
                  select: { keywordId: true, averageRank: true },
                }),
              ]);

              const prevMap = new Map<string, number>();
              prevRows.forEach((r) => prevMap.set(r.keywordId, r.averageRank));
              for (const r of currRows) {
                const prev = prevMap.get(r.keywordId);
                if (typeof prev === 'number') {
                  const diff = prev - r.averageRank; // positive => improved
                  if (diff > 0) monthlyUp++;
                  else if (diff < 0) monthlyDown++;
                  else monthlyNeutral++;
                }
              }
            } catch {
              // stay with zeros
            }

            const monthlyCompared = monthlyUp + monthlyDown + monthlyNeutral;
            const monthlyPercentage = monthlyCompared
              ? Math.round((monthlyUp / monthlyCompared) * 100)
              : 0;

            // ----- Weekly change using last 14 days of SearchConsoleKeywordDailyStat -----
            let weeklyUp = 0;
            let weeklyDown = 0;
            let weeklyNeutral = 0;
            try {
              const endDate = moment().endOf('day').toDate();
              const currStart = moment(endDate).startOf('day').subtract(6, 'days').toDate();
              const prevStart = moment(currStart).startOf('day').subtract(7, 'days').toDate();
              const prevEnd = moment(currStart).startOf('day').subtract(1, 'day').toDate();

              const stats = await prisma.searchConsoleKeywordDailyStat.findMany({
                where: {
                  keyword: { analyticsId: analytics.id },
                  date: { gte: prevStart, lte: endDate },
                },
                select: { keywordId: true, date: true, averageRank: true, searchVolume: true },
              });

              // Group by keyword and window
              const byKeyword: Record<string, { prev: { wSum: number; vSum: number }; curr: { wSum: number; vSum: number } }> = {};
              for (const s of stats) {
                const key = s.keywordId;
                if (!byKeyword[key]) byKeyword[key] = { prev: { wSum: 0, vSum: 0 }, curr: { wSum: 0, vSum: 0 } };
                const vol = s.searchVolume || 0;
                const rank = s.averageRank ?? 0;
                const d = new Date(s.date);
                if (d >= currStart) {
                  byKeyword[key].curr.wSum += rank * vol;
                  byKeyword[key].curr.vSum += vol;
                } else {
                  byKeyword[key].prev.wSum += rank * vol;
                  byKeyword[key].prev.vSum += vol;
                }
              }

              Object.values(byKeyword).forEach((win) => {
                const prevAvg = win.prev.vSum > 0 ? win.prev.wSum / win.prev.vSum : null;
                const currAvg = win.curr.vSum > 0 ? win.curr.wSum / win.curr.vSum : null;
                if (prevAvg !== null && currAvg !== null) {
                  const diff = (prevAvg as number) - (currAvg as number);
                  if (diff > 0) weeklyUp++;
                  else if (diff < 0) weeklyDown++;
                  else weeklyNeutral++;
                }
              });
            } catch {
              // keep zeros
            }

            const weeklyCompared = weeklyUp + weeklyDown + weeklyNeutral;
            const weeklyPercentage = weeklyCompared
              ? Math.round((weeklyUp / weeklyCompared) * 100)
              : 0;

            // Overall performance as (improved - declined) percentage across available comparisons
            const totalCompared = weeklyCompared + monthlyCompared || 1;
            const overallPerformance = Math.round(
              (((weeklyUp + monthlyUp) - (weeklyDown + monthlyDown)) / totalCompared) * 100
            );

            return {
              campaignId: campaign.id,
              weeklyChange: { up: weeklyUp, neutral: weeklyNeutral, down: weeklyDown },
              weeklyPercentage,
              monthlyChange: { up: monthlyUp, neutral: monthlyNeutral, down: monthlyDown },
              monthlyPercentage,
              overallPerformance,
            };
          })
        );

        return results;
      } catch (error) {
        console.error('Error in getCampaignPerformanceMetrics:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to compute campaign performance metrics',
        });
      }
    }),

  // Count of active campaigns
  getActiveCampaignsCount: adminProcedure
    .input(z.void())
    .query(async () => {
      const count = await prisma.campaign.count({ where: { status: 'ACTIVE' } });
      return count;
    }),

  // Overall visibility across all active campaigns (percentage 0-100)
  getOverallVisibility: adminProcedure
    .input(z.void())
    .query(async () => {
      // Collect analytics IDs for active campaigns' sites
      const activeCampaigns = await prisma.campaign.findMany({
        where: { status: 'ACTIVE' },
        select: { searchConsoleSite: true },
      });
      if (activeCampaigns.length === 0) return 0;

      const sites = activeCampaigns.map((c) => c.searchConsoleSite);
      const analytics = await prisma.searchConsoleKeywordAnalytics.findMany({
        where: { siteUrl: { in: sites } },
        select: { id: true },
      });
      if (analytics.length === 0) return 0;

      // Latest month/year present in computed table for these analytics
      const latest = await prisma.searchConsoleKeywordMonthlyComputed.findFirst({
        where: { keyword: { analyticsId: { in: analytics.map((a) => a.id) } } },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        select: { month: true, year: true },
      });
      if (!latest) return 0;

      const rows = await prisma.searchConsoleKeywordMonthlyComputed.findMany({
        where: {
          keyword: { analyticsId: { in: analytics.map((a) => a.id) } },
          month: latest.month,
          year: latest.year,
        },
        select: { averageRank: true },
      });
      if (rows.length === 0) return 0;

      // Visibility weights by position ranges (per spec)
      const weightFor = (pos: number) => {
        if (pos <= 0 || !isFinite(pos)) return 0;
        if (pos <= 10) return 1.0;
        if (pos <= 20) return 0.8;
        if (pos <= 30) return 0.5;
        if (pos <= 50) return 0.3;
        return 0.0;
      };

      const total = rows.length;
      const visibleSum = rows.reduce((acc, r) => acc + weightFor(r.averageRank), 0);
      const visibility = total > 0 ? (visibleSum / total) * 100 : 0;
      return Math.round(visibility * 10) / 10; // one decimal
    }),

  // Total keywords tracked across all active campaigns
  getKeywordsTrackedCount: adminProcedure
    .input(z.void())
    .query(async () => {
      const activeCampaigns = await prisma.campaign.findMany({
        where: { status: 'ACTIVE' },
        select: { searchConsoleSite: true },
      });
      if (activeCampaigns.length === 0) return { count: 0 };
      const sites = activeCampaigns.map((c) => c.searchConsoleSite);
      const analytics = await prisma.searchConsoleKeywordAnalytics.findMany({
        where: { siteUrl: { in: sites } },
        select: { id: true },
      });
      if (analytics.length === 0) return { count: 0 };
      const count = await prisma.searchConsoleKeyword.count({
        where: { analyticsId: { in: analytics.map((a) => a.id) } },
      });
      return { count };
    }),

  // Top performing campaign score (0-100%) per spec
  getTopPerformingCampaign: adminProcedure
    .input(z.void())
    .query(async () => {
      const campaigns = await prisma.campaign.findMany({
        select: { id: true, searchConsoleSite: true },
      });
      if (campaigns.length === 0) return { score: 0 };

      // Determine last two months available globally
      const latest = await prisma.searchConsoleKeywordMonthlyComputed.findFirst({
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        select: { month: true, year: true },
      });
      if (!latest) return { score: 0 };
      let prevMonth = latest.month - 1;
      let prevYear = latest.year;
      if (prevMonth === 0) { prevMonth = 12; prevYear = latest.year - 1; }

      let bestScore = 0;

      for (const c of campaigns) {
        const analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
          where: { siteUrl: c.searchConsoleSite },
          select: { id: true },
        });
        if (!analytics) continue;

        const [currRows, prevRows] = await Promise.all([
          prisma.searchConsoleKeywordMonthlyComputed.findMany({
            where: { keyword: { analyticsId: analytics.id }, month: latest.month, year: latest.year },
            select: { keywordId: true, averageRank: true },
          }),
          prisma.searchConsoleKeywordMonthlyComputed.findMany({
            where: { keyword: { analyticsId: analytics.id }, month: prevMonth, year: prevYear },
            select: { keywordId: true, averageRank: true },
          }),
        ]);

        if (currRows.length === 0 || prevRows.length === 0) continue;

        const prevMap = new Map<string, number>();
        prevRows.forEach((r) => prevMap.set(r.keywordId, r.averageRank));

        let improved = 0;
        let declined = 0;
        let unchanged = 0;
        const gains: number[] = [];

        for (const r of currRows) {
          const prev = prevMap.get(r.keywordId);
          if (typeof prev !== 'number') continue;
          const diff = prev - r.averageRank; // positive => improved
          if (diff > 0) { improved++; gains.push(diff); }
          else if (diff < 0) declined++;
          else unchanged++;
        }

        const compared = improved + declined + unchanged;
        if (compared === 0) continue;

        const improvementRate = (improved / compared) * 100; // 0-100
        const avgGain = gains.length ? gains.reduce((a, b) => a + b, 0) / gains.length : 0;
        const gainPoints = Math.min(avgGain * 10, 40); // cap at 40
        const score = improvementRate * 0.6 + gainPoints; // 0-100

        if (score > bestScore) bestScore = score;
      }

      return { score: Math.round(bestScore * 10) / 10 };
    }),

  // Get a single campaign by ID
  getCampaign: adminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      try {
        const campaign = await prisma.campaign.findFirst({
          where: { id: input.id },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            googleAccount: {
              select: {
                id: true,
                accountName: true,
                email: true,
              },
            },
          },
        });

        if (!campaign) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found',
          });
        }

        return campaign;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch campaign',
        });
      }
    }),

  // Update a campaign
  updateCampaign: adminProcedure
    .input(updateCampaignSchema)
    .mutation(async ({ input }) => {
      try {
        const { id, ...updateData } = input;

        // Check if campaign exists
        const existingCampaign = await prisma.campaign.findFirst({
          where: { id },
        });

        if (!existingCampaign) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found',
          });
        }

        // Check if starting date is being updated
        const isStartingDateChanged =
          updateData.startingDate &&
          existingCampaign.startingDate.getTime() !==
          updateData.startingDate.getTime();

        // Check if keywords are being updated
        const isKeywordsChanged =
          updateData.keywords &&
          existingCampaign.keywords !== updateData.keywords;

        // Extract whatsappGroupIds from updateData before updating campaign
        const { whatsappGroupIds, ...campaignUpdateData } = updateData;

        // Update the campaign
        const campaign = await prisma.campaign.update({
          where: { id },
          data: campaignUpdateData,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            googleAccount: {
              select: {
                id: true,
                accountName: true,
                email: true,
              },
            },
          },
        });

        // Update WhatsApp groups if provided
        if (whatsappGroupIds !== undefined) {
          // Remove existing group associations
          await prisma.campaignWhatsAppGroup.deleteMany({
            where: { campaignId: id },
          });

          // Add new group associations
          if (whatsappGroupIds.length > 0) {
            const groupAssociations = [];
            for (const groupId of whatsappGroupIds) {
              // Verify group exists in our database
              const group = await prisma.whatsAppGroup.findFirst({
                where: { groupId },
              });

              if (group) {
                groupAssociations.push({
                  campaignId: id,
                  groupId: group.id,
                });
              }
            }

            if (groupAssociations.length > 0) {
              await prisma.campaignWhatsAppGroup.createMany({
                data: groupAssociations,
              });
            }
          }
        }

        // Handle keyword changes asynchronously
        if (isKeywordsChanged) {
          // Run keyword changes handling asynchronously without blocking the response
          setImmediate(async () => {
            try {
              await handleKeywordChanges(existingCampaign, campaign);
            } catch (error) {
              console.error(
                'Error handling keyword changes asynchronously:',
                error
              );
            }
          });
        }

        // Trigger analytics fetch if starting date changed
        if (isStartingDateChanged) {
          analyticsService.fetchDailySiteTraffic({
            campaignId: campaign.id,
            waitForAllData: true,
          });

          // Also fetch daily keyword data
          analyticsService.fetchDailyKeywordData({
            campaignId: campaign.id,
            waitForAllData: true,
          });

          // Also fetch monthly traffic data
          analyticsService.fetchAndSaveMonthlyTrafficData({
            campaignId: campaign.id,
            waitForAllData: true,
          });
        }

        return campaign;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update campaign',
        });
      }
    }),

  // Delete a campaign
  deleteCampaign: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      try {
        // Check if campaign exists
        const existingCampaign = await prisma.campaign.findFirst({
          where: { id: input.id },
        });

        if (!existingCampaign) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found',
          });
        }

        // Delete the campaign
        await prisma.campaign.delete({
          where: { id: input.id },
        });

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete campaign',
        });
      }
    }),

  // Get campaigns by user ID with pagination (admin only)
  getCampaignsByUser: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(10),
        search: z.string().optional(),
        statusFilter: z.enum(['all', 'ACTIVE', 'PAUSED']).default('all'),
      })
    )
    .query(async ({ input }) => {
      try {
        const { userId, page, limit, search, statusFilter } = input;
        const skip = (page - 1) * limit;

        // Build where clause
        const where: any = { userId };

        if (search) {
          where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { searchConsoleSite: { contains: search, mode: 'insensitive' } },
          ];
        }

        if (statusFilter !== 'all') {
          where.status = statusFilter;
        }

        // Get total count for pagination
        const totalCount = await prisma.campaign.count({ where });

        // Get paginated campaigns
        const campaigns = await prisma.campaign.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            googleAccount: {
              select: {
                id: true,
                accountName: true,
                email: true,
              },
            },
          },
          skip,
          take: limit,
        });

        return {
          campaigns,
          pagination: {
            page,
            limit,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
            hasNextPage: page < Math.ceil(totalCount / limit),
            hasPrevPage: page > 1,
          },
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch user campaigns',
        });
      }
    }),

  // Get campaigns for the current authenticated user
  getUserCampaigns: protectedProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(10),
        search: z.string().optional(),
        statusFilter: z.enum(['all', 'ACTIVE', 'PAUSED']).default('all'),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const { page, limit, search, statusFilter } = input;
        const skip = (page - 1) * limit;
        const userId = ctx.user.id;

        // Build where clause - always filter by current user
        const where: any = { userId };

        if (search) {
          where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { searchConsoleSite: { contains: search, mode: 'insensitive' } },
          ];
        }

        if (statusFilter !== 'all') {
          where.status = statusFilter;
        }

        // Get total count for pagination
        const totalCount = await prisma.campaign.count({ where });

        // Get paginated campaigns
        const campaigns = await prisma.campaign.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            googleAccount: {
              select: {
                id: true,
                accountName: true,
                email: true,
              },
            },
          },
          skip,
          take: limit,
        });

        return {
          campaigns,
          pagination: {
            page,
            limit,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
            hasNextPage: page < Math.ceil(totalCount / limit),
            hasPrevPage: page > 1,
          },
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch user campaigns',
        });
      }
    }),

  // Toggle campaign status (ACTIVE <-> PAUSED)
  toggleCampaignStatus: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      try {
        // Check if campaign exists
        const existingCampaign = await prisma.campaign.findFirst({
          where: { id: input.id },
        });

        if (!existingCampaign) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found',
          });
        }

        // Toggle the status
        const newStatus =
          existingCampaign.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';

        // Update the campaign status
        const campaign = await prisma.campaign.update({
          where: { id: input.id },
          data: { status: newStatus },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            googleAccount: {
              select: {
                id: true,
                accountName: true,
                email: true,
              },
            },
          },
        });

        return campaign;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to toggle campaign status',
        });
      }
    }),

  // Get analytics data for a campaign
  // This endpoint fetches both keyword data and top-ranking page data together
  // The top-ranking page is determined by the page with the highest impressions for each keyword
  getCampaignAnalytics: protectedProcedure
    .input(
      z.object({
        campaignId: z.string(),
        selectedMonth: z.string().optional(), // Add selected month parameter
      })
    )
    .query(async ({ input, ctx }) => {
      // Modified to fetch both keyword data and top-ranking page data together
      try {
        // Get the campaign
        const campaign = await prisma.campaign.findFirst({
          where: { id: input.campaignId },
        });

        if (!campaign) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found',
          });
        }

        // Check if user has access to this campaign
        // Admins can access any campaign, regular users can only access their own
        if (ctx.user.role !== 'ADMIN' && campaign.userId !== ctx.user.id) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have permission to access this campaign',
          });
        }

        // Get analytics data with daily stats
        const analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
          where: { siteUrl: campaign.searchConsoleSite },
          include: {
            keywords: {
              include: {
                dailyStats: {
                  orderBy: { date: 'asc' },
                },
              },
            },
          },
        });

        if (!analytics) {
          return {
            keywords: [],
            months: [],
          };
        }

        // Process the data for the frontend using daily records
        const keywords = await Promise.all(
          analytics.keywords.map(async (keyword) => {
            try {
              const monthlyData: Record<string, number | null> = {};
              // Per-month aggregates for full-month search volume and top page (by impressions)
              const monthlySearchVolumeByMonthKey: Record<string, number> = {};
              const monthlyTopPageByMonthKey: Record<string, string> = {};
              const currentMonth = new Date().getMonth() + 1;
              const currentYear = new Date().getFullYear();

              // Initialize all months with null (excluding current month due to 3-day delay)
              for (
                let year = new Date(campaign.startingDate).getFullYear();
                year <= currentYear;
                year++
              ) {
                const startMonth =
                  year === new Date(campaign.startingDate).getFullYear()
                    ? new Date(campaign.startingDate).getMonth() + 1
                    : 1;
                // Include current month (we'll handle the 3-day delay in the calculation)
                const endMonth = year === currentYear ? currentMonth : 12;

                for (let month = startMonth; month <= endMonth; month++) {
                  const monthKey = `${month}/${year}`;
                  monthlyData[monthKey] = null;
                }
              }

              // Initial rank: always use precomputed keyword.initialPosition
              // (computed using GSC-aligned 7-day pre-start top-page logic)
              const initialRank = keyword.initialPosition || 0;

              // Monthly metrics
              // Documentation:
              // - We read per-month rank/top page/impressions from
              //   SearchConsoleKeywordMonthlyComputed (persisted during data fetch flows).
              // - No GSC calls here; if a month is missing we leave zeros and rely on cron/
              //   fetch flows to populate (previous on-demand compute removed).
              if (keyword.dailyStats && Array.isArray(keyword.dailyStats)) {
                const dailyStatsByMonth: Record<string, any[]> = {};

                // Group daily stats by month
                keyword.dailyStats.forEach((stat) => {
                  if (stat && stat.date) {
                    const date = new Date(stat.date);
                    const monthKey = `${date.getMonth() + 1
                      }/${date.getFullYear()}`;

                    if (!dailyStatsByMonth[monthKey]) {
                      dailyStatsByMonth[monthKey] = [];
                    }
                    dailyStatsByMonth[monthKey].push(stat);
                  }
                });

                // Process each month
                for (const monthKey of Object.keys(dailyStatsByMonth)) {
                  const [month, year] = monthKey.split('/').map(Number);

                  try {
                    // Check if we have monthly stat data for this month
                    const computedData =
                      await prisma.searchConsoleKeywordMonthlyStat.findUnique(
                        {
                          where: {
                            keywordId_month_year: {
                              keywordId: keyword.id,
                              month,
                              year,
                            },
                          },
                        }
                      );

                    if (computedData) {
                      // Use existing computed data
                      monthlyData[monthKey] = computedData.averageRank;
                      monthlyTopPageByMonthKey[monthKey] =
                        computedData.topRankingPageUrl;
                      monthlySearchVolumeByMonthKey[monthKey] =
                        computedData.searchVolume;
                    } else {
                      // No computed data available - this should be rare since we compute proactively
                      console.log(
                        `No computed monthly data found for keyword "${keyword.keyword}" in ${month}/${year} - this should be computed by cron jobs`
                      );
                      monthlyData[monthKey] = 0;
                      monthlyTopPageByMonthKey[monthKey] = '';
                      monthlySearchVolumeByMonthKey[monthKey] = 0;
                    }
                  } catch (error) {
                    console.error(
                      `Error processing monthly data for ${monthKey}:`,
                      error
                    );
                    monthlyData[monthKey] = 0;
                    monthlyTopPageByMonthKey[monthKey] = '';
                    monthlySearchVolumeByMonthKey[monthKey] = 0;
                  }
                }
              }

              // Find the selected month's data
              let selectedMonthStat = null;
              if (input.selectedMonth) {
                const selectedMonthParts = input.selectedMonth.split(' ');
                const selectedMonthName = selectedMonthParts[0];
                const selectedYear = selectedMonthParts[1];

                const monthNames = [
                  'January',
                  'February',
                  'March',
                  'April',
                  'May',
                  'June',
                  'July',
                  'August',
                  'September',
                  'October',
                  'November',
                  'December',
                ];
                const selectedMonthNum =
                  monthNames.indexOf(selectedMonthName) + 1;

                // Find the selected month's average from daily data
                const selectedMonthKey = `${selectedMonthNum}/${parseInt(
                  selectedYear
                )}`;
                const selectedMonthValue = monthlyData[selectedMonthKey];
                const selectedMonthTopPage =
                  monthlyTopPageByMonthKey[selectedMonthKey] || '';

                if (
                  selectedMonthValue !== null &&
                  selectedMonthValue !== undefined
                ) {
                  // Compute full-month impressions (searchVolume) from dailyStats
                  const selectedMonthStats = (keyword.dailyStats || []).filter(
                    (stat) => {
                      if (!stat || !stat.date) return false;
                      const d = new Date(stat.date);
                      return (
                        d.getMonth() + 1 === selectedMonthNum &&
                        d.getFullYear() === parseInt(selectedYear)
                      );
                    }
                  );

                  const monthSearchVolume = selectedMonthStats.reduce(
                    (sum, s) => sum + (s.searchVolume || 0),
                    0
                  );
                  // Position already computed from raw GSC
                  const monthTopPageUrl = selectedMonthTopPage;
                  const monthPositionForTopPage = selectedMonthValue as number;

                  selectedMonthStat = {
                    // Use top-page only monthly position to align with GSC exact page filtering
                    averageRank: monthPositionForTopPage,
                    searchVolume: monthSearchVolume,
                    topRankingPageUrl: monthTopPageUrl,
                  };
                }
              }

              // Calculate changes
              const monthlyValues = Object.values(monthlyData).filter(
                (val) => val !== null
              );
              const latestValue =
                monthlyValues.length > 0
                  ? monthlyValues[monthlyValues.length - 1]
                  : null;

              // Use selected month stat if available, otherwise use latest
              const currentStat =
                selectedMonthStat ||
                (latestValue
                  ? {
                    // Use latest month's precomputed values from raw GSC
                    averageRank: (() => {
                      try {
                        const availableMonthKeys = Object.keys(monthlyData)
                          .filter((k) => monthlyData[k] !== null)
                          .sort((a, b) => {
                            const [mA, yA] = a.split('/').map(Number);
                            const [mB, yB] = b.split('/').map(Number);
                            return yA - yB || mA - mB;
                          });
                        const latestMonthKey =
                          availableMonthKeys[availableMonthKeys.length - 1];
                        return monthlyData[latestMonthKey] as number;
                      } catch {
                        return latestValue as number;
                      }
                    })(),
                    searchVolume: (() => {
                      try {
                        // Determine latest month key with data
                        const availableMonthKeys = Object.keys(monthlyData)
                          .filter((k) => monthlyData[k] !== null)
                          .sort((a, b) => {
                            const [mA, yA] = a.split('/').map(Number);
                            const [mB, yB] = b.split('/').map(Number);
                            return yA - yB || mA - mB;
                          });
                        const latestMonthKey =
                          availableMonthKeys[availableMonthKeys.length - 1];
                        const [m, y] = latestMonthKey.split('/').map(Number);
                        // Sum full-month impressions from dailyStats for that month
                        const stats = (keyword.dailyStats || []).filter(
                          (s) => {
                            if (!s || !s.date) return false;
                            const d = new Date(s.date);
                            return (
                              d.getMonth() + 1 === m && d.getFullYear() === y
                            );
                          }
                        );
                        return stats.reduce(
                          (sum, s) => sum + (s.searchVolume || 0),
                          0
                        );
                      } catch {
                        return 0;
                      }
                    })(),
                    topRankingPageUrl: (() => {
                      try {
                        const availableMonthKeys = Object.keys(monthlyData)
                          .filter((k) => monthlyData[k] !== null)
                          .sort((a, b) => {
                            const [mA, yA] = a.split('/').map(Number);
                            const [mB, yB] = b.split('/').map(Number);
                            return yA - yB || mA - mB;
                          });
                        const latestMonthKey =
                          availableMonthKeys[availableMonthKeys.length - 1];
                        return monthlyTopPageByMonthKey[latestMonthKey] || '';
                      } catch {
                        return '';
                      }
                    })(),
                  }
                  : null);

              // Find the previous month stat for the selected month
              let previousMonthStat = null;
              let previousMonthTopPage = '';
              if (selectedMonthStat && input.selectedMonth) {
                // Find the month before the selected month
                const selectedMonthParts = input.selectedMonth!.split(' ');
                const selectedMonthName = selectedMonthParts[0];
                const selectedYear = selectedMonthParts[1];

                const monthNames = [
                  'January',
                  'February',
                  'March',
                  'April',
                  'May',
                  'June',
                  'July',
                  'August',
                  'September',
                  'October',
                  'November',
                  'December',
                ];
                const selectedMonthNum =
                  monthNames.indexOf(selectedMonthName) + 1;

                // Calculate previous month
                let prevMonth = selectedMonthNum - 1;
                let prevYear = parseInt(selectedYear);
                if (prevMonth === 0) {
                  prevMonth = 12;
                  prevYear--;
                }

                const prevMonthKey = `${prevMonth}/${prevYear}`;
                const prevMonthValue = monthlyData[prevMonthKey];
                previousMonthTopPage = monthlyTopPageByMonthKey[prevMonthKey] || '';

                if (prevMonthValue !== null && prevMonthValue !== undefined) {
                  previousMonthStat = {
                    averageRank: prevMonthValue,
                    searchVolume: 0,
                    topRankingPageUrl: previousMonthTopPage,
                  };
                }
              } else {
                // Fallback to the second-to-last month
                const monthlyValues = Object.values(monthlyData).filter(
                  (val) => val !== null
                );
                if (monthlyValues.length > 1) {
                  previousMonthStat = {
                    averageRank: monthlyValues[monthlyValues.length - 2],
                    searchVolume: 0,
                    topRankingPageUrl: '',
                  };
                }
              }

              const monthlyChange =
                previousMonthStat && currentStat
                  ? (previousMonthStat.averageRank || 0) -
                  (currentStat.averageRank || 0)
                  : 0;

              const overallChange = currentStat
                ? initialRank - (currentStat.averageRank || 0)
                : 0;

              // Calculate search volume for the whole month (or all available days for current month)
              let searchVolume = 0;
              try {
                if (input.selectedMonth) {
                  const selectedMonthParts = input.selectedMonth.split(' ');
                  const selectedMonthName = selectedMonthParts[0];
                  const selectedYear = selectedMonthParts[1];
                  const monthNames = [
                    'January',
                    'February',
                    'March',
                    'April',
                    'May',
                    'June',
                    'July',
                    'August',
                    'September',
                    'October',
                    'November',
                    'December',
                  ];
                  const selectedMonthNum =
                    monthNames.indexOf(selectedMonthName) + 1;
                  const stats = (keyword.dailyStats || []).filter((s) => {
                    if (!s || !s.date) return false;
                    const d = new Date(s.date);
                    return (
                      d.getMonth() + 1 === selectedMonthNum &&
                      d.getFullYear() === parseInt(selectedYear)
                    );
                  });
                  searchVolume = stats.reduce(
                    (sum, s) => sum + (s.searchVolume || 0),
                    0
                  );
                } else {
                  const availableMonthKeys = Object.keys(monthlyData)
                    .filter((k) => monthlyData[k] !== null)
                    .sort((a, b) => {
                      const [mA, yA] = a.split('/').map(Number);
                      const [mB, yB] = b.split('/').map(Number);
                      return yA - yB || mA - mB;
                    });
                  const latestMonthKey =
                    availableMonthKeys[availableMonthKeys.length - 1];
                  const [m, y] = latestMonthKey.split('/').map(Number);
                  const stats = (keyword.dailyStats || []).filter((s) => {
                    if (!s || !s.date) return false;
                    const d = new Date(s.date);
                    return d.getMonth() + 1 === m && d.getFullYear() === y;
                  });
                  searchVolume = stats.reduce(
                    (sum, s) => sum + (s.searchVolume || 0),
                    0
                  );
                }
              } catch {
                searchVolume = 0;
              }

              // Ensure we always return the top-ranking page data along with keyword data
              // The topPageLink is derived from the topRankingPageUrl which is determined by the page with the highest impressions
              // This ensures that for each keyword, we return both the keyword data and its corresponding top-ranking page

              // Compare current and previous month's top pages to determine if changed
              const currentTopPage = currentStat?.topRankingPageUrl || '';
              const isTopPageChanged = (() => {
                // Only compare if we have both current and previous month data
                if (!currentTopPage || !previousMonthTopPage) {
                  return false;
                }

                // Normalize URLs for comparison (decode and remove trailing slashes)
                const normalizeUrl = (url: string): string => {
                  try {
                    let normalized = decodeURIComponent(url).trim().toLowerCase();
                    // Remove trailing slash for consistent comparison
                    if (normalized.endsWith('/')) {
                      normalized = normalized.slice(0, -1);
                    }
                    return normalized;
                  } catch {
                    return url.trim().toLowerCase();
                  }
                };

                return normalizeUrl(currentTopPage) !== normalizeUrl(previousMonthTopPage);
              })();

              // Make sure all months from the global months array are included in each keyword's monthlyData
              const allMonths = Object.keys(monthlyData).sort((a, b) => {
                const [monthA, yearA] = a.split('/').map(Number);
                const [monthB, yearB] = b.split('/').map(Number);
                return yearA - yearB || monthA - monthB;
              });

              return {
                id: keyword.id,
                keyword: keyword.keyword,
                initialRank: initialRank,
                monthlyData,
                monthlyChange,
                overallChange,
                position: currentStat?.averageRank || 0,
                searchVolume: searchVolume,
                // Process and return the top-ranking page URL for this keyword
                topPageLink: (() => {
                  try {
                    const url = currentStat?.topRankingPageUrl || '';
                    return url ? decodeURIComponent(url) : '';
                  } catch (error) {
                    console.error('Error decoding URL:', error);
                    return currentStat?.topRankingPageUrl || '';
                  }
                })(),
                // Add the comparison result for frontend use
                isTopPageChanged: isTopPageChanged,
              };
            } catch (error) {
              console.error(
                'Error processing keyword:',
                keyword.keyword,
                error
              );
              // Return a default structure for this keyword
              // Even in error cases, we maintain the structure that includes topPageLink
              // This ensures consistent data structure for the frontend
              return {
                id: keyword.id,
                keyword: keyword.keyword,
                initialRank: keyword.initialPosition || 0,
                monthlyData: {},
                monthlyChange: 0,
                overallChange: 0,
                position: 0,
                searchVolume: 0,
                topPageLink: '', // Empty string for top page link in error cases
                isTopPageChanged: false, // Default to false in error cases
              };
            }
          })
        );

        // Get unique months for the table headers
        const months = new Set<string>();
        keywords.forEach((keyword) => {
          Object.keys(keyword.monthlyData).forEach((month) => {
            months.add(month);
          });
        });

        const sortedMonths = Array.from(months).sort((a, b) => {
          const [monthA, yearA] = a.split('/').map(Number);
          const [monthB, yearB] = b.split('/').map(Number);
          return yearA - yearB || monthA - monthB;
        });

        // Create a new array with keywords that have all months
        const updatedKeywords = keywords.map((keyword) => {
          // Create a copy of the keyword with all months included
          const updatedKeyword = { ...keyword };

          // Ensure all months are included in the monthlyData
          sortedMonths.forEach((month) => {
            if (!updatedKeyword.monthlyData[month]) {
              updatedKeyword.monthlyData[month] = null;
            }
          });

          return updatedKeyword;
        });

        // Return the updated keywords array directly
        return {
          keywords: updatedKeywords,
          months: sortedMonths,
        };
      } catch (error) {
        console.error('Error in getCampaignAnalytics:', error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch campaign analytics: ${error instanceof Error ? error.message : 'Unknown error'
            }`,
        });
      }
    }),

  // Toggle a favorite keyword for the current user
  toggleFavoriteKeyword: protectedProcedure
    .input(
      z.object({
        keywordId: z.string().min(1, 'Keyword ID is required'),
        campaignId: z.string().min(1, 'Campaign ID is required'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // Verify the keyword exists
        const keyword = await prisma.searchConsoleKeyword.findFirst({
          where: { id: input.keywordId },
          include: { analytics: true },
        });

        if (!keyword) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Keyword not found',
          });
        }

        // Verify campaign exists and belongs to the current user
        const campaign = await prisma.campaign.findFirst({
          where: { id: input.campaignId },
        });

        if (!campaign) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found for keyword',
          });
        }

        // Allow campaign owner OR ADMIN to favorite
        if (campaign.userId !== ctx.user.id && ctx.user.role !== 'ADMIN') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'No access to this keyword',
          });
        }

        // Ensure this keyword belongs to this campaign/site
        if (campaign.searchConsoleSite !== keyword.analytics.siteUrl) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Keyword does not belong to this campaign',
          });
        }

        // TODO: Implement favorite functionality when UserKeywordFavorite model is available
        // For now, return success without doing anything
        /*
        const userKeywordFavorite = prisma.userKeywordFavorite;
        const existing = await userKeywordFavorite.findFirst({
          where: {
            userId_keywordId: {
              userId: ctx.user.id,
              keywordId: input.keywordId,
            },
          },
        });

        if (existing) {
          await userKeywordFavorite.delete({
            where: { id: existing.id },
          });
          return { favorited: false };
        }

        await userKeywordFavorite.create({
          data: { userId: ctx.user.id, keywordId: input.keywordId },
        });
        return { favorited: true };
        */

        // Implement favorite functionality
        const existingFavorite = await prisma.userKeywordFavorite.findFirst({
          where: {
            userId: ctx.user.id,
            keywordId: input.keywordId,
          },
        });

        if (existingFavorite) {
          await prisma.userKeywordFavorite.delete({
            where: { id: existingFavorite.id },
          });
          return { favorited: false };
        }

        await prisma.userKeywordFavorite.create({
          data: {
            userId: ctx.user.id,
            keywordId: input.keywordId,
          },
        });
        return { favorited: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to toggle favorite',
        });
      }
    }),

  // Get user's favorite keywords for a campaign, with same data shape as analytics keywords
  getUserFavoriteKeywords: protectedProcedure
    .input(
      z.object({
        campaignId: z.string(),
        selectedMonth: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const campaign = await prisma.campaign.findFirst({
          where: { id: input.campaignId },
        });
        if (!campaign) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found',
          });
        }
        if (ctx.user.role !== 'ADMIN' && campaign.userId !== ctx.user.id) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have permission to access this campaign',
          });
        }

        // Get analytics for this campaign/site
        const analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
          where: { siteUrl: campaign.searchConsoleSite },
          include: {
            keywords: {
              include: { dailyStats: { orderBy: { date: 'asc' } } },
            },
          },
        });

        if (!analytics) {
          return { keywords: [], months: [] };
        }

        // TODO: Get favorites when UserKeywordFavorite model is available
        // For now, use empty set
        /*
        const userKeywordFavorite = prisma.userKeywordFavorite;
        const favoriteRecords = await userKeywordFavorite.findMany({
          where: {
            userId: ctx.user.id,
            keywordId: { in: analytics.keywords.map((k) => k.id) },
          },
        });
        */
        const favoriteRecords = await prisma.userKeywordFavorite.findMany({
          where: {
            userId: ctx.user.id,
            keywordId: { in: analytics.keywords.map((k) => k.id) },
          },
        });

        const favoriteIdSet = new Set(
          favoriteRecords.map((f) => f.keywordId)
        );

        // Reuse the processing logic from getCampaignAnalytics, but filter to favorites
        const allProcessed = await (async () => {
          // Inline reuse of logic: we map the same way as above
          const currentMonth = new Date().getMonth() + 1;
          const currentYear = new Date().getFullYear();

          const processed = analytics.keywords
            .filter((k) => favoriteIdSet.has(k.id))
            .map((keyword) => {
              try {
                const monthlyData: Record<string, number | null> = {};
                const monthlySearchVolumeByMonthKey: Record<string, number> =
                  {};
                const monthlyTopPageByMonthKey: Record<string, string> = {};

                for (
                  let year = new Date(campaign.startingDate).getFullYear();
                  year <= currentYear;
                  year++
                ) {
                  const startMonth =
                    year === new Date(campaign.startingDate).getFullYear()
                      ? new Date(campaign.startingDate).getMonth() + 1
                      : 1;
                  const endMonth = year === currentYear ? currentMonth : 12;
                  for (let month = startMonth; month <= endMonth; month++) {
                    const monthKey = `${month}/${year}`;
                    monthlyData[monthKey] = null;
                  }
                }

                let initialRank = keyword.initialPosition || 0;
                if (keyword.dailyStats && Array.isArray(keyword.dailyStats)) {
                  const campaignStartDate = new Date(campaign.startingDate);
                  const initialPositionStartDate = new Date(campaignStartDate);
                  initialPositionStartDate.setDate(
                    initialPositionStartDate.getDate() - 7
                  );
                  const initialPositionEndDate = new Date(campaignStartDate);
                  initialPositionEndDate.setDate(
                    initialPositionEndDate.getDate() - 1
                  );

                  const initialPositionStats = keyword.dailyStats.filter(
                    (stat) => {
                      if (stat && stat.date) {
                        const statDate = new Date(stat.date);
                        return (
                          statDate >= initialPositionStartDate &&
                          statDate <= initialPositionEndDate
                        );
                      }
                      return false;
                    }
                  );
                  if (initialPositionStats.length > 0) {
                    const aggregated = aggregateDailyStats(
                      initialPositionStats,
                      7
                    );
                    if (aggregated) initialRank = aggregated.averagePosition;
                  }
                }

                if (keyword.dailyStats && Array.isArray(keyword.dailyStats)) {
                  const dailyStatsByMonth: Record<string, any[]> = {};
                  keyword.dailyStats.forEach((stat) => {
                    if (stat && stat.date) {
                      const date = new Date(stat.date);
                      const monthKey = `${date.getMonth() + 1
                        }/${date.getFullYear()}`;
                      if (!dailyStatsByMonth[monthKey])
                        dailyStatsByMonth[monthKey] = [];
                      dailyStatsByMonth[monthKey].push(stat);
                    }
                  });
                  Object.keys(dailyStatsByMonth).forEach((monthKey) => {
                    const stats = dailyStatsByMonth[monthKey];
                    const [m, y] = monthKey.split('/').map(Number);
                    const isCurrentMonth =
                      m === currentMonth && y === currentYear;
                    const daysToUse = isCurrentMonth ? stats.length : 7;
                    const aggregated = aggregateDailyStats(stats, daysToUse);
                    if (aggregated)
                      monthlyData[monthKey] = aggregated.averagePosition;
                  });
                  Object.keys(dailyStatsByMonth).forEach((monthKey) => {
                    const stats = dailyStatsByMonth[monthKey];
                    const monthTotalSearchVolume = stats.reduce(
                      (sum: number, s: any) => sum + (s.searchVolume || 0),
                      0
                    );
                    monthlySearchVolumeByMonthKey[monthKey] =
                      monthTotalSearchVolume;
                    const pageToImpressions: Record<string, number> = {};
                    stats.forEach((s: any) => {
                      const url = s.topRankingPageUrl || '';
                      if (!url) return;
                      pageToImpressions[url] =
                        (pageToImpressions[url] || 0) + (s.searchVolume || 0);
                    });
                    let topPageUrl = '';
                    let topPageImpressions = -1;
                    Object.keys(pageToImpressions).forEach((url) => {
                      const impressions = pageToImpressions[url];
                      if (impressions > topPageImpressions) {
                        topPageImpressions = impressions;
                        topPageUrl = url;
                      }
                    });
                    monthlyTopPageByMonthKey[monthKey] = topPageUrl;
                  });
                }

                let selectedMonthStat: any = null;
                if (input.selectedMonth) {
                  const [name, yearStr] = input.selectedMonth.split(' ');
                  const monthNames = [
                    'January',
                    'February',
                    'March',
                    'April',
                    'May',
                    'June',
                    'July',
                    'August',
                    'September',
                    'October',
                    'November',
                    'December',
                  ];
                  const selectedMonthNum = monthNames.indexOf(name) + 1;
                  const selectedMonthKey = `${selectedMonthNum}/${parseInt(
                    yearStr
                  )}`;
                  const selectedMonthValue = monthlyData[selectedMonthKey];
                  if (
                    selectedMonthValue !== null &&
                    selectedMonthValue !== undefined
                  ) {
                    const selectedMonthStats = (
                      keyword.dailyStats || []
                    ).filter((stat) => {
                      if (!stat || !stat.date) return false;
                      const d = new Date(stat.date);
                      return (
                        d.getMonth() + 1 === selectedMonthNum &&
                        d.getFullYear() === parseInt(yearStr)
                      );
                    });
                    const monthSearchVolume = selectedMonthStats.reduce(
                      (sum, s) => sum + (s.searchVolume || 0),
                      0
                    );
                    const pageToImpressions: Record<string, number> = {};
                    selectedMonthStats.forEach((s) => {
                      const url = s.topRankingPageUrl || '';
                      if (!url) return;
                      pageToImpressions[url] =
                        (pageToImpressions[url] || 0) + (s.searchVolume || 0);
                    });
                    let monthTopPageUrl = '';
                    let topImpr = -1;
                    Object.keys(pageToImpressions).forEach((url) => {
                      const impr = pageToImpressions[url];
                      if (impr > topImpr) {
                        topImpr = impr;
                        monthTopPageUrl = url;
                      }
                    });
                    selectedMonthStat = {
                      averageRank: selectedMonthValue,
                      searchVolume: monthSearchVolume,
                      topRankingPageUrl: monthTopPageUrl,
                    };
                  }
                }

                const monthlyValues = Object.values(monthlyData).filter(
                  (val) => val !== null
                ) as number[];
                const latestValue =
                  monthlyValues.length > 0
                    ? monthlyValues[monthlyValues.length - 1]
                    : null;
                const currentStat =
                  selectedMonthStat ||
                  (latestValue
                    ? {
                      averageRank: latestValue,
                      searchVolume: (() => {
                        try {
                          const availableMonthKeys = Object.keys(monthlyData)
                            .filter((k) => monthlyData[k] !== null)
                            .sort((a, b) => {
                              const [mA, yA] = a.split('/').map(Number);
                              const [mB, yB] = b.split('/').map(Number);
                              return yA - yB || mA - mB;
                            });
                          const latestMonthKey =
                            availableMonthKeys[availableMonthKeys.length - 1];
                          const [m, y] = latestMonthKey
                            .split('/')
                            .map(Number);
                          const stats = (keyword.dailyStats || []).filter(
                            (s) => {
                              if (!s || !s.date) return false;
                              const d = new Date(s.date);
                              return (
                                d.getMonth() + 1 === m &&
                                d.getFullYear() === y
                              );
                            }
                          );
                          return stats.reduce(
                            (sum, s) => sum + (s.searchVolume || 0),
                            0
                          );
                        } catch {
                          return 0;
                        }
                      })(),
                      topRankingPageUrl: (() => {
                        try {
                          const availableMonthKeys = Object.keys(monthlyData)
                            .filter((k) => monthlyData[k] !== null)
                            .sort((a, b) => {
                              const [mA, yA] = a.split('/').map(Number);
                              const [mB, yB] = b.split('/').map(Number);
                              return yA - yB || mA - mB;
                            });
                          const latestMonthKey =
                            availableMonthKeys[availableMonthKeys.length - 1];
                          const [m, y] = latestMonthKey
                            .split('/')
                            .map(Number);
                          const stats = (keyword.dailyStats || []).filter(
                            (s) => {
                              if (!s || !s.date) return false;
                              const d = new Date(s.date);
                              return (
                                d.getMonth() + 1 === m &&
                                d.getFullYear() === y
                              );
                            }
                          );
                          const pageToImpressions: Record<string, number> =
                            {};
                          stats.forEach((s) => {
                            const url = s.topRankingPageUrl || '';
                            if (!url) return;
                            pageToImpressions[url] =
                              (pageToImpressions[url] || 0) +
                              (s.searchVolume || 0);
                          });
                          let best = '';
                          let bestImpr = -1;
                          Object.keys(pageToImpressions).forEach((url) => {
                            const impr = pageToImpressions[url];
                            if (impr > bestImpr) {
                              bestImpr = impr;
                              best = url;
                            }
                          });
                          return best;
                        } catch {
                          return '';
                        }
                      })(),
                    }
                    : null);

                // Previous month stat if selected
                let previousMonthStat: any = null;
                let previousMonthTopPage = '';
                if (selectedMonthStat && input.selectedMonth) {
                  const [name, yearStr] = input.selectedMonth.split(' ');
                  const monthNames = [
                    'January',
                    'February',
                    'March',
                    'April',
                    'May',
                    'June',
                    'July',
                    'August',
                    'September',
                    'October',
                    'November',
                    'December',
                  ];
                  const selectedMonthNum = monthNames.indexOf(name) + 1;
                  let prevMonth = selectedMonthNum - 1;
                  let prevYear = parseInt(yearStr);
                  if (prevMonth === 0) {
                    prevMonth = 12;
                    prevYear--;
                  }
                  const prevMonthKey = `${prevMonth}/${prevYear}`;
                  const prevMonthValue = monthlyData[prevMonthKey];
                  previousMonthTopPage = monthlyTopPageByMonthKey[prevMonthKey] || '';

                  if (prevMonthValue !== null && prevMonthValue !== undefined) {
                    previousMonthStat = {
                      averageRank: prevMonthValue,
                      searchVolume: 0,
                      topRankingPageUrl: previousMonthTopPage,
                    };
                  }
                } else {
                  if (monthlyValues.length > 1) {
                    previousMonthStat = {
                      averageRank: monthlyValues[monthlyValues.length - 2],
                      searchVolume: 0,
                      topRankingPageUrl: '',
                    };
                  }
                }

                const monthlyChange =
                  previousMonthStat && currentStat
                    ? (previousMonthStat.averageRank || 0) -
                    (currentStat.averageRank || 0)
                    : 0;
                const overallChange = currentStat
                  ? initialRank - (currentStat.averageRank || 0)
                  : 0;

                let searchVolume = 0;
                try {
                  if (input.selectedMonth) {
                    const [name, yearStr] = input.selectedMonth.split(' ');
                    const monthNames = [
                      'January',
                      'February',
                      'March',
                      'April',
                      'May',
                      'June',
                      'July',
                      'August',
                      'September',
                      'October',
                      'November',
                      'December',
                    ];
                    const selectedMonthNum = monthNames.indexOf(name) + 1;
                    const stats = (keyword.dailyStats || []).filter((s) => {
                      if (!s || !s.date) return false;
                      const d = new Date(s.date);
                      return (
                        d.getMonth() + 1 === selectedMonthNum &&
                        d.getFullYear() === parseInt(yearStr)
                      );
                    });
                    searchVolume = stats.reduce(
                      (sum, s) => sum + (s.searchVolume || 0),
                      0
                    );
                  } else {
                    const availableMonthKeys = Object.keys(monthlyData)
                      .filter((k) => monthlyData[k] !== null)
                      .sort((a, b) => {
                        const [mA, yA] = a.split('/').map(Number);
                        const [mB, yB] = b.split('/').map(Number);
                        return yA - yB || mA - mB;
                      });
                    const latestMonthKey =
                      availableMonthKeys[availableMonthKeys.length - 1];
                    const [m, y] = latestMonthKey.split('/').map(Number);
                    const stats = (keyword.dailyStats || []).filter((s) => {
                      if (!s || !s.date) return false;
                      const d = new Date(s.date);
                      return d.getMonth() + 1 === m && d.getFullYear() === y;
                    });
                    searchVolume = stats.reduce(
                      (sum, s) => sum + (s.searchVolume || 0),
                      0
                    );
                  }
                } catch {
                  searchVolume = 0;
                }

                // Compare current and previous month's top pages to determine if changed
                const currentTopPage = currentStat?.topRankingPageUrl || '';
                const isTopPageChanged = (() => {
                  // Only compare if we have both current and previous month data
                  if (!currentTopPage || !previousMonthTopPage) {
                    return false;
                  }

                  // Normalize URLs for comparison (decode and remove trailing slashes)
                  const normalizeUrl = (url: string): string => {
                    try {
                      let normalized = decodeURIComponent(url).trim().toLowerCase();
                      // Remove trailing slash for consistent comparison
                      if (normalized.endsWith('/')) {
                        normalized = normalized.slice(0, -1);
                      }
                      return normalized;
                    } catch {
                      return url.trim().toLowerCase();
                    }
                  };

                  return normalizeUrl(currentTopPage) !== normalizeUrl(previousMonthTopPage);
                })();

                return {
                  id: keyword.id,
                  keyword: keyword.keyword,
                  initialRank: initialRank,
                  monthlyData,
                  monthlyChange,
                  overallChange,
                  position: currentStat?.averageRank || 0,
                  searchVolume,
                  topPageLink: (() => {
                    try {
                      const url = currentStat?.topRankingPageUrl || '';
                      return url ? decodeURIComponent(url) : '';
                    } catch {
                      return currentStat?.topRankingPageUrl || '';
                    }
                  })(),
                  isTopPageChanged: isTopPageChanged,
                };
              } catch (e) {
                return {
                  id: keyword.id,
                  keyword: keyword.keyword,
                  initialRank: keyword.initialPosition || 0,
                  monthlyData: {},
                  monthlyChange: 0,
                  overallChange: 0,
                  position: 0,
                  searchVolume: 0,
                  topPageLink: '',
                  isTopPageChanged: false,
                };
              }
            });
          return processed;
        })();

        // Collect months
        const months = new Set<string>();
        allProcessed.forEach((k) => {
          Object.keys(k.monthlyData).forEach((m) => months.add(m));
        });
        const sortedMonths = Array.from(months).sort((a, b) => {
          const [mA, yA] = a.split('/').map(Number);
          const [mB, yB] = b.split('/').map(Number);
          return yA - yB || mA - mB;
        });

        // Ensure all months in each keyword
        const updatedKeywords = allProcessed.map((k) => {
          const updated = { ...k } as any;
          sortedMonths.forEach((m) => {
            if (!updated.monthlyData[m]) updated.monthlyData[m] = null;
          });
          return updated;
        });

        return { keywords: updatedKeywords, months: sortedMonths };
      } catch (error) {
        console.error('Error in getUserFavoriteKeywords:', error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch favorite keywords',
        });
      }
    }),

  // Get traffic data for a campaign
  getCampaignTrafficData: protectedProcedure
    .input(
      z.object({
        campaignId: z.string().min(1, 'Campaign ID is required'),
        month: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const campaign = await prisma.campaign.findFirst({
          where: { id: input.campaignId },
          include: { googleAccount: true },
        });
        if (!campaign) throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found' });
        if (campaign.userId !== ctx.user.id && ctx.user.role !== 'ADMIN') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this campaign' });
        }

        const parseMonth = (m?: string) => {
          if (!m) { const d = new Date(); return { m0: d.getMonth(), y: d.getFullYear() }; }
          const abbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const full = ['January','February','March','April','May','June','July','August','September','October','November','December'];
          const [ms, ys] = m.split(' ');
          let idx = abbr.indexOf(ms); if (idx === -1) idx = full.indexOf(ms);
          const yn = parseInt(ys, 10); const y = ys.length === 2 ? 2000 + yn : yn;
          return { m0: idx < 0 ? new Date().getMonth() : idx, y: Number.isNaN(y) ? new Date().getFullYear() : y };
        };
        const { m0: targetMonth0, y: targetYear } = parseMonth(input.month);
        const abbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

        // Ensure DB has data (DB-first → fallback to GSC and store)
        let trafficAnalytics = await prisma.searchConsoleTrafficAnalytics.findFirst({ where: { siteUrl: campaign.searchConsoleSite } });
        if (!trafficAnalytics) {
          await prisma.searchConsoleTrafficAnalytics.create({ data: { siteUrl: campaign.searchConsoleSite } });
          trafficAnalytics = await prisma.searchConsoleTrafficAnalytics.findFirst({ where: { siteUrl: campaign.searchConsoleSite } });
        }

        // If daily rows for selected month are missing, fetch-and-save
        const dailyCount = await prisma.searchConsoleTrafficDaily.count({
          where: {
            analyticsId: trafficAnalytics!.id,
            date: { gte: new Date(targetYear, targetMonth0, 1), lt: new Date(targetYear, targetMonth0 + 1, 1) },
          },
        });
        if (dailyCount === 0 && campaign.googleAccount) {
          await analyticsService.fetchDailySiteTraffic({ campaignId: campaign.id, waitForAllData: true });
        }

        // Ensure monthly records (if empty) for last 12 months
        const monthlyAny = await prisma.searchConsoleTrafficMonthly.count({ where: { analyticsId: trafficAnalytics!.id } });
        if (monthlyAny === 0 && campaign.googleAccount) {
          await analyticsService.fetchAndSaveMonthlyTrafficData({ campaignId: campaign.id, waitForAllData: true });
        }

        // Helper to ensure a monthly record exists for given year/month; if missing, fetch from GSC and store
        const ensureMonthly = async (y: number, m0: number) => {
          const existing = await prisma.searchConsoleTrafficMonthly.findFirst({
            where: { analyticsId: trafficAnalytics!.id, year: y, month: m0 + 1 },
          });
          if (existing) return existing;
          if (!campaign.googleAccount) return null;
          const startAt = moment.utc([y, m0, 1]);
          const endAt = moment.utc([y, m0, 1]).endOf('month');
          const analytics = await searchConsoleService.getAnalytics({
            campaign,
            googleAccount: campaign.googleAccount,
            startAt,
            endAt,
            dimensions: [],
            exactUrlMatch: false,
          });
          if (!analytics || analytics.length === 0) return null;
          const totalClicks = analytics.reduce((acc: number, r) => acc + (r.clicks || 0), 0);
          const totalImpr = analytics.reduce((acc: number, r) => acc + (r.impressions || 0), 0);
          const totalPos = analytics.reduce((acc: number, r) => acc + (r.position || 0), 0);
          const ctr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0;
          const position = analytics.length > 0 ? totalPos / analytics.length : 0;
          return prisma.searchConsoleTrafficMonthly.upsert({
            where: { analyticsId_month_year: { analyticsId: trafficAnalytics!.id, month: m0 + 1, year: y } },
            update: { clicks: totalClicks, impressions: totalImpr, ctr: parseFloat(ctr.toFixed(2)), position: parseFloat(position.toFixed(2)), updatedAt: new Date() },
            create: { analyticsId: trafficAnalytics!.id, month: m0 + 1, year: y, clicks: totalClicks, impressions: totalImpr, ctr: parseFloat(ctr.toFixed(2)), position: parseFloat(position.toFixed(2)) },
          });
        };

        // Build monthly series for last 12 months anchored to selected month
        const anchor = new Date(targetYear, targetMonth0, 1);
        const monthly: Array<{ month: string; clicks: number; impressions: number; ctr: number; position: number }> = [];
        for (let i = 12; i >= 1; i--) {
          const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
          let rec = await prisma.searchConsoleTrafficMonthly.findFirst({
            where: { analyticsId: trafficAnalytics!.id, year: d.getFullYear(), month: d.getMonth() + 1 },
          });
          if (!rec) {
            rec = await ensureMonthly(d.getFullYear(), d.getMonth());
          }
          if (rec) {
            monthly.push({ month: `${abbr[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`, clicks: rec.clicks, impressions: rec.impressions, ctr: rec.ctr, position: rec.position });
          }
        }
        // Add selected month aggregated from daily rows
        const dailyRows = await prisma.searchConsoleTrafficDaily.findMany({
          where: { analyticsId: trafficAnalytics!.id, date: { gte: new Date(targetYear, targetMonth0, 1), lt: new Date(targetYear, targetMonth0 + 1, 1) } },
          orderBy: { date: 'asc' },
        });
        if (dailyRows.length > 0) {
          const clicks = dailyRows.reduce((s, r) => s + r.clicks, 0);
          const impr = dailyRows.reduce((s, r) => s + r.impressions, 0);
          const ctr = impr > 0 ? (clicks / impr) * 100 : 0;
          const pos = dailyRows.reduce((s, r) => s + (r.position ?? 0), 0) / dailyRows.length;
          monthly.push({ month: `${abbr[targetMonth0]} ${String(targetYear).slice(-2)}`, clicks, impressions: impr, ctr: parseFloat(ctr.toFixed(2)), position: parseFloat(pos.toFixed(2)) });
        }

        // Build daily series for selected month
        const daily = dailyRows
          .map(r => { const d = new Date(r.date); return { date: `${d.getDate()} ${abbr[d.getMonth()]}`, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }; })
          .sort((a, b) => parseInt(a.date.split(' ')[0]) - parseInt(b.date.split(' ')[0]));

        return { monthly, daily };
      } catch (error) {
        console.error('Error in getCampaignTrafficData:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch campaign traffic data' });
      }
    }),

  // Organic Traffic (This Month) histogram with selected month support
  getCurrentMonthTrafficData: protectedProcedure
    .input(z.object({ campaignId: z.string().min(1, 'Campaign ID is required'), month: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      try {
        const campaign = await prisma.campaign.findFirst({ where: { id: input.campaignId }, include: { googleAccount: true } });
        if (!campaign) throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found' });
        if (campaign.userId !== ctx.user.id && ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this campaign' });
        const abbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const full = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const [ms, ys] = input.month.split(' ');
        let idx = abbr.indexOf(ms); if (idx === -1) idx = full.indexOf(ms);
        const yn = parseInt(ys, 10); const y = ys.length === 2 ? 2000 + yn : yn;
        const targetMonth0 = idx < 0 ? new Date().getMonth() : idx; const targetYear = Number.isNaN(y) ? new Date().getFullYear() : y;

        let ta = await prisma.searchConsoleTrafficAnalytics.findFirst({ where: { siteUrl: campaign.searchConsoleSite } });
        if (!ta) ta = await prisma.searchConsoleTrafficAnalytics.create({ data: { siteUrl: campaign.searchConsoleSite } });

        // Ensure daily data exists for current and previous month
        const ensureDaily = async (yy: number, m0: number) => {
          const rows = await prisma.searchConsoleTrafficDaily.findMany({ where: { analyticsId: ta!.id, date: { gte: new Date(yy, m0, 1), lt: new Date(yy, m0 + 1, 1) } }, orderBy: { date: 'asc' } });
          if (rows.length > 0) return rows;
          if (!campaign.googleAccount) return rows;
          await analyticsService.fetchDailySiteTraffic({ campaignId: campaign.id, waitForAllData: true });
          return prisma.searchConsoleTrafficDaily.findMany({ where: { analyticsId: ta!.id, date: { gte: new Date(yy, m0, 1), lt: new Date(yy, m0 + 1, 1) } }, orderBy: { date: 'asc' } });
        };

        const currRows = await ensureDaily(targetYear, targetMonth0);
        const prevYear = targetMonth0 === 0 ? targetYear - 1 : targetYear;
        const prevMonth0 = targetMonth0 === 0 ? 11 : targetMonth0 - 1;
        const prevRows = await ensureDaily(prevYear, prevMonth0);

        const daysInMonth = new Date(targetYear, targetMonth0 + 1, 0).getDate();
        const periods: Array<{ period: string; clicks: number }> = [];
        for (let start = 1; start <= daysInMonth; start += 4) {
          const end = Math.min(start + 3, daysInMonth);
          const clicks = currRows.filter(r => { const d = new Date(r.date).getDate(); return d >= start && d <= end; }).reduce((s, r) => s + r.clicks, 0);
          periods.push({ period: `${start}-${end}`, clicks });
        }

        const sumClicks = (rs: { clicks: number }[]) =>
          rs.reduce((acc: number, row: { clicks: number }) => acc + row.clicks, 0);
        const percentageChange = sumClicks(prevRows) > 0 ? Math.round(((sumClicks(currRows) - sumClicks(prevRows)) / sumClicks(prevRows)) * 100) : 0;
        return { periods, percentageChange };
      } catch (error) {
        console.error('Error in getCurrentMonthTrafficData:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch current month traffic data' });
      }
    }),

  // Top keywords for selected month with DB-first → GSC fallback → store
  getTopKeywordsThisMonth: protectedProcedure
    .input(z.object({ campaignId: z.string().min(1), limit: z.number().min(1).max(50).default(10), month: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      try {
        const { campaignId, limit, month } = input;
        const campaign = await prisma.campaign.findFirst({ where: { id: campaignId }, include: { googleAccount: true } });
        if (!campaign) throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found' });
        if (campaign.userId !== ctx.user.id && ctx.user.role !== 'ADMIN') throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this campaign' });
        const parseMonth = (m?: string) => { if (!m) { const d = new Date(); return { m1: d.getMonth() + 1, y: d.getFullYear() }; } const ab = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; const fu = ['January','February','March','April','May','June','July','August','September','October','November','December']; const [ms, ys] = m.split(' '); let idx = ab.indexOf(ms); if (idx === -1) idx = fu.indexOf(ms); const yn = parseInt(ys,10); const y = ys.length===2?2000+yn:yn; return { m1: (idx<0?new Date().getMonth():idx)+1, y: Number.isNaN(y)?new Date().getFullYear():y }; };
        const { m1: targetMonth, y: targetYear } = parseMonth(month);

        let rows = await prisma.topKeywordData.findMany({ where: { campaignId, month: targetMonth, year: targetYear }, orderBy: { clicks: 'desc' }, take: limit });
        if (rows.length === 0 && campaign.googleAccount) {
          const startAt = moment.utc([targetYear, targetMonth - 1, 1]);
          const endAt = startAt.clone().endOf('month');
          const curr = await searchConsoleService.getAnalytics({ campaign, googleAccount: campaign.googleAccount, startAt, endAt, dimensions: ['query'] });
          const prevStart = startAt.clone().subtract(1, 'month');
          const prevEnd = prevStart.clone().endOf('month');
          const prev = await searchConsoleService.getAnalytics({ campaign, googleAccount: campaign.googleAccount, startAt: prevStart, endAt: prevEnd, dimensions: ['query'] });
          const prevMap = new Map<string, number>();
          (prev || []).forEach(r => { const k = (r.keys?.[1] as string) || (r.keys?.[0] as string) || ''; if (k) prevMap.set(k, r.position || 0); });
          const toStore = (curr || [])
            .map(r => { const k = (r.keys?.[1] as string) || (r.keys?.[0] as string) || ''; if (!k) return null; const currPos = r.position || 0; const prevPos = prevMap.get(k) || 0; let dir: 'up'|'down'|'same'='same'; let diff = 0; if (prevPos>0 && currPos>0){ diff = prevPos - currPos; dir = diff>0 ? 'up' : diff<0 ? 'down' : 'same'; } return { keyword: k, averageRank: currPos, clicks: r.clicks||0, impressions: r.impressions||0, rankChange: Math.abs(diff), rankChangeDirection: dir }; })
            .filter((x): x is NonNullable<typeof x> => !!x)
            .sort((a,b)=>b.clicks-a.clicks)
            .slice(0,50);
          for (const kw of toStore) {
            await prisma.topKeywordData.upsert({
              where: { campaignId_keyword_month_year: { campaignId, keyword: kw.keyword, month: targetMonth, year: targetYear } },
              update: { averageRank: kw.averageRank, clicks: kw.clicks, impressions: kw.impressions, rankChange: kw.rankChange, rankChangeDirection: kw.rankChangeDirection, fetchedAt: new Date() },
              create: { campaignId, keyword: kw.keyword, month: targetMonth, year: targetYear, averageRank: kw.averageRank, clicks: kw.clicks, impressions: kw.impressions, rankChange: kw.rankChange, rankChangeDirection: kw.rankChangeDirection },
            });
          }
          rows = await prisma.topKeywordData.findMany({ where: { campaignId, month: targetMonth, year: targetYear }, orderBy: { clicks: 'desc' }, take: limit });
        }
        const keywords = rows.map((r: any) => ({ keyword: r.keyword, averageRank: r.averageRank, clicks: r.clicks, impressions: r.impressions, rankChange: r.rankChange, rankChangeDirection: r.rankChangeDirection as 'up'|'down'|'same' }));
        return { keywords };
      } catch (error) {
        console.error('Error in getTopKeywordsThisMonth:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch top keywords for this month' });
      }
    }),

// Get keyword movement stats for a campaign
getKeywordMovementStats: protectedProcedure
  .input(
    z.object({
      campaignId: z.string(),
      month: z.string().optional(), // Optional month (e.g., "Oct 2025"). Defaults to current month
    })
  )
  .query(async ({ input, ctx }) => {
    try {
      const { campaignId, month } = input;

      // Get the campaign
      const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      if (!campaign) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Campaign not found',
        });
      }

      // Check if user has access to this campaign
      if (campaign.userId !== ctx.user.id && ctx.user.role !== 'ADMIN') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have access to this campaign',
        });
      }

      // Determine target month/year
      const parseMonth = (m?: string) => {
        if (!m) {
          const d = new Date();
          return { m1: d.getMonth() + 1, y: d.getFullYear() };
        }
        const ab = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const fu = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const [ms, ys] = m.split(' ');
        let idx = ab.indexOf(ms);
        if (idx === -1) idx = fu.indexOf(ms);
        const yn = parseInt(ys, 10);
        const y = ys.length === 2 ? 2000 + yn : yn;
        return { m1: (idx < 0 ? new Date().getMonth() : idx) + 1, y: Number.isNaN(y) ? new Date().getFullYear() : y };
      };

      const { m1: currentMonth, y: currentYear } = parseMonth(month);

      // Get previous month
      const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
      const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

      // Get the analytics ID for this campaign
      const analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
        where: { siteUrl: campaign.searchConsoleSite },
      });

      if (!analytics) {
        return { improved: 0, declined: 0, unchanged: 0 };
      }

      // Get current month keyword data
      const currentMonthData = await prisma.searchConsoleKeywordMonthlyComputed.findMany({
        where: {
          keyword: {
            analyticsId: analytics.id
          },
          month: currentMonth,
          year: currentYear,
        },
      });

      // Get previous month data for comparison
      const previousMonthData = await prisma.searchConsoleKeywordMonthlyComputed.findMany({
        where: {
          keywordId: {
            in: currentMonthData.map(k => k.keywordId)
          },
          month: prevMonth,
          year: prevYear,
        },
      });

      // Calculate movement stats
      let improved = 0;
      let declined = 0;
      let unchanged = 0;

      for (const current of currentMonthData) {
        const previous = previousMonthData.find(p => p.keywordId === current.keywordId);

        if (!previous || current.averageRank === 0 || previous.averageRank === 0) {
          unchanged++;
          continue;
        }

        // Lower rank number means better position
        if (current.averageRank < previous.averageRank) {
          improved++;
        } else if (current.averageRank > previous.averageRank) {
          declined++;
        } else {
          unchanged++;
        }
      }

      return {
        improved,
        declined,
        unchanged,
      };
    } catch (error) {
      console.error('Error in getKeywordMovementStats:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch keyword movement stats',
      });
    }
  }),

  // Check if milestone is achieved for a campaign
  checkMilestoneAchievement: protectedProcedure
    .input(
      z.object({
        campaignId: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const { campaignId } = input;

        // Verify campaign access
        const campaign = await prisma.campaign.findUnique({
          where: { id: campaignId },
          include: { user: true },
        });

        if (!campaign) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found',
          });
        }

        // Check if user has access to this campaign
        if (ctx.user.role !== 'ADMIN' && campaign.userId !== ctx.user.id) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this campaign',
          });
        }

        // Get admin notification preferences to check click threshold
        const adminPrefs = await prisma.adminNotificationPreferences.findFirst();

        if (!adminPrefs || !adminPrefs.clickThresholds) {
          return {
            achieved: false,
            clicksThreshold: 0,
            currentClicks: 0,
          };
        }

        const clickThresholds = JSON.parse(adminPrefs.clickThresholds) as number[];
        const clicksThreshold = clickThresholds[0] || 100; // Use first threshold

        // Get total clicks for the last year
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        const trafficAnalytics = await prisma.searchConsoleTrafficAnalytics.findFirst({
          where: { siteUrl: campaign.searchConsoleSite },
          include: {
            daily: {
              where: {
                date: {
                  gte: oneYearAgo,
                },
              },
            },
          },
        });

        const currentClicks =
          trafficAnalytics?.daily.reduce(
            (sum: number, stat: { clicks: number }) => sum + stat.clicks,
            0
          ) || 0;

        return {
          achieved: currentClicks >= clicksThreshold,
          clicksThreshold,
          currentClicks,
        };
      } catch (error) {
        console.error('Error in checkMilestoneAchievement:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to check milestone achievement',
        });
      }
    }),

  // Get best-performing month (by clicks) and compare vs same month last year
  getBestPerformingMonth: protectedProcedure
    .input(z.object({ campaignId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      try {
        const campaign = await prisma.campaign.findFirst({ where: { id: input.campaignId } });
        if (!campaign) throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found' });
        if (campaign.userId !== ctx.user.id && ctx.user.role !== 'ADMIN') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this campaign' });
        }

        const analytics = await prisma.searchConsoleTrafficAnalytics.findFirst({ where: { siteUrl: campaign.searchConsoleSite } });
        if (!analytics) {
          return { bestMonth: null, bestMonthClicks: 0, comparisonClicks: 0, improvementPercentage: 0 };
        }

        const today = new Date();
        const thisYear = today.getFullYear();
        const lastYear = thisYear - 1;

        const monthly = await prisma.searchConsoleTrafficMonthly.findMany({
          where: { analyticsId: analytics.id, OR: [{ year: thisYear }, { year: lastYear }] },
        });

        const thisYearRows = monthly.filter((m) => m.year === thisYear);
        if (thisYearRows.length === 0) {
          return { bestMonth: null, bestMonthClicks: 0, comparisonClicks: 0, improvementPercentage: 0 };
        }

        const best = thisYearRows.reduce((b, r) => (r.clicks > b.clicks ? r : b));
        const comparison = monthly.find((m) => m.year === lastYear && m.month === best.month);
        const comparisonClicks = comparison?.clicks || 0;
        const improvementPercentage =
          comparisonClicks > 0 ? Math.round(((best.clicks - comparisonClicks) / comparisonClicks) * 100) : 0;

        return {
          bestMonth: best.month,
          bestMonthClicks: best.clicks,
          comparisonClicks,
          improvementPercentage,
        };
      } catch (error) {
        console.error('Error in getBestPerformingMonth:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to get best performing month' });
      }
    }),

  // Get total organic visits from Jan 1 of last year to today
  getTotalOrganicVisits: protectedProcedure
    .input(z.object({ campaignId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      try {
        const campaign = await prisma.campaign.findFirst({ where: { id: input.campaignId } });
        if (!campaign) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found' });
        }
        if (campaign.userId !== ctx.user.id && ctx.user.role !== 'ADMIN') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this campaign' });
        }

        const analytics = await prisma.searchConsoleTrafficAnalytics.findFirst({ where: { siteUrl: campaign.searchConsoleSite } });
        if (!analytics) {
          return { totalClicks: 0, startDate: null, endDate: null, daysWithData: 0 };
        }

        const today = new Date();
        const startDate = new Date(today.getFullYear() - 1, 0, 1);
        const endDate = today;

        const dailyRows = await prisma.searchConsoleTrafficDaily.findMany({
          where: { analyticsId: analytics.id, date: { gte: startDate, lte: endDate } },
          select: { clicks: true },
        });

        const totalClicks = dailyRows.reduce((acc: number, row: { clicks: number }) => acc + (row.clicks || 0), 0);

        return { totalClicks, startDate, endDate, daysWithData: dailyRows.length };
      } catch (error) {
        console.error('Error in getTotalOrganicVisits:', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch total organic visits' });
      }
    }),
});