import { prisma } from '../utils/prisma';
import { WhatsAppService } from './whatsappService';
import nodemailer from 'nodemailer';
import { MilestoneCategory } from '@prisma/client';

export interface MilestoneCheckResult {
  campaignId: string;
  campaignName: string;
  milestonesAchieved: number;
  notificationsSent: number;
  errors: string[];
}

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

export class MilestoneService {
  private whatsappService: WhatsAppService;
  private emailTransporter: nodemailer.Transporter | null = null;

  constructor() {
    this.whatsappService = new WhatsAppService();
    this.initializeEmailTransporter();
  }

  /**
   * Initialize email transporter
   */
  private initializeEmailTransporter(): void {
    try {
      const emailConfig: EmailConfig = {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASS || '',
        },
      };

      if (emailConfig.auth.user && emailConfig.auth.pass) {
        this.emailTransporter = nodemailer.createTransport(emailConfig);
      } else {
        console.warn('Email configuration not complete. Email notifications will be disabled.');
      }
    } catch (error) {
      console.error('Failed to initialize email transporter:', error);
    }
  }

  /**
   * Check milestones for all active campaigns
   */
  async checkAllCampaignMilestones(): Promise<MilestoneCheckResult[]> {
    console.log('🎯 Starting milestone check for all active campaigns...');

    const activeCampaigns = await prisma.campaign.findMany({
      where: { status: 'ACTIVE' },
      include: {
        milestonePreferences: {
          include: {
            milestoneType: true,
          },
        },
        campaignUsers: {
          include: {
            user: true,
          },
        },
        campaignGroups: {
          include: {
            whatsAppGroup: true,
          },
        },
      },
    });

    console.log(`📊 Found ${activeCampaigns.length} active campaigns`);

    const results: MilestoneCheckResult[] = [];

    for (const campaign of activeCampaigns) {
      try {
        const result = await this.checkCampaignMilestones(campaign.id);
        results.push(result);
      } catch (error) {
        console.error(`Error checking milestones for campaign ${campaign.name}:`, error);
        results.push({
          campaignId: campaign.id,
          campaignName: campaign.name,
          milestonesAchieved: 0,
          notificationsSent: 0,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
        });
      }
    }

    return results;
  }

  /**
   * Check milestones for a specific campaign
   */
  async checkCampaignMilestones(campaignId: string): Promise<MilestoneCheckResult> {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        milestonePreferences: {
          where: { isActive: true },
          include: {
            milestoneType: true,
          },
        },
        campaignUsers: {
          where: { isActive: true },
          include: {
            user: true,
          },
        },
        campaignGroups: {
          where: { isActive: true },
          include: {
            whatsAppGroup: true,
          },
        },
      },
    });

    if (!campaign) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    const result: MilestoneCheckResult = {
      campaignId: campaign.id,
      campaignName: campaign.name,
      milestonesAchieved: 0,
      notificationsSent: 0,
      errors: [],
    };

    console.log(`🔍 Checking milestones for campaign: ${campaign.name}`);

    // Check position milestones
    await this.checkPositionMilestones(campaign, result);

    // Check click milestones
    await this.checkClickMilestones(campaign, result);

    console.log(`✅ Milestone check completed for ${campaign.name}: ${result.milestonesAchieved} achieved, ${result.notificationsSent} notifications sent`);

    return result;
  }

  /**
   * Check position milestones for a campaign
   */
  private async checkPositionMilestones(campaign: any, result: MilestoneCheckResult): Promise<void> {
    const positionPreferences = campaign.milestonePreferences.filter(
      (pref: any) => pref.milestoneType.type === MilestoneCategory.POSITION
    );

    if (positionPreferences.length === 0) {
      return;
    }

    // Get recent keyword data (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const keywordStats = await prisma.searchConsoleKeywordDailyStat.findMany({
      where: {
        date: { gte: sevenDaysAgo },
        keyword: {
          analytics: {
            siteUrl: campaign.searchConsoleSite,
          },
        },
      },
      include: {
        keyword: true,
      },
      orderBy: {
        date: 'desc',
      },
    });

    // Group by keyword and get latest position
    const latestPositions = new Map<string, { keywordId: string; position: number; date: Date; keyword: string }>();

    for (const stat of keywordStats) {
      if (stat.averageRank && !latestPositions.has(stat.keywordId)) {
        latestPositions.set(stat.keywordId, {
          keywordId: stat.keywordId,
          position: Math.round(stat.averageRank),
          date: stat.date,
          keyword: stat.keyword.keyword,
        });
      }
    }

    // Check each position milestone
    for (const preference of positionPreferences) {
      const targetPosition = preference.milestoneType.position;
      if (!targetPosition) continue;

      for (const [keywordId, data] of latestPositions) {
        if (data.position <= targetPosition) {
          // Check if milestone already sent
          const existingMilestone = await prisma.sentMilestone.findFirst({
            where: {
              campaignId: campaign.id,
              milestoneTypeId: preference.milestoneTypeId,
              keywordId: keywordId,
            },
          });

          if (!existingMilestone) {
            result.milestonesAchieved++;
            
            // Send notifications
            const notificationSent = await this.sendMilestoneNotifications(
              campaign,
              preference,
              data.keyword,
              data.position,
              data.date
            );

            if (notificationSent.success) {
              result.notificationsSent++;
              
              // Record the sent milestone
              await prisma.sentMilestone.create({
                data: {
                  campaignId: campaign.id,
                  milestoneTypeId: preference.milestoneTypeId,
                  keywordId: keywordId,
                  achievedAt: data.date,
                  emailSent: notificationSent.emailSent,
                  whatsappSent: notificationSent.whatsappSent,
                  emailError: notificationSent.emailError,
                  whatsappError: notificationSent.whatsappError,
                  metricValue: data.position,
                },
              });
            } else {
              result.errors.push(`Failed to send notifications for ${data.keyword} position ${data.position}`);
            }
          }
        }
      }
    }
  }

  /**
   * Check click milestones for a campaign
   */
  private async checkClickMilestones(campaign: any, result: MilestoneCheckResult): Promise<void> {
    const clickPreferences = campaign.milestonePreferences.filter(
      (pref: any) => pref.milestoneType.type === MilestoneCategory.CLICKS
    );

    if (clickPreferences.length === 0) {
      return;
    }

    // Get total clicks since campaign start date
    const totalClicks = await prisma.searchConsoleTrafficDaily.aggregate({
      where: {
        date: { gte: campaign.startingDate },
        analytics: {
          siteUrl: campaign.searchConsoleSite,
        },
      },
      _sum: {
        clicks: true,
      },
    });

    const currentClicks = totalClicks._sum.clicks || 0;

    // Check each click milestone
    for (const preference of clickPreferences) {
      const targetClicks = preference.milestoneType.threshold;
      if (!targetClicks) continue;

      if (currentClicks >= targetClicks) {
        // Check if milestone already sent
        const existingMilestone = await prisma.sentMilestone.findFirst({
          where: {
            campaignId: campaign.id,
            milestoneTypeId: preference.milestoneTypeId,
            keywordId: null, // Click milestones are campaign-wide
          },
        });

        if (!existingMilestone) {
          result.milestonesAchieved++;
          
          // Send notifications
          const notificationSent = await this.sendMilestoneNotifications(
            campaign,
            preference,
            undefined, // No specific keyword for click milestones
            currentClicks,
            new Date()
          );

          if (notificationSent.success) {
            result.notificationsSent++;
            
            // Record the sent milestone
            await prisma.sentMilestone.create({
              data: {
                campaignId: campaign.id,
                milestoneTypeId: preference.milestoneTypeId,
                keywordId: null,
                achievedAt: new Date(),
                emailSent: notificationSent.emailSent,
                whatsappSent: notificationSent.whatsappSent,
                emailError: notificationSent.emailError,
                whatsappError: notificationSent.whatsappError,
                metricValue: currentClicks,
              },
            });
          } else {
            result.errors.push(`Failed to send notifications for ${targetClicks} clicks milestone`);
          }
        }
      }
    }
  }

  /**
   * Send milestone notifications via email and WhatsApp
   */
  private async sendMilestoneNotifications(
    campaign: any,
    preference: any,
    keyword: string | undefined,
    value: number,
    achievedDate: Date
  ): Promise<{
    success: boolean;
    emailSent: boolean;
    whatsappSent: boolean;
    emailError?: string;
    whatsappError?: string;
  }> {
    let emailSent = false;
    let whatsappSent = false;
    let emailError: string | undefined;
    let whatsappError: string | undefined;

    const milestoneType = preference.milestoneType;
    const dashboardUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/campaigns/${campaign.id}`;

    // Get admin notification preferences
    const adminUser = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
      include: {
        adminNotificationPreferences: true,
      },
    });

    const adminPrefs = adminUser?.adminNotificationPreferences;
    
    // Check if notifications are globally disabled
    if (!adminPrefs?.enableAllNotifications) {
      console.log('📵 All notifications are disabled by admin preferences');
      return {
        success: false,
        emailSent: false,
        whatsappSent: false,
        emailError: 'Notifications disabled by admin',
        whatsappError: 'Notifications disabled by admin',
      };
    }

    // Send email notifications
    if (preference.emailEnabled && adminPrefs?.enableEmail && this.emailTransporter) {
      try {
        const emailSubject = `🎉 Milestone Achieved - ${campaign.name}`;
        const emailBody = this.formatEmailMessage(
          campaign.name,
          milestoneType.displayName,
          value,
          keyword,
          dashboardUrl,
          achievedDate
        );

        // Get users who have email preferences for this campaign
        const emailPreferences = await prisma.userCampaignEmailPreference.findMany({
          where: {
            campaignId: campaign.id,
            isActive: true,
          },
          include: {
            user: {
              select: {
                email: true,
                name: true,
                status: true,
              },
            },
          },
        });

        // Send emails to users with preferences for this campaign
        for (const emailPref of emailPreferences) {
          if (emailPref.user.status === 'ACTIVE') {
            await this.emailTransporter.sendMail({
              from: process.env.SMTP_FROM || process.env.SMTP_USER,
              to: emailPref.user.email,
              subject: emailSubject,
              html: emailBody,
            });
          }
        }

        // Also send to campaign users if no specific email preferences are set
        if (emailPreferences.length === 0) {
          for (const campaignUser of campaign.campaignUsers) {
            if (campaignUser.user.status === 'ACTIVE') {
              await this.emailTransporter.sendMail({
                from: process.env.SMTP_FROM || process.env.SMTP_USER,
                to: campaignUser.user.email,
                subject: emailSubject,
                html: emailBody,
              });
            }
          }
        }

        emailSent = true;
        console.log(`📧 Email notifications sent for campaign: ${campaign.name}`);
      } catch (error) {
        emailError = error instanceof Error ? error.message : 'Unknown email error';
        console.error('Email notification error:', error);
      }
    }

    // Send WhatsApp notifications
    if (preference.whatsappEnabled && adminPrefs?.enableWhatsApp) {
      try {
        const whatsappMessage = this.whatsappService.formatMilestoneMessage(
          campaign.name,
          milestoneType.displayName,
          value,
          keyword,
          dashboardUrl,
          achievedDate
        );

        for (const campaignGroup of campaign.campaignGroups) {
          const result = await this.whatsappService.sendMessage(
            campaignGroup.whatsAppGroup.groupId,
            whatsappMessage
          );

          if (!result.success) {
            throw new Error(result.error);
          }
        }

        whatsappSent = campaign.campaignGroups.length > 0;
        if (whatsappSent) {
          console.log(`📱 WhatsApp notifications sent for campaign: ${campaign.name}`);
        }
      } catch (error) {
        whatsappError = error instanceof Error ? error.message : 'Unknown WhatsApp error';
        console.error('WhatsApp notification error:', error);
      }
    }

    return {
      success: emailSent || whatsappSent,
      emailSent,
      whatsappSent,
      emailError,
      whatsappError,
    };
  }

  /**
   * Format email message for milestones
   */
  private formatEmailMessage(
    campaignName: string,
    milestoneType: string,
    value: number,
    keyword?: string,
    dashboardUrl?: string,
    achievedDate?: Date
  ): string {
    const dateStr = achievedDate ? achievedDate.toLocaleDateString() : new Date().toLocaleDateString();
    
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px;">🎉 Milestone Achieved!</h1>
        </div>
        
        <div style="padding: 20px; background: #f9f9f9;">
          <h2 style="color: #333; margin-top: 0;">Campaign: ${campaignName}</h2>
          
          ${keyword ? `<p><strong>🔍 Keyword:</strong> ${keyword}</p>` : ''}
          
          <p><strong>🎯 Achievement:</strong> ${milestoneType}</p>
          <p><strong>📈 Value:</strong> ${value}</p>
          <p><strong>📅 Date:</strong> ${dateStr}</p>
          
          ${dashboardUrl ? `
            <div style="text-align: center; margin: 30px 0;">
              <a href="${dashboardUrl}" style="background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                🔗 View Dashboard
              </a>
            </div>
          ` : ''}
          
          <p style="text-align: center; color: #666; margin-top: 30px;">
            ✨ Keep up the great work!
          </p>
        </div>
        
        <div style="background: #333; color: white; padding: 10px; text-align: center; font-size: 12px;">
          Rank Ranger - SEO Campaign Management
        </div>
      </div>
    `;
  }

  /**
   * Initialize default milestone types
   */
  async initializeDefaultMilestoneTypes(): Promise<void> {
    const defaultMilestones = [
      { name: 'position_1', displayName: 'Position 1', type: MilestoneCategory.POSITION, position: 1 },
      { name: 'position_2', displayName: 'Position 2', type: MilestoneCategory.POSITION, position: 2 },
      { name: 'position_3', displayName: 'Position 3', type: MilestoneCategory.POSITION, position: 3 },
      { name: 'clicks_100', displayName: '100 Clicks', type: MilestoneCategory.CLICKS, threshold: 100 },
      { name: 'clicks_500', displayName: '500 Clicks', type: MilestoneCategory.CLICKS, threshold: 500 },
      { name: 'clicks_1000', displayName: '1,000 Clicks', type: MilestoneCategory.CLICKS, threshold: 1000 },
      { name: 'clicks_5000', displayName: '5,000 Clicks', type: MilestoneCategory.CLICKS, threshold: 5000 },
    ];

    for (const milestone of defaultMilestones) {
      await prisma.milestoneType.upsert({
        where: { name: milestone.name },
        update: {},
        create: milestone,
      });
    }

    console.log('✅ Default milestone types initialized');
  }
}
