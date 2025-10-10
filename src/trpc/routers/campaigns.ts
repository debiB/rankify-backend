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
      `Campaign ${
        newCampaign.name
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
          `🔄 Fetching data for ${
            addedKeywords.length
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
        `🔄 Fetching data for ${
          addedKeywords.length
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
                    const monthKey = `${
                      date.getMonth() + 1
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
          message: `Failed to fetch campaign analytics: ${
            error instanceof Error ? error.message : 'Unknown error'
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
                      const monthKey = `${
                        date.getMonth() + 1
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
        month: z.string().optional(), // Format: "Oct 24" or "Aug 24"
      })
    )
    .query(async ({ input, ctx }) => {
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
        if (campaign.userId !== ctx.user.id && ctx.user.role !== 'ADMIN') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this campaign',
          });
        }

        // Get traffic analytics for the site
        const trafficAnalytics =
          await prisma.searchConsoleTrafficAnalytics.findFirst({
            where: { siteUrl: campaign.searchConsoleSite },
            include: {
              monthly: {
                orderBy: [{ year: 'asc' }, { month: 'asc' }],
              },
              daily: {
                orderBy: { date: 'asc' },
              },
            },
          });
          
        // Parse the selected month to get the correct year and month
        const monthNamesForParsing = [
          "Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
        ];
        
        let selectedTargetYear: number;
        let selectedTargetMonth: number;
        
        if (input.month) {
          const [monthStr, yearStr] = input.month.split(' ');
          const monthIndex = monthNamesForParsing.indexOf(monthStr);
          selectedTargetMonth = monthIndex;
          selectedTargetYear = 2000 + parseInt(yearStr);
        } else {
          const currentDate = new Date();
          selectedTargetMonth = currentDate.getMonth();
          selectedTargetYear = currentDate.getFullYear();
        }
        
        // Check if we have data for the selected month
        let hasDataForSelectedMonth = false;
        
        if (trafficAnalytics && trafficAnalytics.daily.length > 0) {
          hasDataForSelectedMonth = trafficAnalytics.daily.some(day => {
            const date = new Date(day.date);
            return date.getMonth() === selectedTargetMonth && date.getFullYear() === selectedTargetYear;
          });
        }
        
        // If a month is selected and we don't have data for it, fetch from Google Search Console
        if (input.month && campaign.googleAccountId && (!hasDataForSelectedMonth || input.month.includes(new Date().getFullYear().toString().substring(2)))) {
          const googleAccount = await prisma.googleAccount.findUnique({
            where: { id: campaign.googleAccountId },
          });
          
          if (googleAccount) {
            const analyticsService = new AnalyticsService();
            const freshData = await analyticsService.fetchTrafficData({
              campaign,
              googleAccount,
              waitForAllData: false,
              selectedMonth: input.month,
            });
            
            if (freshData && freshData.daily && Object.keys(freshData.daily).length > 0) {
              console.log(`[getCampaignTrafficData] Fetched fresh data for selected month: ${input.month}`);
              
              // Update the daily data in the database
              for (const [dateKey, metrics] of Object.entries(freshData.daily)) {
                const date = new Date(dateKey);
                await prisma.searchConsoleTrafficDaily.upsert({
                  where: {
                    analyticsId_date: {
                      analyticsId: trafficAnalytics?.id || '',
                      date,
                    },
                  },
                  update: {
                    clicks: metrics.clicks,
                    impressions: metrics.impressions,
                    ctr: metrics.ctr,
                    position: metrics.position,
                  },
                  create: {
                    analyticsId: trafficAnalytics?.id || '',
                    date,
                    clicks: metrics.clicks,
                    impressions: metrics.impressions,
                    ctr: metrics.ctr,
                    position: metrics.position,
                  },
                });
              }
              
              // Refresh the traffic analytics data
              const updatedTrafficAnalytics = await prisma.searchConsoleTrafficAnalytics.findFirst({
                where: { id: trafficAnalytics?.id || '' },
                include: {
                  monthly: {
                    orderBy: [{ year: 'asc' }, { month: 'asc' }],
                  },
                  daily: {
                    orderBy: { date: 'asc' },
                  },
                },
              });
              
              if (updatedTrafficAnalytics) {
                if (trafficAnalytics) {
                  trafficAnalytics.daily = updatedTrafficAnalytics.daily;
                }
              }
            }
          }
        }

        if (!trafficAnalytics) {
          return {
            monthly: [],
            daily: [],
          };
        }

        // Generate the last 12 months from today
        const currentDate = new Date();
        const last12Months: Array<{
          month: string;
          clicks: number;
          impressions: number;
          ctr: number;
          position: number;
        }> = [];

        const monthNamesForDisplay = [
          'Jan',
          'Feb',
          'Mar',
          'Apr',
          'May',
          'Jun',
          'Jul',
          'Aug',
          'Sep',
          'Oct',
          'Nov',
          'Dec',
        ];

        // Create data for the last 12 complete months (excluding current month)
        for (let i = 12; i >= 1; i--) {
          const date = new Date(
            currentDate.getFullYear(),
            currentDate.getMonth() - i,
            1
          );
          const monthName = monthNamesForDisplay[date.getMonth()];
          const year = date.getFullYear().toString().slice(-2);
          const monthKey = `${monthName} ${year}`;

          // Find matching data from the database
          const monthData = trafficAnalytics.monthly.find((month) => {
            const dbDate = new Date(month.year, month.month - 1, 1);
            return (
              dbDate.getMonth() === date.getMonth() &&
              dbDate.getFullYear() === date.getFullYear()
            );
          });

          // Only add months that have actual clicks (meaningful engagement)
          if (monthData && monthData.clicks > 0) {
            last12Months.push({
              month: monthKey,
              clicks: monthData.clicks,
              impressions: monthData.impressions,
              ctr: monthData.ctr,
              position: monthData.position,
            });
          }
        }

        // Add current month data by aggregating daily records
        const currentMonthForChart = new Date().getMonth();
        const currentYearForChart = new Date().getFullYear();
        const monthNamesForFormatting = [
          'Jan',
          'Feb',
          'Mar',
          'Apr',
          'May',
          'Jun',
          'Jul',
          'Aug',
          'Sep',
          'Oct',
          'Nov',
          'Dec',
        ];
        const currentMonthName = monthNamesForFormatting[currentMonthForChart];
        const currentYearShort = currentYearForChart.toString().slice(-2);
        const currentMonthKey = `${currentMonthName} ${currentYearShort}`;

        // Get daily records for current month
        const currentMonthDailyRecords = trafficAnalytics.daily.filter(
          (day) => {
            const date = new Date(day.date);
            return (
              date.getMonth() === currentMonthForChart &&
              date.getFullYear() === currentYearForChart
            );
          }
        );

        // Aggregate current month data from daily records
        if (currentMonthDailyRecords.length > 0) {
          const totalClicks = currentMonthDailyRecords.reduce(
            (sum, day) => sum + (day?.clicks || 0),
            0
          );
          const totalImpressions = currentMonthDailyRecords.reduce(
            (sum, day) => sum + (day?.impressions || 0),
            0
          );
          const totalPosition = currentMonthDailyRecords.reduce(
            (sum, day) => sum + (day?.position || 0),
            0
          );

          const averageCtr =
            totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
          const averagePosition =
            currentMonthDailyRecords.length > 0
              ? totalPosition / currentMonthDailyRecords.length
              : 0;

          last12Months.push({
            month: currentMonthKey,
            clicks: totalClicks,
            impressions: totalImpressions,
            ctr: parseFloat(averageCtr.toFixed(2)),
            position: parseFloat(averagePosition.toFixed(2)),
          });
        }

        const monthlyData = last12Months;

        // Format daily data for charts
        // Parse the selected month if provided, otherwise use current month
        let filterTargetMonth = new Date().getMonth();
        let filterTargetYear = new Date().getFullYear();
        
        if (input.month) {
          // Parse month string like "Oct 24" or "Aug 24"
          const [monthStr, yearStr] = input.month.split(' ');
          const monthIndex = monthNamesForDisplay.indexOf(monthStr);
          if (monthIndex !== -1) {
            filterTargetMonth = monthIndex;
            filterTargetYear = 2000 + parseInt(yearStr); // Convert "24" to 2024
          }
          console.log(`[getCampaignTrafficData] Parsed month: ${monthStr} ${yearStr} -> targetMonth: ${filterTargetMonth}, targetYear: ${filterTargetYear}`);
        }

        console.log(`[getCampaignTrafficData] Filtering for month: ${filterTargetMonth} (0-indexed), year: ${filterTargetYear}`);
        console.log(`[getCampaignTrafficData] Total daily records before filter: ${trafficAnalytics.daily.length}`);

        const dailyData = trafficAnalytics.daily
          .filter((day) => {
            const date = new Date(day.date);
            const matches = date.getMonth() === filterTargetMonth && date.getFullYear() === filterTargetYear;
            if (!matches && input.month) {
              console.log(`[getCampaignTrafficData] Filtering out date: ${day.date}, month: ${date.getMonth()}, year: ${date.getFullYear()}`);
            }
            return matches;
          })
          .map((day) => {
            const date = new Date(day.date);
            const dayOfMonth = date.getDate();
            const monthNamesForFormatting = [
              'Jan',
              'Feb',
              'Mar',
              'Apr',
              'May',
              'Jun',
              'Jul',
              'Aug',
              'Sep',
              'Oct',
              'Nov',
              'Dec',
            ];
            const monthName = monthNamesForFormatting[date.getMonth()];

            return {
              date: `${dayOfMonth} ${monthName}`,
              clicks: day?.clicks || 0,
              impressions: day?.impressions || 0,
              ctr: day?.ctr || 0,
              position: day?.position || 0,
            };
          })
          .sort((a, b) => {
            // Sort by day of month
            const dayA = parseInt(a.date.split(' ')[0]);
            const dayB = parseInt(b.date.split(' ')[0]);
            return dayA - dayB;
          });

        console.log(`[getCampaignTrafficData] Filtered daily records: ${dailyData.length}`);
        if (dailyData.length > 0) {
          console.log(`[getCampaignTrafficData] First day: ${dailyData[0].date}, Last day: ${dailyData[dailyData.length - 1].date}`);
        }

        return {
          monthly: monthlyData,
          daily: dailyData,
        };
      } catch (error) {
        console.error('Error in getCampaignTrafficData:', error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch traffic data: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        });
      }
    }),

  // Manually trigger daily traffic fetch (admin only)
  triggerDailyTraffic: adminProcedure.mutation(async ({ ctx }) => {
    try {
      const { CronService } = await import('../../services/cronService');
      const cronService = CronService.getInstance();

      // Trigger the daily traffic job
      await cronService.triggerDailyTraffic();

      return {
        success: true,
        message: 'Daily traffic fetch job triggered successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Error triggering daily traffic job:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to trigger daily traffic job: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      });
    }
  }),

  // Get campaign performance metrics (weekly and monthly changes)
  getCampaignPerformanceMetrics: adminProcedure
    .input(
      z.object({
        campaignIds: z.array(z.string()).optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const { campaignIds } = input;

        // Build where clause for campaigns
        const campaignWhere: any = {};
        if (campaignIds && campaignIds.length > 0) {
          campaignWhere.id = { in: campaignIds };
        }

        // Get all campaigns
        const campaigns = await prisma.campaign.findMany({
          where: campaignWhere,
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

        const performanceMetrics = [];

        for (const campaign of campaigns) {
          // Get analytics data for this campaign
          const analytics =
            await prisma.searchConsoleKeywordAnalytics.findFirst({
              where: { siteUrl: campaign.searchConsoleSite },
              include: {
                keywords: {
                  include: {
                    monthlyStats: {
                      orderBy: [{ year: 'asc' }, { month: 'asc' }],
                    },
                    dailyStats: {
                      orderBy: { date: 'asc' },
                    },
                  },
                },
              },
            });

          if (!analytics || analytics.keywords.length === 0) {
            performanceMetrics.push({
              campaignId: campaign.id,
              campaignName: campaign.name,
              searchConsoleSite: campaign.searchConsoleSite,
              weeklyChange: { up: 0, neutral: 0, down: 0 },
              weeklyPercentage: 0,
              monthlyChange: { up: 0, neutral: 0, down: 0 },
              monthlyPercentage: 0,
              overallPerformance: 0,
            });
            continue;
          }

          // Calculate current and previous month/year for monthly changes
          const currentDate = new Date();
          const currentMonth = currentDate.getMonth() + 1;
          const currentYear = currentDate.getFullYear();

          // Previous month
          let prevMonth = currentMonth - 1;
          let prevYear = currentYear;
          if (prevMonth === 0) {
            prevMonth = 12;
            prevYear--;
          }

          // Calculate weekly changes using daily data
          const oneWeekAgo = new Date(currentDate);
          oneWeekAgo.setDate(currentDate.getDate() - 7);
          const twoWeeksAgo = new Date(currentDate);
          twoWeeksAgo.setDate(currentDate.getDate() - 14);

          let weeklyUp = 0;
          let weeklyNeutral = 0;
          let weeklyDown = 0;
          let monthlyUp = 0;
          let monthlyNeutral = 0;
          let monthlyDown = 0;
          const totalKeywords = analytics.keywords.length;

          // Calculate changes for each keyword
          for (const keyword of analytics.keywords) {
            // Get daily stats for weekly calculation
            const currentWeekStats = keyword.dailyStats.filter(
              (stat) => new Date(stat.date) >= oneWeekAgo
            );
            const previousWeekStats = keyword.dailyStats.filter((stat) => {
              const statDate = new Date(stat.date);
              return statDate >= twoWeeksAgo && statDate < oneWeekAgo;
            });

            // Calculate weekly change: this week vs last week
            if (currentWeekStats.length > 0 && previousWeekStats.length > 0) {
              // Calculate average rank for current week
              const currentWeekAvg =
                currentWeekStats.reduce(
                  (sum, stat) => sum + (stat.averageRank || 0),
                  0
                ) / currentWeekStats.length;

              // Calculate average rank for previous week
              const previousWeekAvg =
                previousWeekStats.reduce(
                  (sum, stat) => sum + (stat.averageRank || 0),
                  0
                ) / previousWeekStats.length;

              const weeklyChange = Math.floor(previousWeekAvg - currentWeekAvg);

              if (weeklyChange > 0) {
                weeklyUp++; // Improved position
              } else if (weeklyChange < 0) {
                weeklyDown++; // Worse position
              } else {
                weeklyNeutral++; // No change
              }
            } else {
              // If we don't have data for either week, count as neutral
              weeklyNeutral++;
            }

            // Calculate monthly change: this month vs last month
            const currentMonthStats = keyword.dailyStats.filter((stat) => {
              const statDate = new Date(stat.date);
              return (
                statDate.getMonth() + 1 === currentMonth &&
                statDate.getFullYear() === currentYear
              );
            });
            const previousMonthStats = keyword.dailyStats.filter((stat) => {
              const statDate = new Date(stat.date);
              return (
                statDate.getMonth() + 1 === prevMonth &&
                statDate.getFullYear() === prevYear
              );
            });

            if (currentMonthStats.length > 0 && previousMonthStats.length > 0) {
              // Calculate average rank for current month
              const currentMonthAvg =
                currentMonthStats.reduce(
                  (sum, stat) => sum + (stat.averageRank || 0),
                  0
                ) / currentMonthStats.length;

              // Calculate average rank for previous month
              const previousMonthAvg =
                previousMonthStats.reduce(
                  (sum, stat) => sum + (stat.averageRank || 0),
                  0
                ) / previousMonthStats.length;

              const monthlyChange = Math.floor(
                previousMonthAvg - currentMonthAvg
              );

              if (monthlyChange > 0) {
                monthlyUp++; // Improved position
              } else if (monthlyChange < 0) {
                monthlyDown++; // Worse position
              } else {
                monthlyNeutral++; // No change
              }
            } else {
              // If we don't have data for either month, count as neutral
              monthlyNeutral++;
            }
          }

          // Calculate percentages: amount improved keywords / total keywords
          const weeklyPercentage =
            totalKeywords > 0
              ? Math.floor((weeklyUp / totalKeywords) * 100)
              : 0;
          const monthlyPercentage =
            totalKeywords > 0
              ? Math.floor((monthlyUp / totalKeywords) * 100)
              : 0;

          // Calculate overall performance: count of improved keywords (initial rank date to today) / total keywords
          let overallImproved = 0;

          for (const keyword of analytics.keywords) {
            // Get initial rank (from the keyword's initialPosition field)
            const initialRank = keyword.initialPosition || 0;

            // Get current rank (latest daily stat)
            const latestDailyStat = keyword.dailyStats
              .sort(
                (a, b) =>
                  new Date(b.date).getTime() - new Date(a.date).getTime()
              )
              .find((stat) => (stat.averageRank || 0) > 0);

            const currentRank = latestDailyStat?.averageRank || 0;

            // Check if keyword improved (lower rank number is better)
            if (
              initialRank > 0 &&
              currentRank > 0 &&
              currentRank < initialRank
            ) {
              overallImproved++;
            }
          }

          const overallPercentage =
            totalKeywords > 0
              ? Math.floor((overallImproved / totalKeywords) * 100)
              : 0;

          performanceMetrics.push({
            campaignId: campaign.id,
            campaignName: campaign.name,
            searchConsoleSite: campaign.searchConsoleSite,
            weeklyChange: {
              up: weeklyUp,
              neutral: weeklyNeutral,
              down: weeklyDown,
            },
            weeklyPercentage,
            monthlyChange: {
              up: monthlyUp,
              neutral: monthlyNeutral,
              down: monthlyDown,
            },
            monthlyPercentage,
            overallPerformance: overallPercentage,
          });
        }

        return performanceMetrics;
      } catch (error) {
        console.error('Error in getCampaignPerformanceMetrics:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch campaign performance metrics: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        });
      }
    }),

  /**
   * Log monthly keyword metrics for a campaign
   * This endpoint logs detailed metrics for all keywords in a campaign for the current month
   */
  logMonthlyKeywordMetrics: protectedProcedure
    .input(
      z.object({
        campaignId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { campaignId } = input;

        // Check if campaign exists and user has access
        const campaign = await prisma.campaign.findFirst({
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
        if (campaign.userId !== ctx.user.id && ctx.user.role !== 'ADMIN') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this campaign',
          });
        }

        return {
          success: true,
          message: 'Monthly keyword metrics logged successfully',
        };
      } catch (error) {
        console.error('Error in logMonthlyKeywordMetrics:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to log monthly keyword metrics: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        });
      }
    }),

  // Re-fetch all search data for a specific campaign (admin only)
  reFetchCampaignData: adminProcedure
    .input(z.object({ campaignId: z.string() }))
    .mutation(async ({ input }) => {
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

        console.log(`Starting data re-fetch for campaign: ${campaign.name}`);

        // 1) First delete existing data for this campaign/site
        const siteUrl = campaign.searchConsoleSite;

        const keywordAnalytics =
          await prisma.searchConsoleKeywordAnalytics.findFirst({
            where: { siteUrl },
          });
        const trafficAnalytics =
          await prisma.searchConsoleTrafficAnalytics.findFirst({
            where: { siteUrl },
          });

        if (keywordAnalytics) {
          // Delete monthly stat data first
          // Note: searchConsoleKeywordMonthlyComputed was replaced with searchConsoleKeywordMonthlyStat
          await prisma.searchConsoleKeywordMonthlyStat.deleteMany({
            where: { keyword: { analyticsId: keywordAnalytics.id } },
          });
          await prisma.searchConsoleKeywordDailyStat.deleteMany({
            where: { keyword: { analyticsId: keywordAnalytics.id } },
          });
          await prisma.searchConsoleKeyword.deleteMany({
            where: { analyticsId: keywordAnalytics.id },
          });
          await prisma.searchConsoleKeywordAnalytics.delete({
            where: { id: keywordAnalytics.id },
          });
        }

        if (trafficAnalytics) {
          await prisma.searchConsoleTrafficDaily.deleteMany({
            where: { analyticsId: trafficAnalytics.id },
          });
          await prisma.searchConsoleTrafficMonthly.deleteMany({
            where: { analyticsId: trafficAnalytics.id },
          });
          await prisma.searchConsoleTrafficAnalytics.delete({
            where: { id: trafficAnalytics.id },
          });
        }

        // 2) Then fetch fresh data
        const results = await Promise.allSettled([
          analyticsService.fetchDailySiteTraffic({
            campaignId: campaign.id,
            waitForAllData: true,
          }),
          analyticsService.fetchDailyKeywordData({
            campaignId: campaign.id,
            waitForAllData: true,
          }),
          analyticsService.fetchAndSaveMonthlyTrafficData({
            campaignId: campaign.id,
            waitForAllData: true,
          }),
        ]);

        const successful = results.filter(
          (result) => result.status === 'fulfilled'
        ).length;
        const failed = results.filter(
          (result) => result.status === 'rejected'
        ).length;

        console.log(
          `Data re-fetch completed for campaign: ${campaign.name}. ${successful} successful, ${failed} failed.`
        );

        return {
          success: true,
          campaignName: campaign.name,
          results: {
            successful,
            failed,
            total: results.length,
          },
        };
      } catch (error) {
        console.error('Error re-fetching campaign data:', error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to re-fetch campaign data',
        });
      }
    }),

  // Export raw GSC daily keyword rows for a custom date range [startDate, endDate]
  exportKeywordRawRange: adminProcedure
    .input(
      z.object({
        campaignId: z.string(),
        startDate: z.string(), // YYYY-MM-DD
        endDate: z.string(), // YYYY-MM-DD
      })
    )
    .mutation(async ({ input }) => {
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

        // Get keyword data for the site
        const keywordAnalytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
          where: { siteUrl: campaign.searchConsoleSite },
          include: {
            keywords: {
              include: {
                dailyStats: true,
              },
            },
          },
        });

        if (!keywordAnalytics) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'No keyword data found',
          });
        }

        const startDate = new Date(input.startDate);
        const endDate = new Date(input.endDate);

        if (startDate > endDate) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Start date must be before end date',
          });
        }

        // Filter daily stats for the date range
        const filteredDailyStats: any[] = [];

        for (const keyword of keywordAnalytics.keywords) {
          for (const stat of keyword.dailyStats) {
            const statDate = new Date(stat.date);
            if (statDate >= startDate && statDate <= endDate) {
              // For daily stats, we need to calculate CTR from the computed monthly data
              // or use searchVolume as a proxy for impressions
              filteredDailyStats.push({
                id: stat.id,
                campaignId: campaign.id,
                keywordId: keyword.id,
                date: statDate.toISOString(),
                searchVolume: stat.searchVolume,
                averageRank: stat.averageRank || 0,
                topRankingPageUrl: stat.topRankingPageUrl,
              });
            }
          }
        }

        return filteredDailyStats;
      } catch (error) {
        console.error('Error in exportKeywordRawRange:', error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch keyword data: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        });
      }
    }),

  getTotalOrganicVisits: protectedProcedure
    .input(z.object({ campaignId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
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
        if (campaign.userId !== ctx.user.id && ctx.user.role !== 'ADMIN') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this campaign',
          });
        }

        // Get traffic analytics for the site
        const trafficAnalytics = await prisma.searchConsoleTrafficAnalytics.findFirst({
          where: { siteUrl: campaign.searchConsoleSite },
          include: {
            daily: true,
          },
        });

        if (!trafficAnalytics) {
          return {
            totalClicks: 0,
          };
        }

        // Calculate total clicks from all daily records
        const totalClicks = trafficAnalytics.daily.reduce(
          (sum, day) => sum + day.clicks,
          0
        );

        return {
          totalClicks,
        };
      } catch (error) {
        console.error('Error in getTotalOrganicVisits:', error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch total organic visits',
        });
      }
    }),

  // Get best performing month for a campaign
  getBestPerformingMonth: protectedProcedure
    .input(z.object({ campaignId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
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
        if (campaign.userId !== ctx.user.id && ctx.user.role !== 'ADMIN') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this campaign',
          });
        }

        // Get traffic analytics for the site
        const trafficAnalytics = await prisma.searchConsoleTrafficAnalytics.findFirst({
          where: { siteUrl: campaign.searchConsoleSite },
          include: {
            monthly: {
              orderBy: [{ year: 'asc' }, { month: 'asc' }],
            },
          },
        });

        if (!trafficAnalytics || trafficAnalytics.monthly.length === 0) {
          return {
            bestMonth: null,
            improvementPercentage: 0,
            bestMonthClicks: 0,
            comparisonClicks: 0,
          };
        }

        // Find the month with the highest clicks
        let bestMonthRecord = trafficAnalytics.monthly[0];
        for (const monthRecord of trafficAnalytics.monthly) {
          if (monthRecord.clicks > bestMonthRecord.clicks) {
            bestMonthRecord = monthRecord;
          }
        }

        // Find the same month from the previous year for comparison
        const previousYear = bestMonthRecord.year - 1;
        const comparisonMonth = trafficAnalytics.monthly.find(
          (month) => 
            month.month === bestMonthRecord.month && 
            month.year === previousYear
        );

        const bestMonthClicks = bestMonthRecord.clicks;
        const comparisonClicks = comparisonMonth ? comparisonMonth.clicks : 0;
        
        // Calculate improvement percentage
        let improvementPercentage = 0;
        if (comparisonClicks > 0) {
          improvementPercentage = parseFloat(
            (((bestMonthClicks - comparisonClicks) / comparisonClicks) * 100).toFixed(1)
          );
        } else if (bestMonthClicks > 0) {
          // If there were no clicks last year but there are this year, show 100% improvement
          improvementPercentage = 100;
        }

        return {
          bestMonth: bestMonthRecord.month,
          improvementPercentage,
          bestMonthClicks,
          comparisonClicks,
        };
      } catch (error) {
        console.error('Error in getBestPerformingMonth:', error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch best performing month',
        });
      }
    }),

  // Get unused potential keywords (CTR < 5%) for a campaign and selected month
  getUnusedPotential: adminProcedure
    .input(
      z.object({
        campaignId: z.string(),
        selectedMonth: z.string(), // Format: "Month YYYY" (e.g., "October 2025")
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const { campaignId, selectedMonth } = input;

        // Get the campaign
        const campaign = await prisma.campaign.findFirst({
          where: { id: campaignId },
          include: {
            googleAccount: true,
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

        // Parse the selected month to get month and year
        const [monthName, yearStr] = selectedMonth.split(' ');
        const year = parseInt(yearStr);
        
        const monthNames = [
          'January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December'
        ];
        const month = monthNames.indexOf(monthName) + 1; // 1-based month

        if (month === 0 || isNaN(year)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Invalid month format',
          });
        }

        // Get keyword analytics for the site
        let keywordAnalytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
          where: { siteUrl: campaign.searchConsoleSite },
          include: {
            keywords: {
              include: {
                dailyStats: true,
                monthlyStats: true,
              },
            },
          },
        });

        if (!keywordAnalytics) {
          // If no data exists, fetch from Search Console
          await analyticsService.fetchDailyKeywordData({
            campaignId: campaign.id,
            waitForAllData: true,
          });

          // Try again after fetching
          keywordAnalytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
            where: { siteUrl: campaign.searchConsoleSite },
            include: {
              keywords: {
                include: {
                  dailyStats: true,
                  monthlyStats: true,
                },
              },
            },
          });

          if (!keywordAnalytics) {
            return { keywords: [] };
          }
        }

        // Filter keywords with CTR < 5% for the selected month
        const unusedPotentialKeywords = [];

        // Get computed monthly data for all keywords in one query (using the correct model)
        const monthlyComputedData = await prisma.searchConsoleKeywordMonthlyComputed.findMany({
          where: {
            keywordId: {
              in: keywordAnalytics.keywords.map(k => k.id)
            },
            month: month,
            year: year
          }
        });

        for (const keyword of keywordAnalytics.keywords) {
          // Find computed data for this keyword
          const monthlyComputed = monthlyComputedData.find(
            data => data.keywordId === keyword.id
          );

          // Calculate CTR from clicks and impressions
          let ctr = 0;
          if (monthlyComputed && monthlyComputed.impressions > 0) {
            ctr = (monthlyComputed.clicks / monthlyComputed.impressions) * 100;
          }

          // If we have monthly data and CTR < 5%
          if (monthlyComputed && ctr < 5) {
            // Find top page for this keyword in the selected month
            const dailyStatsForMonth = keyword.dailyStats.filter(stat => {
              const statDate = new Date(stat.date);
              return (
                statDate.getMonth() + 1 === month &&
                statDate.getFullYear() === year
              );
            });

            // Aggregate data for the month
            let totalImpressions = 0;
            let totalPosition = 0;
            let topPageLink = '';

            // Calculate totals and find top page by search volume (which represents impressions)
            const pageImpressions: Record<string, number> = {};
            dailyStatsForMonth.forEach(stat => {
              totalPosition += stat.averageRank || 0;

              if (stat.topRankingPageUrl) {
                pageImpressions[stat.topRankingPageUrl] =
                  (pageImpressions[stat.topRankingPageUrl] || 0) + stat.searchVolume;
              }
            });

            // Calculate total impressions from aggregated page data
            totalImpressions = Object.values(pageImpressions).reduce((sum, impressions) => sum + impressions, 0);

            // Find the page with the most impressions
            let maxImpressions = 0;
            for (const [page, impressions] of Object.entries(pageImpressions)) {
              if (impressions > maxImpressions) {
                maxImpressions = impressions;
                topPageLink = page;
              }
            }

            // Calculate average position
            const averagePosition = dailyStatsForMonth.length > 0 
              ? totalPosition / dailyStatsForMonth.length 
              : 0;

            unusedPotentialKeywords.push({
              id: keyword.id,
              keyword: keyword.keyword,
              ctr: ctr,
              impressions: monthlyComputed.impressions,
              clicks: monthlyComputed.clicks,
              position: parseFloat(averagePosition.toFixed(2)),
              searchVolume: monthlyComputed.impressions, // Using impressions as search volume proxy
              topPageLink,
            });
          }
        }

        // Sort by impressions descending
        unusedPotentialKeywords.sort((a, b) => b.impressions - a.impressions);

        return { keywords: unusedPotentialKeywords };
      } catch (error) {
        console.error('Error in getUnusedPotential:', error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch unused potential keywords: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        });
      }
    }),

  // Get count of active campaigns
  getActiveCampaignsCount: protectedProcedure.query(async ({ ctx }) => {
    try {
      // For regular users, count their own campaigns
      // For admins, count all active campaigns
      const whereClause: Prisma.CampaignWhereInput = ctx.user.role === 'ADMIN' 
        ? { status: 'ACTIVE' as const } 
        : { userId: ctx.user.id, status: 'ACTIVE' as const };

      const count = await prisma.campaign.count({
        where: whereClause,
      });

      return count;
    } catch (error) {
      console.error('Error in getActiveCampaignsCount:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch active campaigns count',
      });
    }
  }),

  // Get overall visibility for all campaigns
  // Overall Visibility = (Keywords ranking 1-20 / Total keywords) × 100
  getOverallVisibility: protectedProcedure.query(async ({ ctx }) => {
    try {
      // For regular users, get their own campaigns
      // For admins, get all campaigns
      const whereClause = ctx.user.role === 'ADMIN' 
        ? {} 
        : { userId: ctx.user.id };

      const campaigns = await prisma.campaign.findMany({
        where: whereClause,
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

      if (campaigns.length === 0) {
        return 0;
      }

      let totalKeywordsInTop20 = 0;
      let totalKeywords = 0;

      // Process each campaign
      for (const campaign of campaigns) {
        // Get analytics data for this campaign
        const analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
          where: { siteUrl: campaign.searchConsoleSite },
          include: {
            keywords: {
              include: {
                dailyStats: {
                  orderBy: { date: 'desc' },
                },
              },
            },
          },
        });

        if (!analytics) continue;

        // Process each keyword in the campaign
        for (const keyword of analytics.keywords) {
          totalKeywords++;

          // Get the most recent daily stat for this keyword
          const latestStat = keyword.dailyStats[0];
          if (latestStat && latestStat.averageRank !== null) {
            // Check if the keyword is ranking in top 20 (positions 1-20)
            if (latestStat.averageRank >= 1 && latestStat.averageRank <= 20) {
              totalKeywordsInTop20++;
            }
          }
        }
      }

      // Calculate overall visibility
      const overallVisibility = totalKeywords > 0 
        ? (totalKeywordsInTop20 / totalKeywords) * 100 
        : 0;

      return parseFloat(overallVisibility.toFixed(2));
    } catch (error) {
      console.error('Error in getOverallVisibility:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to calculate overall visibility',
      });
    }
  }),

  // Get total keywords tracked across all campaigns
  getKeywordsTrackedCount: protectedProcedure.query(async ({ ctx }) => {
    try {
      // For regular users, get their own campaigns
      // For admins, get all campaigns
      const whereClause = ctx.user.role === 'ADMIN' 
        ? {} 
        : { userId: ctx.user.id };

      const campaigns = await prisma.campaign.findMany({
        where: whereClause,
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

      let totalKeywords = 0;

      // Process each campaign
      for (const campaign of campaigns) {
        // Get analytics data for this campaign
        const analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
          where: { siteUrl: campaign.searchConsoleSite },
          include: {
            keywords: true,
          },
        });

        if (analytics) {
          totalKeywords += analytics.keywords.length;
        }
      }

      return { count: totalKeywords };
    } catch (error) {
      console.error('Error in getKeywordsTrackedCount:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch keywords tracked count',
      });
    }
  }),

  // Get top performing campaign score
  getTopPerformingCampaign: protectedProcedure.query(async ({ ctx }) => {
    try {
      // For regular users, get their own campaigns
      // For admins, get all campaigns
      const whereClause = ctx.user.role === 'ADMIN' 
        ? {} 
        : { userId: ctx.user.id };

      const campaigns = await prisma.campaign.findMany({
        where: whereClause,
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

      if (campaigns.length === 0) {
        return { score: 0 };
      }

      let bestScore = 0;

      // Process each campaign
      for (const campaign of campaigns) {
        // Get analytics data for this campaign
        const analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
          where: { siteUrl: campaign.searchConsoleSite },
          include: {
            keywords: {
              include: {
                monthlyStats: {
                  orderBy: [
                    { year: 'desc' },
                    { month: 'desc' },
                  ],
                  take: 2,
                },
              },
            },
          },
        });
        if (!analytics) continue;

        let improvedKeywords = 0;
        let totalKeywords = 0;

        // Process each keyword in the campaign
        for (const keyword of analytics.keywords) {
          totalKeywords++;

          // Get positions from last 2 months
          const currentMonthStat = keyword.monthlyStats[0];
          const previousMonthStat = keyword.monthlyStats[1];

          if (currentMonthStat && previousMonthStat) {
            const currentPosition = currentMonthStat.averageRank;
            const previousPosition = previousMonthStat.averageRank;

            // Check if keyword has improved (lower position number is better)
            if (currentPosition > 0 && previousPosition > 0 && currentPosition < previousPosition) {
              improvedKeywords++;
            }
          }
        }

        // Calculate performance score for this campaign
        const campaignScore = totalKeywords > 0 
          ? (improvedKeywords / totalKeywords) * 100 
          : 0;

        if (campaignScore > bestScore) {
          bestScore = campaignScore;
        }
      }

      return { score: parseFloat(bestScore.toFixed(2)) };
    } catch (error) {
      console.error('Error in getTopPerformingCampaign:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to calculate top performing campaign',
      });
    }
  }),

  // Get top performing score for all campaigns
  // Top Performance Score = (Improved Keywords ÷ Total Keywords) × 100
  getTopPerformingScore: protectedProcedure.query(async ({ ctx }) => {
    try {
      // For regular users, get their own campaigns
      // For admins, get all campaigns
      const whereClause = ctx.user.role === 'ADMIN' 
        ? {} 
        : { userId: ctx.user.id };

      const campaigns = await prisma.campaign.findMany({
        where: whereClause,
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

      if (campaigns.length === 0) {
        return 0;
      }

      let improvedKeywords = 0;
      let totalKeywords = 0;

      // Process each campaign
      for (const campaign of campaigns) {
        // Get analytics data for this campaign
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

        if (!analytics) continue;

        // Process each keyword in the campaign
        for (const keyword of analytics.keywords) {
          totalKeywords++;

          // Get initial position and latest position
          const initialPosition = keyword.initialPosition;
          
          // Get the most recent daily stat for this keyword
          const latestStat = keyword.dailyStats.length > 0 
            ? keyword.dailyStats[keyword.dailyStats.length - 1] 
            : null;
          
          const latestPosition = latestStat?.averageRank;

          // Check if keyword has improved (lower position number is better)
          if (
            initialPosition > 0 && 
            latestPosition != null && latestPosition > 0 && latestPosition < initialPosition
          ) {
            improvedKeywords++;
          }
        }
      }

      // Calculate top performing score
      const topPerformingScore = totalKeywords > 0 
        ? (improvedKeywords / totalKeywords) * 100 
        : 0;

      return parseFloat(topPerformingScore.toFixed(2));
    } catch (error) {
      console.error('Error in getTopPerformingScore:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to calculate top performing score',
      });
    }
  }),

  // Get current month traffic data grouped by periods
  getCurrentMonthTrafficData: protectedProcedure
    .input(
      z.object({
        campaignId: z.string(),
        month: z.string().optional(), // Format: "Oct 24" or "Aug 24"
      })
    )
    .query(async ({ input, ctx }) => {
    try {
      const { campaignId } = input;

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

      // Parse the selected month if provided, otherwise use current month
      let targetMonth: number;
      let targetYear: number;
      
      if (input.month) {
        // Parse month string like "Oct 24" or "Aug 24"
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const [monthStr, yearStr] = input.month.split(' ');
        const monthIndex = monthNames.indexOf(monthStr);
        if (monthIndex !== -1) {
          targetMonth = monthIndex + 1; // 1-based
          targetYear = 2000 + parseInt(yearStr); // Convert "24" to 2024
        } else {
          // Fallback to current month if parsing fails
          const currentDate = new Date();
          targetMonth = currentDate.getMonth() + 1;
          targetYear = currentDate.getFullYear();
        }
      } else {
        const currentDate = new Date();
        targetMonth = currentDate.getMonth() + 1;
        targetYear = currentDate.getFullYear();
      }

      const currentMonth = targetMonth;
      const currentYear = targetYear;

      // Get previous month
      const prevDate = new Date(currentYear, currentMonth - 2, 1);
      const prevMonth = prevDate.getMonth() + 1;
      const prevYear = prevDate.getFullYear();

      let currentMonthClicks = 0;
      let prevMonthClicks = 0;

      // Get current month data grouped by day
      const currentMonthData = await prisma.searchConsoleTrafficDaily.findMany({
        where: {
          analytics: {
            siteUrl: campaign.searchConsoleSite
          },
          date: {
            gte: new Date(currentYear, currentMonth - 1, 1),
            lt: new Date(currentYear, currentMonth, 1),
          },
        },
        orderBy: { date: 'asc' },
      });

      // Get previous month data for comparison
      const prevMonthData = await prisma.searchConsoleTrafficDaily.findMany({
        where: {
          analytics: {
            siteUrl: campaign.searchConsoleSite
          },
          date: {
            gte: new Date(prevYear, prevMonth - 1, 1),
            lt: new Date(prevYear, prevMonth, 1),
          },
        },
      });

      // Calculate total clicks for comparison
      currentMonthClicks = currentMonthData.reduce((sum, day) => sum + day.clicks, 0);
      prevMonthClicks = prevMonthData.reduce((sum, day) => sum + day.clicks, 0);

      // Group current month data by 4-day periods
      const periods = [];
      const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

      for (let startDay = 1; startDay <= daysInMonth; startDay += 4) {
        const endDay = Math.min(startDay + 3, daysInMonth);
        const periodClicks = currentMonthData
          .filter(day => {
            const dayOfMonth = day.date.getDate();
            return dayOfMonth >= startDay && dayOfMonth <= endDay;
          })
          .reduce((sum, day) => sum + day.clicks, 0);

        periods.push({
          period: `${startDay}-${endDay}`,
          clicks: periodClicks,
        });
      }

      // Calculate percentage change
      const percentageChange = prevMonthClicks > 0 
        ? parseFloat((((currentMonthClicks - prevMonthClicks) / prevMonthClicks) * 100).toFixed(1))
        : 0;

      return {
        periods,
        percentageChange,
      };
    } catch (error) {
      console.error('Error in getCurrentMonthTrafficData:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch current month traffic data',
      });
    }
  }),

  // Get top keywords for the current month
  getTopKeywordsThisMonth: protectedProcedure
    .input(
      z.object({
        campaignId: z.string(),
        limit: z.number().min(1).max(50).default(10),
        month: z.string().optional(), // Format: "Oct 24" or "Aug 24"
      })
    )
    .query(async ({ input, ctx }) => {
    try {
      const { campaignId, limit } = input;

      // Get the campaign with Google account
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
          googleAccount: true,
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

      // Parse the selected month if provided, otherwise use current month
      let targetMonth: number;
      let targetYear: number;
      
      if (input.month) {
        // Parse month string like "Oct 24" or "Aug 24"
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const [monthStr, yearStr] = input.month.split(' ');
        const monthIndex = monthNames.indexOf(monthStr);
        if (monthIndex !== -1) {
          targetMonth = monthIndex + 1; // 1-based for database
          targetYear = 2000 + parseInt(yearStr); // Convert "24" to 2024
        } else {
          // Fallback to current month if parsing fails
          const currentDate = new Date();
          targetMonth = currentDate.getMonth() + 1;
          targetYear = currentDate.getFullYear();
        }
      } else {
        const currentDate = new Date();
        targetMonth = currentDate.getMonth() + 1;
        targetYear = currentDate.getFullYear();
      }

      // Fetch from database
      let topKeywords = await prisma.topKeywordData.findMany({
        where: {
          campaignId,
          month: targetMonth,
          year: targetYear,
        },
        orderBy: {
          clicks: 'desc',
        },
        take: limit,
      });

      // If no data exists in DB, fetch from GSC and store it
      if (topKeywords.length === 0 && campaign.googleAccount) {
        console.log(`📊 No top keywords data found for campaign ${campaign.name}, fetching from GSC...`);
        
        try {
          // Calculate date range for target month
          const startDate = moment.utc([targetYear, targetMonth - 1, 1]); // moment months are 0-based
          const endDate = moment.utc([targetYear, targetMonth - 1, 1]).endOf('month');

          // Fetch current month data from GSC
          const currentMonthData = await searchConsoleService.getAnalytics({
            campaign,
            googleAccount: campaign.googleAccount,
            startAt: startDate,
            endAt: endDate,
            dimensions: ['query'],
          });

          if (currentMonthData && currentMonthData.length > 0) {
            // Fetch previous month data for comparison
            const prevStartDate = moment.utc([targetYear, targetMonth - 1, 1]).subtract(1, 'month');
            const prevEndDate = moment.utc([targetYear, targetMonth - 1, 1]).subtract(1, 'month').endOf('month');

            const previousMonthData = await searchConsoleService.getAnalytics({
              campaign,
              googleAccount: campaign.googleAccount,
              startAt: prevStartDate,
              endAt: prevEndDate,
              dimensions: ['query'],
            });

            // Create a map of previous month data
            // Note: GSC service automatically adds 'date' dimension, so keys are [date, query]
            const prevMonthMap = new Map<string, { position: number }>();
            if (previousMonthData) {
              previousMonthData.forEach(row => {
                // keys[0] is date, keys[1] is query (keyword)
                const keyword = row.keys?.[1];
                if (keyword && row.position) {
                  prevMonthMap.set(keyword, { position: row.position });
                }
              });
            }

            // Process and store top 50 keywords
            // Note: GSC service automatically adds 'date' dimension, so keys are [date, query]
            const keywordsToStore = currentMonthData
              .map(row => {
                // keys[0] is date, keys[1] is query (keyword)
                const keyword = row.keys?.[1];
                if (!keyword) return null;

                const currentPosition = row.position || 0;
                const previousPosition = prevMonthMap.get(keyword)?.position || 0;

                let rankChange = 0;
                let rankChangeDirection: 'up' | 'down' | 'same' = 'same';

                if (previousPosition > 0 && currentPosition > 0) {
                  rankChange = previousPosition - currentPosition;
                  if (rankChange > 0) rankChangeDirection = 'up';
                  else if (rankChange < 0) rankChangeDirection = 'down';
                }

                return {
                  keyword,
                  averageRank: currentPosition,
                  clicks: row.clicks || 0,
                  impressions: row.impressions || 0,
                  rankChange: Math.abs(rankChange),
                  rankChangeDirection,
                };
              })
              .filter((k): k is NonNullable<typeof k> => k !== null)
              .sort((a, b) => b.clicks - a.clicks)
              .slice(0, 50); // Store top 50

            // Store keywords in database
            for (const kw of keywordsToStore) {
              await prisma.topKeywordData.upsert({
                where: {
                  campaignId_keyword_month_year: {
                    campaignId: campaign.id,
                    keyword: kw.keyword,
                    month: targetMonth,
                    year: targetYear,
                  },
                },
                update: {
                  averageRank: kw.averageRank,
                  clicks: kw.clicks,
                  impressions: kw.impressions,
                  rankChange: kw.rankChange,
                  rankChangeDirection: kw.rankChangeDirection,
                  fetchedAt: new Date(),
                },
                create: {
                  campaignId: campaign.id,
                  keyword: kw.keyword,
                  month: targetMonth,
                  year: targetYear,
                  averageRank: kw.averageRank,
                  clicks: kw.clicks,
                  impressions: kw.impressions,
                  rankChange: kw.rankChange,
                  rankChangeDirection: kw.rankChangeDirection,
                },
              });
            }

            console.log(`✅ Stored ${keywordsToStore.length} top keywords for campaign ${campaign.name}`);
            
            // Fetch the newly stored data
            topKeywords = await prisma.topKeywordData.findMany({
              where: {
                campaignId,
                month: targetMonth,
                year: targetYear,
              },
              orderBy: {
                clicks: 'desc',
              },
              take: limit,
            });
          } else {
            console.log(`ℹ️  No GSC data available for campaign ${campaign.name} for ${targetMonth}/${targetYear}`);
          }
        } catch (gscError) {
          console.error(`❌ Error fetching from GSC for campaign ${campaign.name}:`, gscError);
          // Continue with empty data rather than throwing error
        }
      }

      // Format the response
      const keywords = topKeywords.map(kw => ({
        keyword: kw.keyword,
        averageRank: kw.averageRank,
        clicks: kw.clicks,
        impressions: kw.impressions,
        rankChange: kw.rankChange,
        rankChangeDirection: kw.rankChangeDirection as 'up' | 'down' | 'same',
      }));

      return { keywords };
    } catch (error) {
      console.error('Error in getTopKeywordsThisMonth:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch top keywords for this month',
      });
    }
  }),

  // Get keyword movement stats for a campaign
  getKeywordMovementStats: protectedProcedure
    .input(
      z.object({
        campaignId: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
    try {
      const { campaignId } = input;

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

      const currentDate = new Date();
      const currentMonth = currentDate.getMonth() + 1; // 1-based
      const currentYear = currentDate.getFullYear();

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

        const currentClicks = trafficAnalytics?.daily.reduce(
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
});