import cron from 'node-cron';
import { prisma } from '../utils/prisma';
import { AnalyticsService } from './analytics';
import { keywordCannibalizationService } from './keywordCannibalization';
import { MilestoneService } from './milestoneService';
import { searchConsoleService } from './searchConsole';
import moment from 'moment';

const analyticsService = new AnalyticsService();
const milestoneService = new MilestoneService();

export class CronService {
  private static instance: CronService;

  private constructor() {}

  public static getInstance(): CronService {
    if (!CronService.instance) {
      CronService.instance = new CronService();
    }
    return CronService.instance;
  }

  /**
   * Initialize all cron jobs
   */
  public initCronJobs(): void {
    this.setupMonthlyAnalyticsJob();
    this.setupDailyTrafficJob();
    this.setupCannibalizationAuditJob();
    this.setupDailyMilestoneCheckJob();
    this.setupDailyTopKeywordsJob();
    console.log('✅ Cron jobs initialized');
  }

  /**
   * Setup monthly analytics fetching job
   * Runs at 2:00 AM on the 1st of every month
   */
  private setupMonthlyAnalyticsJob(): void {
    cron.schedule(
      '0 2 1 * *',
      async () => {
        console.log('🕐 Starting monthly analytics fetch job...');
        await this.fetchMonthlyAnalytics();
      },
      {
        timezone: 'UTC',
      }
    );

    console.log(
      '📅 Monthly analytics job scheduled: 2:00 AM UTC on 1st of every month'
    );
  }

  /**
   * Setup daily traffic fetching job
   * Runs at 6:00 AM UTC every day
   */
  private setupDailyTrafficJob(): void {
    cron.schedule(
      '0 6 * * *',
      async () => {
        console.log('🕐 Starting daily traffic fetch job...');
        await this.fetchDailyTraffic();
      },
      {
        timezone: 'UTC',
      }
    );

    console.log('📅 Daily traffic job scheduled: 6:00 AM UTC every day');
  }

  /**
   * Setup keyword cannibalization audit job
   * Runs daily at 4:00 AM UTC
   */
  private setupCannibalizationAuditJob(): void {
    cron.schedule(
      '0 4 * * *',
      async () => {
        console.log('🕐 Starting daily cannibalization audit job...');
        await this.runCannibalizationAudits();
      },
      {
        timezone: 'UTC',
      }
    );

    console.log(
      '📅 Cannibalization audit job scheduled: 4:00 AM UTC every day'
    );
  }

  /**
   * Setup daily milestone checking job
   * Runs at 8:00 AM UTC every day (after daily traffic job)
   */
  private setupDailyMilestoneCheckJob(): void {
    cron.schedule(
      '0 8 * * *',
      async () => {
        console.log('🎯 Starting daily milestone check job...');
        await this.checkMilestones();
      },
      {
        timezone: 'UTC',
      }
    );

    console.log(
      '📅 Daily milestone check job scheduled: 8:00 AM UTC every day'
    );
  }

  /**
   * Setup daily top keywords fetching job
   * Runs at 7:00 AM UTC every day (after daily traffic job)
   */
  private setupDailyTopKeywordsJob(): void {
    cron.schedule(
      '0 7 * * *',
      async () => {
        console.log('🔑 Starting daily top keywords fetch job...');
        await this.fetchTopKeywords();
      },
      {
        timezone: 'UTC',
      }
    );

    console.log(
      '📅 Daily top keywords job scheduled: 7:00 AM UTC every day'
    );
  }

