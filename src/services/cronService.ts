import cron from 'node-cron';
import { prisma } from '../utils/prisma';
import { AnalyticsService } from './analytics';

const analyticsService = new AnalyticsService();

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
            const success = await analyticsService.fetchAndSaveAnalytics({
              campaignId: campaign.id,
              waitForAllData: true, // Run in background
            });

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
   * Get cron job status
   */
  public getCronStatus(): { initialized: boolean; jobs: string[] } {
    return {
      initialized: true,
      jobs: [
        'Monthly Analytics Fetch - 0 2 1 * * (2:00 AM UTC on 1st of every month)',
        'Daily Traffic Fetch - 0 6 * * * (6:00 AM UTC every day)',
      ],
    };
  }
}
