import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, adminProcedure, router } from '../context';
import { prisma } from '../../utils/prisma';
import { AnalyticsService } from '../../services/analytics';

const analyticsService = new AnalyticsService();

// Helper function to handle keyword changes
async function handleKeywordChanges(
  oldCampaign: any,
  newCampaign: any
): Promise<void> {
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
      return;
    }

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
      // Trigger analytics fetch for the new keywords
      analyticsService.fetchAndSaveAnalytics({
        campaignId: newCampaign.id,
        waitForAllData: false,
      });

      // Also fetch historical daily data for the new keywords
      analyticsService.fetchAndSaveHistoricalDailyData({
        campaignId: newCampaign.id,
        waitForAllData: false,
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
});

export const campaignsRouter = router({
  // Create a new campaign
  createCampaign: adminProcedure
    .input(createCampaignSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        // Verify the user exists
        const user = await prisma.user.findUnique({
          where: { id: input.userId },
        });

        if (!user) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'User not found',
          });
        }

        // Verify the Google account exists
        const googleAccount = await prisma.googleAccount.findUnique({
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

        // Fetch the analytics (without waiting)
        analyticsService.fetchAndSaveAnalytics({
          campaignId: campaign.id,
          waitForAllData: false,
        });

        // Also fetch historical daily data (without waiting)
        analyticsService.fetchAndSaveHistoricalDailyData({
          campaignId: campaign.id,
          waitForAllData: false,
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
        const campaign = await prisma.campaign.findUnique({
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
        const existingCampaign = await prisma.campaign.findUnique({
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

        // Update the campaign
        const campaign = await prisma.campaign.update({
          where: { id },
          data: updateData,
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

        // Handle keyword changes
        if (isKeywordsChanged) {
          await handleKeywordChanges(existingCampaign, campaign);
        }

        // Trigger analytics fetch if starting date changed
        if (isStartingDateChanged) {
          analyticsService.fetchAndSaveAnalytics({
            campaignId: campaign.id,
            waitForAllData: false,
          });

          // Also fetch historical daily data
          analyticsService.fetchAndSaveHistoricalDailyData({
            campaignId: campaign.id,
            waitForAllData: false,
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
        const existingCampaign = await prisma.campaign.findUnique({
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
        const existingCampaign = await prisma.campaign.findUnique({
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
  getCampaignAnalytics: protectedProcedure
    .input(
      z.object({
        campaignId: z.string(),
        selectedMonth: z.string().optional(), // Add selected month parameter
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        // Get the campaign
        const campaign = await prisma.campaign.findUnique({
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

        // Get analytics data
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

        if (!analytics) {
          return {
            keywords: [],
            months: [],
          };
        }

        // Process the data for the frontend
        const keywords = analytics.keywords.map((keyword) => {
          try {
            const monthlyData: Record<string, number | null> = {};
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
              // Exclude current month due to 3-day delay in Google Search Console
              const endMonth = year === currentYear ? currentMonth - 1 : 12;

              for (let month = startMonth; month <= endMonth; month++) {
                const monthKey = `${month}/${year}`;
                monthlyData[monthKey] = null;
              }
            }

            // Fill in actual data
            if (keyword.monthlyStats && Array.isArray(keyword.monthlyStats)) {
              keyword.monthlyStats.forEach((stat) => {
                if (
                  stat &&
                  typeof stat.month === 'number' &&
                  typeof stat.year === 'number'
                ) {
                  const monthKey = `${stat.month}/${stat.year}`;
                  monthlyData[monthKey] = stat.averageRank || null;
                }
              });
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

              selectedMonthStat = keyword.monthlyStats?.find(
                (stat) =>
                  stat.month === selectedMonthNum &&
                  stat.year === parseInt(selectedYear)
              );
            }

            // Calculate changes
            const stats = keyword.monthlyStats || [];
            const latestStat =
              stats.length > 0 ? stats[stats.length - 1] : null;

            // Use selected month stat if available, otherwise use latest
            const currentStat = selectedMonthStat || latestStat;

            // Find the previous month stat for the selected month
            let previousMonthStat = null;
            if (selectedMonthStat) {
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

              previousMonthStat = keyword.monthlyStats?.find(
                (stat) => stat.month === prevMonth && stat.year === prevYear
              );
            } else {
              // Fallback to the second-to-last stat
              previousMonthStat =
                stats.length > 1 ? stats[stats.length - 2] : null;
            }

            const monthlyChange =
              previousMonthStat && currentStat
                ? (previousMonthStat.averageRank || 0) -
                  (currentStat.averageRank || 0)
                : 0;

            const overallChange = currentStat
              ? (keyword.initialPosition || 0) - (currentStat.averageRank || 0)
              : 0;

            return {
              id: keyword.id,
              keyword: keyword.keyword,
              initialRank: keyword.initialPosition || 0,
              monthlyData,
              monthlyChange,
              overallChange,
              position: currentStat?.averageRank || 0,
              searchVolume: currentStat?.searchVolume || 0,
              topPageLink: (() => {
                try {
                  const url = currentStat?.topRankingPageUrl || '';
                  return url ? decodeURIComponent(url) : '';
                } catch (error) {
                  console.error('Error decoding URL:', error);
                  return currentStat?.topRankingPageUrl || '';
                }
              })(),
            };
          } catch (error) {
            console.error('Error processing keyword:', keyword.keyword, error);
            // Return a default structure for this keyword
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
            };
          }
        });

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

        return {
          keywords,
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

  // Get traffic data for a campaign
  getCampaignTrafficData: protectedProcedure
    .input(
      z.object({
        campaignId: z.string().min(1, 'Campaign ID is required'),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        // Get the campaign
        const campaign = await prisma.campaign.findUnique({
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

        const monthNames = [
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
          const monthName = monthNames[date.getMonth()];
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

          last12Months.push({
            month: monthKey,
            clicks: monthData?.clicks || 0,
            impressions: monthData?.impressions || 0,
            ctr: monthData?.ctr || 0,
            position: monthData?.position || 0,
          });
        }

        const monthlyData = last12Months;

        // Format daily data for charts (current month only)
        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();

        const dailyData = trafficAnalytics.daily
          .filter((day) => {
            const date = new Date(day.date);
            return (
              date.getMonth() === currentMonth &&
              date.getFullYear() === currentYear
            );
          })
          .map((day) => {
            const date = new Date(day.date);
            const dayOfMonth = date.getDate();
            const monthNames = [
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
            const monthName = monthNames[date.getMonth()];

            return {
              date: `${dayOfMonth} ${monthName}`,
              clicks: day.clicks,
              impressions: day.impressions,
              ctr: day.ctr,
              position: day.position,
            };
          })
          .sort((a, b) => {
            // Sort by day of month
            const dayA = parseInt(a.date.split(' ')[0]);
            const dayB = parseInt(b.date.split(' ')[0]);
            return dayA - dayB;
          });

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
              overallPerformance: { google: 0, mobile: 0 },
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
          let totalKeywords = 0;

          // Calculate changes for each keyword
          for (const keyword of analytics.keywords) {
            const currentMonthStat = keyword.monthlyStats.find(
              (stat) => stat.month === currentMonth && stat.year === currentYear
            );
            const prevMonthStat = keyword.monthlyStats.find(
              (stat) => stat.month === prevMonth && stat.year === prevYear
            );

            // Get daily stats for weekly calculation
            const currentWeekStats = keyword.dailyStats.filter(
              (stat) => new Date(stat.date) >= oneWeekAgo
            );
            const previousWeekStats = keyword.dailyStats.filter((stat) => {
              const statDate = new Date(stat.date);
              return statDate >= twoWeeksAgo && statDate < oneWeekAgo;
            });

            // Calculate monthly change using only monthly data - compare 2 last available months
            let hasMonthlyData = false;
            if (keyword.monthlyStats.length >= 2) {
              // Get the 2 most recent months
              const sortedMonthlyStats = keyword.monthlyStats
                .sort((a, b) => {
                  if (a.year !== b.year) return b.year - a.year;
                  return b.month - a.month;
                })
                .slice(0, 2);

              const mostRecentMonth = sortedMonthlyStats[0];
              const secondMostRecentMonth = sortedMonthlyStats[1];

              hasMonthlyData = true;
              totalKeywords++;
              const monthlyChange = Math.floor(
                secondMostRecentMonth.averageRank - mostRecentMonth.averageRank
              );

              if (monthlyChange > 0) {
                monthlyUp++; // Improved position (lower number is better)
              } else if (monthlyChange < 0) {
                monthlyDown++; // Worse position (higher number is worse)
              } else {
                monthlyNeutral++; // No change
              }
            }

            // Calculate weekly change using daily data ONLY
            if (currentWeekStats.length > 0 && previousWeekStats.length > 0) {
              // Only count for weekly if we have daily data (regardless of monthly data)
              if (!hasMonthlyData) {
                totalKeywords++; // Count for weekly calculation even if no monthly data
              }

              // Calculate average rank for current week
              const currentWeekAvg =
                currentWeekStats.reduce(
                  (sum, stat) => sum + stat.averageRank,
                  0
                ) / currentWeekStats.length;

              // Calculate average rank for previous week
              const previousWeekAvg =
                previousWeekStats.reduce(
                  (sum, stat) => sum + stat.averageRank,
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
            }
          }

          // Calculate percentages
          const weeklyPercentage =
            totalKeywords > 0
              ? Math.floor((weeklyUp / totalKeywords) * 100)
              : 0;
          const monthlyPercentage =
            totalKeywords > 0
              ? Math.floor((monthlyUp / totalKeywords) * 100)
              : 0;

          // Calculate overall performance (using current month data)
          let overallGoogle = 0;
          let overallMobile = 0;

          if (totalKeywords > 0) {
            // For now, we'll use the same percentage for both Google and Mobile
            // In a real implementation, you might have separate mobile data
            overallGoogle = monthlyPercentage;
            overallMobile = monthlyPercentage;
          }

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
            overallPerformance: {
              google: overallGoogle,
              mobile: overallMobile,
            },
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
});
