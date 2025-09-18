import cron from 'node-cron';
import { prisma } from '../utils/prisma';
import { AnalyticsService } from './analytics';
import { MilestoneService } from './milestoneService';

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
    this.setupDailyMilestoneCheckJob();
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

    console.log('📅 Daily milestone check job scheduled: 8:00 AM UTC every day');
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
        (result) => result.status === 'fulfilled' && result.value.success
      ).length;
      const failed = results.length - successful;

      console.log(`📈 Monthly analytics job completed:`);
      console.log(`   ✅ Successful: ${successful}`);
      console.log(`   ❌ Failed: ${failed}`);
      console.log(`   📊 Total campaigns processed: ${results.length}`);
    } catch (error) {
      console.error('💥 Error in monthly analytics job:', error);
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
        (result) => result.status === 'fulfilled' && result.value.success
      ).length;
      const failed = results.length - successful;

      console.log(`📈 Daily traffic job completed:`);
      console.log(`   ✅ Successful: ${successful}`);
      console.log(`   ❌ Failed: ${failed}`);
      console.log(`   📊 Total campaigns processed: ${results.length}`);
    } catch (error) {
      console.error('💥 Error in daily traffic job:', error);
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
      const totalMilestones = results.reduce((sum, result) => sum + result.milestonesAchieved, 0);
      const totalNotifications = results.reduce((sum, result) => sum + result.notificationsSent, 0);
      const totalErrors = results.reduce((sum, result) => sum + result.errors.length, 0);

      console.log(`🎯 Milestone check job completed:`);
      console.log(`   🎉 Total milestones achieved: ${totalMilestones}`);
      console.log(`   📧 Total notifications sent: ${totalNotifications}`);
      console.log(`   ❌ Total errors: ${totalErrors}`);
      console.log(`   📊 Total campaigns processed: ${results.length}`);

      // Log errors if any
      if (totalErrors > 0) {
        results.forEach(result => {
          if (result.errors.length > 0) {
            console.error(`❌ Errors for campaign ${result.campaignName}:`, result.errors);
          }
        });
      }
    } catch (error) {
      console.error('💥 Error in milestone check job:', error);
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
   * Manually trigger the milestone check job (for testing)
   */
  public async triggerMilestoneCheck(): Promise<void> {
    console.log('🚀 Manually triggering milestone check job...');
    await this.checkMilestones();
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
        'Daily Milestone Check - 0 8 * * * (8:00 AM UTC every day)',
      ],
    };
  }
}
