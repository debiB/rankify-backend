import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { adminProcedure, router } from '../context';
import { prisma } from '../../utils/prisma';
import { CronService } from '../../services/cronService';
import { AnalyticsService } from '../../services/analytics';
import { comparePassword } from '../../utils/auth';
import { sendTestEmail } from '../../utils/email';

export const adminRouter = router({
  // Delete all search console analytics data
  deleteAllSearchData: adminProcedure
    .input(
      z.object({
        password: z.string().min(1, 'Password is required'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // Verify admin password
        const admin = await prisma.user.findUnique({
          where: { id: ctx.user.id },
          select: { password: true },
        });

        if (!admin) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Admin user not found',
          });
        }

        const isValidPassword = await comparePassword(
          input.password,
          admin.password
        );
        if (!isValidPassword) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Invalid password',
          });
        }

        // Delete all search console related data in the correct order
        // to avoid foreign key constraint violations

        console.log('Starting deletion of all search data...');

        // 1. Delete all keyword monthly stats first (they reference keywords)
        const deletedKeywordMonthlyStats =
          await prisma.searchConsoleKeywordMonthlyStat.deleteMany({});
        console.log(
          `Deleted ${deletedKeywordMonthlyStats.count} keyword monthly stats`
        );

        // 2. Delete all keywords (they reference analytics)
        const deletedKeywords = await prisma.searchConsoleKeyword.deleteMany(
          {}
        );
        console.log(`Deleted ${deletedKeywords.count} keywords`);

        // 3. Delete all keyword analytics records
        const deletedKeywordAnalytics =
          await prisma.searchConsoleKeywordAnalytics.deleteMany({});
        console.log(
          `Deleted ${deletedKeywordAnalytics.count} keyword analytics records`
        );

        // 4. Delete all traffic daily data first (they reference traffic analytics)
        const deletedTrafficDaily =
          await prisma.searchConsoleTrafficDaily.deleteMany({});
        console.log(
          `Deleted ${deletedTrafficDaily.count} traffic daily records`
        );

        // 5. Delete all traffic monthly data (they reference traffic analytics)
        const deletedTrafficMonthly =
          await prisma.searchConsoleTrafficMonthly.deleteMany({});
        console.log(
          `Deleted ${deletedTrafficMonthly.count} traffic monthly records`
        );

        // 6. Delete all traffic analytics records
        const deletedTrafficAnalytics =
          await prisma.searchConsoleTrafficAnalytics.deleteMany({});
        console.log(
          `Deleted ${deletedTrafficAnalytics.count} traffic analytics records`
        );

        const totalDeleted =
          deletedKeywordMonthlyStats.count +
          deletedKeywords.count +
          deletedKeywordAnalytics.count +
          deletedTrafficDaily.count +
          deletedTrafficMonthly.count +
          deletedTrafficAnalytics.count;

        console.log(`Successfully deleted ${totalDeleted} total records`);

        return {
          success: true,
          deletedRecords: {
            keywordMonthlyStats: deletedKeywordMonthlyStats.count,
            keywords: deletedKeywords.count,
            keywordAnalytics: deletedKeywordAnalytics.count,
            trafficDaily: deletedTrafficDaily.count,
            trafficMonthly: deletedTrafficMonthly.count,
            trafficAnalytics: deletedTrafficAnalytics.count,
            total: totalDeleted,
          },
        };
      } catch (error) {
        console.error('Error deleting all search data:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete search data',
        });
      }
    }),

  // Get system statistics
  getSystemStats: adminProcedure.query(async () => {
    try {
      const [
        totalAnalytics,
        totalKeywords,
        totalMonthlyStats,
        totalCampaigns,
        totalUsers,
      ] = await Promise.all([
        prisma.searchConsoleKeywordAnalytics.count(),
        prisma.searchConsoleKeyword.count(),
        prisma.searchConsoleKeywordMonthlyStat.count(),
        prisma.campaign.count(),
        prisma.user.count(),
      ]);

      return {
        analytics: totalAnalytics,
        keywords: totalKeywords,
        monthlyStats: totalMonthlyStats,
        campaigns: totalCampaigns,
        users: totalUsers,
      };
    } catch (error) {
      console.error('Error getting system stats:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get system statistics',
      });
    }
  }),

  // Manually trigger monthly analytics job
  triggerMonthlyAnalytics: adminProcedure.mutation(async () => {
    try {
      console.log('Admin triggered monthly analytics job...');
      const cronService = CronService.getInstance();
      await cronService.triggerMonthlyAnalytics();

      return {
        success: true,
        message: 'Monthly analytics job triggered successfully',
      };
    } catch (error) {
      console.error('Error triggering monthly analytics job:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to trigger monthly analytics job',
      });
    }
  }),

  // Get all data for all campaigns
  getAllData: adminProcedure.mutation(async () => {
    try {
      console.log('Admin triggered get all data for all campaigns...');

      // Get all campaigns
      const campaigns = await prisma.campaign.findMany({
        where: { status: 'ACTIVE' },
        include: {
          googleAccount: true,
        },
      });

      console.log(`Found ${campaigns.length} active campaigns`);

      const analyticsService = new AnalyticsService();

      // Process campaigns concurrently with controlled concurrency
      const concurrencyLimit = 3; // Limit concurrent requests to avoid overwhelming Google Search Console API
      const results: Array<{
        campaignId: string;
        campaignName: string;
        siteTraffic?: boolean;
        keywordData?: boolean;
        monthlyTraffic?: boolean;
        error?: string;
      }> = [];

      // Process campaigns in batches to control concurrency
      for (let i = 0; i < campaigns.length; i += concurrencyLimit) {
        const batch = campaigns.slice(i, i + concurrencyLimit);

        const batchResults = await Promise.allSettled(
          batch.map(async (campaign) => {
            try {
              console.log(`Processing campaign: ${campaign.name}`);

              // Fetch daily site traffic data
              const siteTrafficSuccess =
                await analyticsService.fetchDailySiteTraffic({
                  campaignId: campaign.id,
                  waitForAllData: true,
                });

              // Fetch daily keyword data
              const keywordDataSuccess =
                await analyticsService.fetchDailyKeywordData({
                  campaignId: campaign.id,
                  waitForAllData: true,
                });

              // Fetch monthly traffic data
              const monthlyTrafficSuccess =
                await analyticsService.fetchAndSaveMonthlyTrafficData({
                  campaignId: campaign.id,
                  waitForAllData: true,
                });

              console.log(`Completed processing campaign: ${campaign.name}`);

              return {
                campaignId: campaign.id,
                campaignName: campaign.name,
                siteTraffic: siteTrafficSuccess,
                keywordData: keywordDataSuccess,
                monthlyTraffic: monthlyTrafficSuccess,
              };
            } catch (error) {
              console.error(
                `Error processing campaign ${campaign.name}:`,
                error
              );
              return {
                campaignId: campaign.id,
                campaignName: campaign.name,
                error: error instanceof Error ? error.message : 'Unknown error',
              };
            }
          })
        );

        // Process batch results
        batchResults.forEach((result) => {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            console.error(
              'Unexpected error in batch processing:',
              result.reason
            );
            results.push({
              campaignId: 'unknown',
              campaignName: 'unknown',
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : 'Unknown error',
            });
          }
        });

        // Add a small delay between batches to be respectful to the API
        if (i + concurrencyLimit < campaigns.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      const successfulCampaigns = results.filter((r) => !r.error).length;
      const failedCampaigns = results.filter((r) => r.error).length;

      return {
        success: true,
        message: `Data fetch completed. ${successfulCampaigns} campaigns successful, ${failedCampaigns} failed.`,
        results,
        summary: {
          totalCampaigns: campaigns.length,
          successful: successfulCampaigns,
          failed: failedCampaigns,
        },
      };
    } catch (error) {
      console.error('Error getting all data:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get all data',
      });
    }
  }),

  // Get cron job status
  getCronStatus: adminProcedure.query(async () => {
    try {
      const cronService = CronService.getInstance();
      return cronService.getCronStatus();
    } catch (error) {
      console.error('Error getting cron status:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get cron status',
      });
    }
  }),

  // Send test email
  sendTestEmail: adminProcedure
    .input(
      z.object({
        email: z.string().email('Invalid email address'),
      })
    )
    .mutation(async ({ input }) => {
      try {
        // Send test email using the dedicated test email function
        const result = await sendTestEmail(input.email);

        return {
          success: true,
          message: 'Test email sent successfully',
          messageId: result.messageId,
        };
      } catch (error) {
        console.error('Error sending test email:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to send test email',
        });
      }
    }),
});
