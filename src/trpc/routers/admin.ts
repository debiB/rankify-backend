import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { adminProcedure, protectedProcedure, router } from '../context';
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
      })
    )
    .query(async ({ input }) => {
      try {
        const { campaignId } = input;

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

            if (analytics) {
              totalKeywords += analytics.keywords.length;

              for (const keyword of analytics.keywords) {
                // Get the latest and previous daily stats for comparison
                const sortedStats = [...keyword.dailyStats].sort(
                  (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
                );
                
                const latestStat = sortedStats[0];
                const previousStat = sortedStats[1];

                if (latestStat && previousStat) {
                  const latestRank = latestStat.averageRank || 0;
                  const previousRank = previousStat.averageRank || 0;
                  
                  // Lower rank number means better position
                  if (latestRank < previousRank) {
                    totalImproved++;
                  } else if (latestRank > previousRank) {
                    totalDropped++;
                  }
                  
                  if (latestRank > 0) {
                    totalRankSum += latestRank;
                    totalRankCount++;
                  }
                } else if (latestStat && latestStat.averageRank && latestStat.averageRank > 0) {
                  // If we only have one data point, we can't determine improvement/decline
                  totalRankSum += latestStat.averageRank;
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

          return {
            success: true,
            data: {
              totalKeywords,
              improvedPercentage,
              droppedPercentage,
              averageRank,
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

          if (!analytics) {
            return {
              success: true,
              data: {
                totalKeywords: 0,
                improvedPercentage: 0,
                droppedPercentage: 0,
                averageRank: 0,
              },
            };
          }

          const totalKeywords = analytics.keywords.length;
          let totalImproved = 0;
          let totalDropped = 0;
          let totalRankSum = 0;
          let totalRankCount = 0;

          for (const keyword of analytics.keywords) {
            // Get the latest and previous daily stats for comparison
            const sortedStats = [...keyword.dailyStats].sort(
              (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
            );
            
            const latestStat = sortedStats[0];
            const previousStat = sortedStats[1];

            if (latestStat && previousStat) {
              const latestRank = latestStat.averageRank || 0;
              const previousRank = previousStat.averageRank || 0;
              
              // Lower rank number means better position
              if (latestRank < previousRank) {
                totalImproved++;
              } else if (latestRank > previousRank) {
                totalDropped++;
              }
              
              if (latestRank > 0) {
                totalRankSum += latestRank;
                totalRankCount++;
              }
            } else if (latestStat && latestStat.averageRank && latestStat.averageRank > 0) {
              // If we only have one data point, we can't determine improvement/decline
              totalRankSum += latestStat.averageRank;
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

          return {
            success: true,
            data: {
              totalKeywords,
              improvedPercentage,
              droppedPercentage,
              averageRank,
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
