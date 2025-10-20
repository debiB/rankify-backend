import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { adminProcedure, protectedProcedure, router } from '../trpc-context';
import { prisma } from '../../utils/prisma';
import { CronService } from '../../services/cronService';
import { AnalyticsService } from '../../services/analytics';
import { comparePassword } from '../../utils/auth';
import { sendTestEmail } from '../../utils/email';
import { NotificationTemplateService } from '../../services/notificationTemplateService';

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
          `Deleted ${deletedKeywordMonthlyStats.count} monthly keyword stat records`
        );

        // 2. Delete all keyword daily stats (they reference keywords)
        const deletedKeywordDailyStats =
          await prisma.searchConsoleKeywordDailyStat.deleteMany({});
        console.log(
          `Deleted ${deletedKeywordDailyStats.count} keyword daily stats`
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
        skipped?: {
          siteTraffic: boolean;
          keywordData: boolean;
          monthlyTraffic: boolean;
        };
        existingRecords?: {
          siteTraffic: number;
          keywordData: number;
          monthlyTraffic: number;
        };
        error?: string;
      }> = [];

      // Process campaigns in batches to control concurrency
      for (let i = 0; i < campaigns.length; i += concurrencyLimit) {
        const batch = campaigns.slice(i, i + concurrencyLimit);

        const batchResults = await Promise.allSettled(
          batch.map(async (campaign) => {
            try {
              console.log(`Processing campaign: ${campaign.name}`);

              // Check what data already exists
              const dataStatus = await analyticsService.checkCampaignDataStatus(
                campaign.id
              );

              console.log(`Data status for ${campaign.name}:`, {
                siteTraffic: dataStatus.siteTrafficRecords,
                keywords: dataStatus.keywordRecords,
                monthlyTraffic: dataStatus.monthlyTrafficRecords,
              });

              let siteTrafficSuccess = true;
              let keywordDataSuccess = true;
              let monthlyTrafficSuccess = true;

              // Only fetch data that doesn't exist or is incomplete
              if (
                !dataStatus.hasSiteTrafficData ||
                dataStatus.siteTrafficRecords < 10
              ) {
                console.log(
                  `Fetching site traffic data for ${campaign.name}...`
                );
                siteTrafficSuccess =
                  await analyticsService.fetchDailySiteTraffic({
                    campaignId: campaign.id,
                    waitForAllData: true,
                  });
              } else {
                console.log(
                  `Skipping site traffic fetch for ${campaign.name} - data already exists (${dataStatus.siteTrafficRecords} records)`
                );
              }

              if (
                !dataStatus.hasKeywordData ||
                dataStatus.keywordRecords < 10
              ) {
                console.log(`Fetching keyword data for ${campaign.name}...`);
                keywordDataSuccess =
                  await analyticsService.fetchDailyKeywordData({
                    campaignId: campaign.id,
                    waitForAllData: true,
                  });
              } else {
                console.log(
                  `Skipping keyword data fetch for ${campaign.name} - data already exists (${dataStatus.keywordRecords} records)`
                );
              }

              if (
                !dataStatus.hasMonthlyTrafficData ||
                dataStatus.monthlyTrafficRecords < 3
              ) {
                console.log(
                  `Fetching monthly traffic data for ${campaign.name}...`
                );
                monthlyTrafficSuccess =
                  await analyticsService.fetchAndSaveMonthlyTrafficData({
                    campaignId: campaign.id,
                    waitForAllData: true,
                  });
              } else {
                console.log(
                  `Skipping monthly traffic fetch for ${campaign.name} - data already exists (${dataStatus.monthlyTrafficRecords} records)`
                );
              }

              console.log(`Completed processing campaign: ${campaign.name}`);

              return {
                campaignId: campaign.id,
                campaignName: campaign.name,
                siteTraffic: siteTrafficSuccess,
                keywordData: keywordDataSuccess,
                monthlyTraffic: monthlyTrafficSuccess,
                skipped: {
                  siteTraffic:
                    dataStatus.hasSiteTrafficData &&
                    dataStatus.siteTrafficRecords >= 10,
                  keywordData:
                    dataStatus.hasKeywordData &&
                    dataStatus.keywordRecords >= 10,
                  monthlyTraffic:
                    dataStatus.hasMonthlyTrafficData &&
                    dataStatus.monthlyTrafficRecords >= 3,
                },
                existingRecords: {
                  siteTraffic: dataStatus.siteTrafficRecords,
                  keywordData: dataStatus.keywordRecords,
                  monthlyTraffic: dataStatus.monthlyTrafficRecords,
                },
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

      // Calculate skipped operations
      const totalSkipped = results.reduce(
        (acc, r) => {
          if (r.skipped) {
            acc.siteTraffic += r.skipped.siteTraffic ? 1 : 0;
            acc.keywordData += r.skipped.keywordData ? 1 : 0;
            acc.monthlyTraffic += r.skipped.monthlyTraffic ? 1 : 0;
          }
          return acc;
        },
        { siteTraffic: 0, keywordData: 0, monthlyTraffic: 0 }
      );

      return {
        success: true,
        message: `Data fetch completed. ${successfulCampaigns} campaigns successful, ${failedCampaigns} failed. Skipped: ${totalSkipped.siteTraffic} site traffic, ${totalSkipped.keywordData} keyword data, ${totalSkipped.monthlyTraffic} monthly traffic operations.`,
        results,
        summary: {
          totalCampaigns: campaigns.length,
          successful: successfulCampaigns,
          failed: failedCampaigns,
          skipped: totalSkipped,
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

  // Get admin notification preferences
  getNotificationPreferences: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input }) => {
      try {
        const { userId } = input;

        // Verify user is admin
        const user = await prisma.user.findUnique({
          where: { id: userId },
        });

        if (!user || user.role !== 'ADMIN') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Access denied. Admin role required.',
          });
        }

        let preferences = await prisma.adminNotificationPreferences.findFirst();

        // Create default preferences if none exist
        if (!preferences) {
          preferences = await prisma.adminNotificationPreferences.create({
            data: {
              id: userId, // Add the required id field
              userId, // Add the required userId field
              enableEmail: true,
              enableWhatsApp: true,
              enableAllNotifications: true,
              positionThresholds: JSON.stringify([1, 2, 3]),
              clickThresholds: JSON.stringify([100]),
              updatedAt: new Date(), // Add the required updatedAt field
            },
          });
        }

        // Parse JSON thresholds
        const response = {
          ...preferences,
          positionThresholds: preferences.positionThresholds 
            ? JSON.parse(preferences.positionThresholds) 
            : [1, 2, 3],
          clickThresholds: preferences.clickThresholds 
            ? JSON.parse(preferences.clickThresholds) 
            : [100],
        };

        return {
          success: true,
          data: response,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        console.error('Error fetching admin preferences:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch admin preferences',
        });
      }
    }),

  // Update admin notification preferences
  updateNotificationPreferences: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        enableEmail: z.boolean().optional(),
        enableWhatsApp: z.boolean().optional(),
        enableAllNotifications: z.boolean().optional(),
        positionThresholds: z.array(z.number()).optional(),
        clickThresholds: z.array(z.number()).optional(), // Changed back to clickThresholds
        whatsAppGroupId: z.string().optional(),
        campaignId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const {
          userId,
          enableEmail,
          enableWhatsApp,
          enableAllNotifications,
          positionThresholds,
          clickThresholds, // Changed back to clickThresholds
          whatsAppGroupId,
          campaignId,
        } = input;

        // Verify user is admin
        const user = await prisma.user.findUnique({
          where: { id: userId },
        });

        if (!user || user.role !== 'ADMIN') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Access denied. Admin role required.',
          });
        }

        const preferences = await prisma.adminNotificationPreferences.upsert({
          where: { userId },
          update: {
            enableEmail: enableEmail ?? true,
            enableWhatsApp: enableWhatsApp ?? true,
            enableAllNotifications: enableAllNotifications ?? true,
            positionThresholds: positionThresholds ? JSON.stringify(positionThresholds) : undefined,
            clickThresholds: clickThresholds ? JSON.stringify(clickThresholds) : undefined,
            whatsAppGroupId: whatsAppGroupId,
            campaignId: campaignId,
          },
          create: {
            id: userId,
            userId,
            enableEmail: enableEmail ?? true,
            enableWhatsApp: enableWhatsApp ?? true,
            enableAllNotifications: enableAllNotifications ?? true,
            positionThresholds: JSON.stringify(positionThresholds || [1, 2, 3]),
            clickThresholds: JSON.stringify(clickThresholds || [100]),
            whatsAppGroupId: whatsAppGroupId,
            campaignId: campaignId,
            updatedAt: new Date(),
          },
        });

        // Parse JSON thresholds for response
        const response = {
          ...preferences,
          positionThresholds: preferences.positionThresholds 
            ? JSON.parse(preferences.positionThresholds) 
            : [1, 2, 3],
          clickThresholds: preferences.clickThresholds 
            ? JSON.parse(preferences.clickThresholds) 
            : [100], // Changed to clickThresholds
        };

        return {
          success: true,
          data: response,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        console.error('Error updating admin preferences:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update admin preferences',
        });
      }
    }),

  // Get notification template preview
  getNotificationTemplatePreview: adminProcedure
    .input(
      z.object({
        campaignName: z.string().optional(),
        milestoneType: z.string().optional(),
        value: z.union([z.number(), z.string()]).optional(),
        keyword: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const template = input.campaignName || input.milestoneType || input.value || input.keyword
          ? NotificationTemplateService.generateMilestoneTemplate(
              input.campaignName,
              input.milestoneType,
              input.value,
              input.keyword,
              new Date()
            )
          : NotificationTemplateService.generateSampleTemplate();

        return {
          success: true,
          data: template,
        };
      } catch (error) {
        console.error('Error generating notification template preview:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to generate notification template preview',
        });
      }
    }),

  // Get admin dashboard statistics
  getAdminStats: adminProcedure.query(async () => {
    try {
      const [
        totalUsers,
        totalAnalyticsRecords,
        totalKeywords,
        totalCampaigns,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.searchConsoleKeywordAnalytics.count(),
        prisma.searchConsoleKeyword.count(),
        prisma.campaign.count(),
      ]);

      return {
        success: true,
        data: {
          totalUsers,
          totalAnalyticsRecords,
          totalKeywords,
          totalCampaigns,
        },
      };
    } catch (error) {
      console.error('Error getting admin statistics:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get admin statistics',
      });
    }
  }),

  // Get dashboard metrics for campaigns
  getDashboardMetrics: adminProcedure
    .input(
      z.object({
        campaignId: z.string().optional(),
        month: z.string().optional(), // Format: "Oct 2025" or "10/2025"
      })
    )
    .query(async ({ input }) => {
      try {
        const { campaignId, month } = input;

        // Parse month parameter
        const parseMonth = (m?: string) => {
          if (!m) {
            const d = new Date();
            return { month: d.getMonth() + 1, year: d.getFullYear() };
          }
          const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const fullMonthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
          const [monthStr, yearStr] = m.split(' ');
          let monthIdx = monthNames.indexOf(monthStr);
          if (monthIdx === -1) monthIdx = fullMonthNames.indexOf(monthStr);
          const yearNum = parseInt(yearStr, 10);
          const year = yearStr.length === 2 ? 2000 + yearNum : yearNum;
          return { 
            month: (monthIdx < 0 ? new Date().getMonth() : monthIdx) + 1, 
            year: Number.isNaN(year) ? new Date().getFullYear() : year 
          };
        };

        const { month: selectedMonth, year: selectedYear } = parseMonth(month);

        // If no campaign ID provided, get metrics for all campaigns
        if (!campaignId) {
          // Get all campaigns
          const campaigns = await prisma.campaign.findMany({
            include: {
              user: true,
            },
          });

          // Calculate metrics across all campaigns
          let totalKeywords = 0;
          let totalImproved = 0;
          let totalDropped = 0;
          let totalRankSum = 0;
          let totalRankCount = 0;

          // Get previous month for comparison
          const prevMonth = selectedMonth === 1 ? 12 : selectedMonth - 1;
          const prevYear = selectedMonth === 1 ? selectedYear - 1 : selectedYear;

          for (const campaign of campaigns) {
            // Get analytics data for this campaign
            const analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
              where: { siteUrl: campaign.searchConsoleSite },
            });

            if (analytics) {
              // Try to get current month keyword data from computed table first
              let currentMonthData = await prisma.searchConsoleKeywordMonthlyComputed.findMany({
                where: {
                  keyword: {
                    analyticsId: analytics.id
                  },
                  month: selectedMonth,
                  year: selectedYear,
                },
              });

              // Fallback to MonthlyStat if MonthlyComputed is empty
              if (currentMonthData.length === 0) {
                const monthlyStats = await prisma.searchConsoleKeywordMonthlyStat.findMany({
                  where: {
                    keyword: {
                      analyticsId: analytics.id
                    },
                    month: selectedMonth,
                    year: selectedYear,
                  },
                  include: {
                    keyword: true,
                  },
                });

                // Transform MonthlyStat to match MonthlyComputed structure
                currentMonthData = monthlyStats.map(stat => ({
                  id: stat.id,
                  keywordId: stat.keywordId,
                  month: stat.month,
                  year: stat.year,
                  averageRank: stat.averageRank,
                  impressions: stat.searchVolume,
                  clicks: 0, // Not available in MonthlyStat
                  topRankingPageUrl: stat.topRankingPageUrl,
                  calcWindowDays: 7,
                  computedAt: stat.createdAt,
                  updatedAt: stat.updatedAt,
                  keyword: stat.keyword,
                }));
              }

              totalKeywords += currentMonthData.length;

              // Get previous month for comparison
              const prevMonth = selectedMonth === 1 ? 12 : selectedMonth - 1;
              const prevYear = selectedMonth === 1 ? selectedYear - 1 : selectedYear;

              // Get previous month data for comparison
              let previousMonthData = await prisma.searchConsoleKeywordMonthlyComputed.findMany({
                where: {
                  keywordId: {
                    in: currentMonthData.map(k => k.keywordId)
                  },
                  month: prevMonth,
                  year: prevYear,
                },
              });

              // Fallback to MonthlyStat for previous month if needed
              if (previousMonthData.length === 0) {
                const prevMonthlyStats = await prisma.searchConsoleKeywordMonthlyStat.findMany({
                  where: {
                    keywordId: {
                      in: currentMonthData.map(k => k.keywordId)
                    },
                    month: prevMonth,
                    year: prevYear,
                  },
                });

                previousMonthData = prevMonthlyStats.map(stat => ({
                  id: stat.id,
                  keywordId: stat.keywordId,
                  month: stat.month,
                  year: stat.year,
                  averageRank: stat.averageRank,
                  impressions: stat.searchVolume,
                  clicks: 0,
                  topRankingPageUrl: stat.topRankingPageUrl,
                  calcWindowDays: 7,
                  computedAt: stat.createdAt,
                  updatedAt: stat.updatedAt,
                  keyword: undefined,
                }));
              }

              // Calculate movement stats
              for (const current of currentMonthData) {
                const previous = previousMonthData.find(p => p.keywordId === current.keywordId);

                if (previous && current.averageRank > 0 && previous.averageRank > 0) {
                  // Lower rank number means better position
                  if (current.averageRank < previous.averageRank) {
                    totalImproved++;
                  } else if (current.averageRank > previous.averageRank) {
                    totalDropped++;
                  }
                }
                
                if (current.averageRank > 0) {
                  totalRankSum += current.averageRank;
                  totalRankCount++;
                }
              }
            }
          }

          const improvedPercentage = totalKeywords > 0 
            ? Math.round((totalImproved / totalKeywords) * 100) 
            : 0;
            
          const droppedPercentage = totalKeywords > 0 
            ? Math.round((totalDropped / totalKeywords) * 100) 
            : 0;
            
          const averageRank = totalRankCount > 0 
            ? parseFloat((totalRankSum / totalRankCount).toFixed(2)) 
            : 0;

          // Calculate previous month's metrics for comparison (2 months ago vs 3 months ago)
          const prevPrevMonth = prevMonth === 1 ? 12 : prevMonth - 1;
          const prevPrevYear = prevMonth === 1 ? prevYear - 1 : prevYear;
          
          let prevMonthImproved = 0;
          let prevMonthDropped = 0;
          let prevMonthTotal = 0;

          for (const campaign of campaigns) {
            const analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
              where: { siteUrl: campaign.searchConsoleSite },
            });

            if (analytics) {
              let prevMonthData = await prisma.searchConsoleKeywordMonthlyComputed.findMany({
                where: {
                  keyword: { analyticsId: analytics.id },
                  month: prevMonth,
                  year: prevYear,
                },
              });

              if (prevMonthData.length === 0) {
                const stats = await prisma.searchConsoleKeywordMonthlyStat.findMany({
                  where: {
                    keyword: { analyticsId: analytics.id },
                    month: prevMonth,
                    year: prevYear,
                  },
                });
                prevMonthData = stats.map(stat => ({
                  id: stat.id,
                  keywordId: stat.keywordId,
                  month: stat.month,
                  year: stat.year,
                  averageRank: stat.averageRank,
                  impressions: stat.searchVolume,
                  clicks: 0,
                  topRankingPageUrl: stat.topRankingPageUrl,
                  calcWindowDays: 7,
                  computedAt: stat.createdAt,
                  updatedAt: stat.updatedAt,
                  keyword: undefined,
                }));
              }

              let prevPrevMonthData = await prisma.searchConsoleKeywordMonthlyComputed.findMany({
                where: {
                  keywordId: { in: prevMonthData.map(k => k.keywordId) },
                  month: prevPrevMonth,
                  year: prevPrevYear,
                },
              });

              if (prevPrevMonthData.length === 0) {
                const stats = await prisma.searchConsoleKeywordMonthlyStat.findMany({
                  where: {
                    keywordId: { in: prevMonthData.map(k => k.keywordId) },
                    month: prevPrevMonth,
                    year: prevPrevYear,
                  },
                });
                prevPrevMonthData = stats.map(stat => ({
                  id: stat.id,
                  keywordId: stat.keywordId,
                  month: stat.month,
                  year: stat.year,
                  averageRank: stat.averageRank,
                  impressions: stat.searchVolume,
                  clicks: 0,
                  topRankingPageUrl: stat.topRankingPageUrl,
                  calcWindowDays: 7,
                  computedAt: stat.createdAt,
                  updatedAt: stat.updatedAt,
                  keyword: undefined,
                }));
              }

              prevMonthTotal += prevMonthData.length;

              for (const current of prevMonthData) {
                const previous = prevPrevMonthData.find(p => p.keywordId === current.keywordId);
                if (previous && current.averageRank > 0 && previous.averageRank > 0) {
                  if (current.averageRank < previous.averageRank) {
                    prevMonthImproved++;
                  } else if (current.averageRank > previous.averageRank) {
                    prevMonthDropped++;
                  }
                }
              }
            }
          }

          const prevMonthImprovedPercentage = prevMonthTotal > 0 
            ? Math.round((prevMonthImproved / prevMonthTotal) * 100) 
            : 0;
          const prevMonthDroppedPercentage = prevMonthTotal > 0 
            ? Math.round((prevMonthDropped / prevMonthTotal) * 100) 
            : 0;

          // Calculate change vs previous month
          const improvedChange = improvedPercentage - prevMonthImprovedPercentage;
          const droppedChange = droppedPercentage - prevMonthDroppedPercentage;

          return {
            success: true,
            data: {
              totalKeywords,
              improvedPercentage,
              droppedPercentage,
              averageRank,
              improvedChange,
              droppedChange,
            },
          };
        } else {
          // Get metrics for specific campaign
          const campaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
          });

          if (!campaign) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: 'Campaign not found',
            });
          }

          // Get analytics data for this campaign
          const analytics = await prisma.searchConsoleKeywordAnalytics.findFirst({
            where: { siteUrl: campaign.searchConsoleSite },
          });

          if (!analytics) {
            return {
              success: true,
              data: {
                totalKeywords: 0,
                improvedPercentage: 0,
                droppedPercentage: 0,
                averageRank: 0,
                improvedChange: 0,
                droppedChange: 0,
              },
            };
          }

          // Try to get current month keyword data from computed table first
          let currentMonthData = await prisma.searchConsoleKeywordMonthlyComputed.findMany({
            where: {
              keyword: {
                analyticsId: analytics.id
              },
              month: selectedMonth,
              year: selectedYear,
            },
          });

          // Fallback to MonthlyStat if MonthlyComputed is empty
          if (currentMonthData.length === 0) {
            const monthlyStats = await prisma.searchConsoleKeywordMonthlyStat.findMany({
              where: {
                keyword: {
                  analyticsId: analytics.id
                },
                month: selectedMonth,
                year: selectedYear,
              },
              include: {
                keyword: true,
              },
            });

            // Transform MonthlyStat to match MonthlyComputed structure
            currentMonthData = monthlyStats.map(stat => ({
              id: stat.id,
              keywordId: stat.keywordId,
              month: stat.month,
              year: stat.year,
              averageRank: stat.averageRank,
              impressions: stat.searchVolume,
              clicks: 0, // Not available in MonthlyStat
              topRankingPageUrl: stat.topRankingPageUrl,
              calcWindowDays: 7,
              computedAt: stat.createdAt,
              updatedAt: stat.updatedAt,
              keyword: stat.keyword,
            }));
          }

          const totalKeywords = currentMonthData.length;

          // Get previous month for comparison
          const prevMonth = selectedMonth === 1 ? 12 : selectedMonth - 1;
          const prevYear = selectedMonth === 1 ? selectedYear - 1 : selectedYear;

          // Get previous month data for comparison
          let previousMonthData = await prisma.searchConsoleKeywordMonthlyComputed.findMany({
            where: {
              keywordId: {
                in: currentMonthData.map(k => k.keywordId)
              },
              month: prevMonth,
              year: prevYear,
            },
          });

          // Fallback to MonthlyStat for previous month if needed
          if (previousMonthData.length === 0) {
            const prevMonthlyStats = await prisma.searchConsoleKeywordMonthlyStat.findMany({
              where: {
                keywordId: {
                  in: currentMonthData.map(k => k.keywordId)
                },
                month: prevMonth,
                year: prevYear,
              },
            });

            previousMonthData = prevMonthlyStats.map(stat => ({
              id: stat.id,
              keywordId: stat.keywordId,
              month: stat.month,
              year: stat.year,
              averageRank: stat.averageRank,
              impressions: stat.searchVolume,
              clicks: 0,
              topRankingPageUrl: stat.topRankingPageUrl,
              calcWindowDays: 7,
              computedAt: stat.createdAt,
              updatedAt: stat.updatedAt,
              keyword: undefined,
            }));
          }

          let totalImproved = 0;
          let totalDropped = 0;
          let totalRankSum = 0;
          let totalRankCount = 0;

          // Calculate movement stats
          for (const current of currentMonthData) {
            const previous = previousMonthData.find(p => p.keywordId === current.keywordId);

            if (previous && current.averageRank > 0 && previous.averageRank > 0) {
              // Lower rank number means better position
              if (current.averageRank < previous.averageRank) {
                totalImproved++;
              } else if (current.averageRank > previous.averageRank) {
                totalDropped++;
              }
            }
            
            if (current.averageRank > 0) {
              totalRankSum += current.averageRank;
              totalRankCount++;
            }
          }

          const improvedPercentage = totalKeywords > 0 
            ? Math.round((totalImproved / totalKeywords) * 100) 
            : 0;
            
          const droppedPercentage = totalKeywords > 0 
            ? Math.round((totalDropped / totalKeywords) * 100) 
            : 0;
            
          const averageRank = totalRankCount > 0 
            ? parseFloat((totalRankSum / totalRankCount).toFixed(2)) 
            : 0;

          // Calculate previous month's metrics for comparison (2 months ago vs 3 months ago)
          const prevPrevMonth = prevMonth === 1 ? 12 : prevMonth - 1;
          const prevPrevYear = prevMonth === 1 ? prevYear - 1 : prevYear;

          let prevMonthData = await prisma.searchConsoleKeywordMonthlyComputed.findMany({
            where: {
              keyword: { analyticsId: analytics.id },
              month: prevMonth,
              year: prevYear,
            },
          });

          if (prevMonthData.length === 0) {
            const stats = await prisma.searchConsoleKeywordMonthlyStat.findMany({
              where: {
                keyword: { analyticsId: analytics.id },
                month: prevMonth,
                year: prevYear,
              },
            });
            prevMonthData = stats.map(stat => ({
              id: stat.id,
              keywordId: stat.keywordId,
              month: stat.month,
              year: stat.year,
              averageRank: stat.averageRank,
              impressions: stat.searchVolume,
              clicks: 0,
              topRankingPageUrl: stat.topRankingPageUrl,
              calcWindowDays: 7,
              computedAt: stat.createdAt,
              updatedAt: stat.updatedAt,
              keyword: undefined,
            }));
          }

          let prevPrevMonthData = await prisma.searchConsoleKeywordMonthlyComputed.findMany({
            where: {
              keywordId: { in: prevMonthData.map(k => k.keywordId) },
              month: prevPrevMonth,
              year: prevPrevYear,
            },
          });

          if (prevPrevMonthData.length === 0) {
            const stats = await prisma.searchConsoleKeywordMonthlyStat.findMany({
              where: {
                keywordId: { in: prevMonthData.map(k => k.keywordId) },
                month: prevPrevMonth,
                year: prevPrevYear,
              },
            });
            prevPrevMonthData = stats.map(stat => ({
              id: stat.id,
              keywordId: stat.keywordId,
              month: stat.month,
              year: stat.year,
              averageRank: stat.averageRank,
              impressions: stat.searchVolume,
              clicks: 0,
              topRankingPageUrl: stat.topRankingPageUrl,
              calcWindowDays: 7,
              computedAt: stat.createdAt,
              updatedAt: stat.updatedAt,
              keyword: undefined,
            }));
          }

          let prevMonthImproved = 0;
          let prevMonthDropped = 0;

          for (const current of prevMonthData) {
            const previous = prevPrevMonthData.find(p => p.keywordId === current.keywordId);
            if (previous && current.averageRank > 0 && previous.averageRank > 0) {
              if (current.averageRank < previous.averageRank) {
                prevMonthImproved++;
              } else if (current.averageRank > previous.averageRank) {
                prevMonthDropped++;
              }
            }
          }

          const prevMonthImprovedPercentage = prevMonthData.length > 0 
            ? Math.round((prevMonthImproved / prevMonthData.length) * 100) 
            : 0;
          const prevMonthDroppedPercentage = prevMonthData.length > 0 
            ? Math.round((prevMonthDropped / prevMonthData.length) * 100) 
            : 0;

          // Calculate change vs previous month
          const improvedChange = improvedPercentage - prevMonthImprovedPercentage;
          const droppedChange = droppedPercentage - prevMonthDroppedPercentage;

          return {
            success: true,
            data: {
              totalKeywords,
              improvedPercentage,
              droppedPercentage,
              averageRank,
              improvedChange,
              droppedChange,
            },
          };
        }
      } catch (error) {
        console.error('Error getting dashboard metrics:', error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get dashboard metrics',
        });
      }
    }),

  // Send test WhatsApp message
  sendTestWhatsApp: adminProcedure
    .input(
      z.object({
        phoneNumber: z.string().min(1, 'Phone number is required'),
        message: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { phoneNumber, message } = input;
        
        // Default test message if none provided
        const testMessage = message || 'This is a test message from Rank Ranger Admin Dashboard. WhatsApp integration is working correctly!';
        
        // For now, we'll simulate sending a WhatsApp message
        // In a real implementation, you would integrate with WhatsApp Business API
        console.log(`Test WhatsApp message would be sent to ${phoneNumber}: ${testMessage}`);
        
        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        return {
          success: true,
          message: 'Test WhatsApp message sent successfully',
          phoneNumber,
          sentMessage: testMessage,
        };
      } catch (error) {
        console.error('Error sending test WhatsApp message:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to send test WhatsApp message',
        });
      }
    }),
});