  /**
   * Run cannibalization audits for all active campaigns
   */
  private async runCannibalizationAudits(): Promise<void> {
    try {
      console.log(
        '🔍 Running cannibalization audits for all active campaigns...'
      );

      // Get campaigns that need audits
      const campaignsNeedingAudit =
        await keywordCannibalizationService.getCampaignsNeedingAudit();

      console.log(
        `📊 Found ${campaignsNeedingAudit.length} campaigns needing cannibalization audit`
      );

      if (campaignsNeedingAudit.length === 0) {
        console.log('ℹ️  No campaigns need cannibalization audit at this time');
        return;
      }

      // Run audits for each campaign
      const results = await Promise.allSettled(
        campaignsNeedingAudit.map(async (campaignId: string) => {
          console.log(
            `🔄 Running cannibalization audit for campaign: ${campaignId}`
          );

          try {
            const auditId =
              await keywordCannibalizationService.runScheduledAudit(campaignId);

            console.log(
              `✅ Successfully completed cannibalization audit for campaign: ${campaignId} (Audit ID: ${auditId})`
            );
            return {
              campaignId,
              auditId,
              success: true,
            };
          } catch (error) {
            console.error(
              `💥 Error running cannibalization audit for campaign ${campaignId}:`,
              error
            );
            return {
              campaignId,
              success: false,
              error,
            };
          }
        })
      );

      // Log summary
      const successful = results.filter(
        (result: PromiseSettledResult<any>) =>
          result.status === 'fulfilled' && (result as any).value.success
      ).length;
      const failed = results.length - successful;

      console.log(`📈 Cannibalization audit job completed:`);
      console.log(`   ✅ Successful: ${successful}`);
      console.log(`   ❌ Failed: ${failed}`);
      console.log(`   📊 Total campaigns processed: ${results.length}`);
    } catch (error) {
      console.error('💥 Error in cannibalization audit job:', error);
      throw new Error(`Failed to run cannibalization audits: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Fetch analytics for all active campaigns
   */
  private async fetchMonthlyAnalytics(): Promise<void> {
    try {
      console.log('🔍 Fetching all active campaigns...');

      // Get all active campaigns
      const activeCampaigns = await prisma.campaign.findMany({
        where: {
          status: 'ACTIVE',
        },
        select: {
          id: true,
          name: true,
          searchConsoleSite: true,
        },
      });

      console.log(`📊 Found ${activeCampaigns.length} active campaigns`);

      if (activeCampaigns.length === 0) {
        console.log('ℹ️  No active campaigns found, skipping analytics fetch');
        return;
      }

      // Fetch analytics for each campaign
      const results = await Promise.allSettled(
        activeCampaigns.map(async (campaign) => {
          console.log(
            `🔄 Fetching analytics for campaign: ${campaign.name} (${campaign.id})`
          );

          try {
            // Documentation:
            // Cron jobs persist monthly keyword metrics indirectly by calling
            // fetchDailyKeywordData, which now computes/updates
            // SearchConsoleKeywordMonthlyComputed. The UI reads from DB only.
            // Fetch daily site traffic and keyword data
            const siteTrafficSuccess =
              await analyticsService.fetchDailySiteTraffic({
                campaignId: campaign.id,
                waitForAllData: true, // Run in background
              });

            const keywordDataSuccess =
              await analyticsService.fetchDailyKeywordData({
                campaignId: campaign.id,
                waitForAllData: true, // Run in background
              });

            // Fetch monthly traffic data for the last 12 months
            const monthlyTrafficSuccess =
              await analyticsService.fetchAndSaveMonthlyTrafficData({
                campaignId: campaign.id,
                waitForAllData: true, // Run in background
              });

            const success =
              siteTrafficSuccess && keywordDataSuccess && monthlyTrafficSuccess;

            if (success) {
              console.log(
                `✅ Successfully fetched analytics for campaign: ${campaign.name}`
              );
              return {
                campaignId: campaign.id,
                campaignName: campaign.name,
                success: true,
              };
            } else {
              console.log(
                `❌ Failed to fetch analytics for campaign: ${campaign.name}`
              );
              return {
                campaignId: campaign.id,
                campaignName: campaign.name,
                success: false,
              };
            }
          } catch (error) {
            console.error(
              `💥 Error fetching analytics for campaign ${campaign.name}:`,
              error
            );
            return {
              campaignId: campaign.id,
              campaignName: campaign.name,
              success: false,
              error,
            };
          }
        })
      );

      // Log summary
      const successful = results.filter(
        (result: any) => result.status === 'fulfilled' && result.value.success
      ).length;
      const failed = results.length - successful;

      console.log(`📈 Monthly analytics job completed:`);
      console.log(`   ✅ Successful: ${successful}`);
      console.log(`   ❌ Failed: ${failed}`);
      console.log(`   📊 Total campaigns processed: ${results.length}`);
    } catch (error) {
      console.error('💥 Error in monthly analytics job:', error);
      throw new Error(`Failed to fetch monthly analytics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Fetch daily traffic for all active campaigns
   */
  private async fetchDailyTraffic(): Promise<void> {
    try {
      console.log('🔍 Fetching daily traffic for all active campaigns...');

      // Get all active campaigns
      const activeCampaigns = await prisma.campaign.findMany({
        where: {
          status: 'ACTIVE',
        },
        select: {
          id: true,
          name: true,
          searchConsoleSite: true,
        },
      });

      console.log(
        `📊 Found ${activeCampaigns.length} active campaigns for daily traffic`
      );

      if (activeCampaigns.length === 0) {
        console.log(
          'ℹ️  No active campaigns found, skipping daily traffic fetch'
        );
        return;
      }

      // Fetch daily traffic for each campaign
      const results = await Promise.allSettled(
        activeCampaigns.map(async (campaign) => {
          console.log(
            `🔄 Fetching daily traffic for campaign: ${campaign.name} (${campaign.id})`
          );

          try {
            // Get the campaign with full details for analytics service
            const fullCampaign = await prisma.campaign.findUnique({
              where: { id: campaign.id },
              include: {
                googleAccount: true,
              },
            });

            if (!fullCampaign) {
              console.log(`❌ Campaign not found: ${campaign.name}`);
              return {
                campaignId: campaign.id,
                campaignName: campaign.name,
                success: false,
                error: 'Campaign not found',
              };
            }

            // Fetch and save daily data (keyword positions and traffic)
            const success = await analyticsService.fetchAndSaveDailyData({
              campaignId: campaign.id,
              waitForAllData: true, // Run in background
            });

            if (success) {
              console.log(
                `✅ Successfully fetched daily traffic for campaign: ${campaign.name}`
              );
              return {
                campaignId: campaign.id,
                campaignName: campaign.name,
                success: true,
              };
            } else {
              console.log(
                `❌ Failed to fetch daily traffic for campaign: ${campaign.name}`
              );
              return {
                campaignId: campaign.id,
                campaignName: campaign.name,
                success: false,
              };
            }
          } catch (error) {
            console.error(
              `💥 Error fetching daily traffic for campaign ${campaign.name}:`,
              error
            );
            return {
              campaignId: campaign.id,
              campaignName: campaign.name,
              success: false,
              error,
            };
          }
        })
      );

      // Log summary
      const successful = results.filter(
        (result: any) => result.status === 'fulfilled' && result.value.success
      ).length;
      const failed = results.length - successful;

      console.log(`📈 Daily traffic job completed:`);
      console.log(`   ✅ Successful: ${successful}`);
      console.log(`   ❌ Failed: ${failed}`);
      console.log(`   📊 Total campaigns processed: ${results.length}`);
    } catch (error) {
      console.error('💥 Error in daily traffic job:', error);
      throw new Error(`Failed to fetch daily traffic: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check milestones for all active campaigns
   */
  private async checkMilestones(): Promise<void> {
    try {
      console.log('🎯 Checking milestones for all active campaigns...');

      const results = await milestoneService.checkAllCampaignMilestones();

      // Log summary
      const totalMilestones = results.reduce(
        (sum, result) => sum + result.milestonesAchieved,
        0
      );
      const totalNotifications = results.reduce(
        (sum, result) => sum + result.notificationsSent,
        0
      );
      const totalErrors = results.reduce(
        (sum, result) => sum + result.errors.length,
        0
      );

      console.log(`🎯 Milestone check job completed:`);
      console.log(`   🎉 Total milestones achieved: ${totalMilestones}`);
      console.log(`   📧 Total notifications sent: ${totalNotifications}`);
      console.log(`   ❌ Total errors: ${totalErrors}`);
      console.log(`   📊 Total campaigns processed: ${results.length}`);

      // Log errors if any
      if (totalErrors > 0) {
        results.forEach((result) => {
          if (result.errors.length > 0) {
            console.error(
              `❌ Errors for campaign ${result.campaignName}:`,
              result.errors
            );
          }
        });
      }
    } catch (error) {
      console.error('💥 Error in milestone check job:', error);
      throw new Error(`Failed to check milestones: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Fetch top keywords for all active campaigns
   */
  private async fetchTopKeywords(): Promise<void> {
    try {
      console.log('🔑 Fetching top keywords for all active campaigns...');

      // Get all active campaigns with Google accounts
      const activeCampaigns = await prisma.campaign.findMany({
        where: {
          status: 'ACTIVE',
        },
        include: {
          googleAccount: true,
        },
      });

      console.log(
        `📊 Found ${activeCampaigns.length} active campaigns for top keywords`
      );

      if (activeCampaigns.length === 0) {
        console.log(
          'ℹ️  No active campaigns found, skipping top keywords fetch'
        );
        return;
      }

      // Get current month
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth(); // 0-based
      const currentYear = currentDate.getFullYear();

      // Fetch top keywords for each campaign
      const results = await Promise.allSettled(
        activeCampaigns.map(async (campaign) => {
          console.log(
            `🔄 Fetching top keywords for campaign: ${campaign.name} (${campaign.id})`
          );

          try {
            if (!campaign.googleAccount) {
              console.log(`❌ No Google account for campaign: ${campaign.name}`);
              return {
                campaignId: campaign.id,
                campaignName: campaign.name,
                success: false,
                error: 'No Google account',
              };
            }

            // Calculate date range for current month
            const startDate = moment.utc([currentYear, currentMonth, 1]);
            const endDate = moment.utc([currentYear, currentMonth, 1]).endOf('month');

            // Fetch current month data from GSC
            const currentMonthData = await searchConsoleService.getAnalytics({
              campaign,
              googleAccount: campaign.googleAccount,
              startAt: startDate,
              endAt: endDate,
              dimensions: ['query'],
            });

            if (!currentMonthData || currentMonthData.length === 0) {
              console.log(`ℹ️  No data for campaign: ${campaign.name}`);
              return {
                campaignId: campaign.id,
                campaignName: campaign.name,
                success: true,
                keywordCount: 0,
              };
            }

            // Fetch previous month data for comparison
            const prevStartDate = moment.utc([currentYear, currentMonth, 1]).subtract(1, 'month');
            const prevEndDate = moment.utc([currentYear, currentMonth, 1]).subtract(1, 'month').endOf('month');

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
            const topKeywords = currentMonthData
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

            // Upsert keywords to database
            for (const kw of topKeywords) {
              await prisma.topKeywordData.upsert({
                where: {
                  campaignId_keyword_month_year: {
                    campaignId: campaign.id,
                    keyword: kw.keyword,
                    month: currentMonth + 1, // 1-based for database
                    year: currentYear,
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
                  month: currentMonth + 1,
                  year: currentYear,
                  averageRank: kw.averageRank,
                  clicks: kw.clicks,
                  impressions: kw.impressions,
                  rankChange: kw.rankChange,
                  rankChangeDirection: kw.rankChangeDirection,
                },
              });
            }

            console.log(
              `✅ Successfully fetched ${topKeywords.length} top keywords for campaign: ${campaign.name}`
            );
            return {
              campaignId: campaign.id,
              campaignName: campaign.name,
              success: true,
              keywordCount: topKeywords.length,
            };
          } catch (error) {
            console.error(
              `💥 Error fetching top keywords for campaign ${campaign.name}:`,
              error
            );
            return {
              campaignId: campaign.id,
              campaignName: campaign.name,
              success: false,
              error,
            };
          }
        })
      );

      // Log summary
      const successful = results.filter(
        (result: any) => result.status === 'fulfilled' && result.value.success
      ).length;
      const failed = results.length - successful;
      const totalKeywords = results
        .filter((result: any) => result.status === 'fulfilled')
        .reduce((sum: number, result: any) => sum + (result.value.keywordCount || 0), 0);

      console.log(`📈 Top keywords job completed:`);
      console.log(`   ✅ Successful: ${successful}`);
      console.log(`   ❌ Failed: ${failed}`);
      console.log(`   🔑 Total keywords stored: ${totalKeywords}`);
      console.log(`   📊 Total campaigns processed: ${results.length}`);
    } catch (error) {
      console.error('💥 Error in top keywords job:', error);
      throw new Error(`Failed to fetch top keywords: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Manually trigger the monthly analytics job (for testing)
   */
  public async triggerMonthlyAnalytics(): Promise<void> {
    console.log('🚀 Manually triggering monthly analytics job...');
    await this.fetchMonthlyAnalytics();
  }

  /**
   * Manually trigger the daily traffic job (for testing)
   */
  public async triggerDailyTraffic(): Promise<void> {
    console.log('🚀 Manually triggering daily traffic job...');
    await this.fetchDailyTraffic();
  }

  /**
   * Manually trigger the cannibalization audit job (for testing)
   */
  public async triggerCannibalizationAudit(): Promise<void> {
    console.log('🚀 Manually triggering cannibalization audit job...');
    await this.runCannibalizationAudits();
  }

  /**
   * Manually trigger the milestone check job (for testing)
   */
  public async triggerMilestoneCheck(): Promise<void> {
    console.log('🚀 Manually triggering milestone check job...');
    await this.checkMilestones();
  }

  /**
   * Manually trigger the top keywords fetch job (for testing)
   */
  public async triggerTopKeywordsFetch(): Promise<void> {
    console.log('🚀 Manually triggering top keywords fetch job...');
    await this.fetchTopKeywords();
  }

  /**
   * Get cron job status
   */
  public getCronStatus(): { initialized: boolean; jobs: string[] } {
    return {
      initialized: true,
      jobs: [
        'Monthly Analytics Fetch - 0 2 1 * * (2:00 AM UTC on 1st of every month)',
        'Daily Traffic Fetch - 0 6 * * * (6:00 AM UTC every day)',
        'Cannibalization Audit - 0 4 * * * (4:00 AM UTC every day)',
        'Daily Top Keywords Fetch - 0 7 * * * (7:00 AM UTC every day)',
        'Daily Milestone Check - 0 8 * * * (8:00 AM UTC every day)',
      ],
    };
  }
}
