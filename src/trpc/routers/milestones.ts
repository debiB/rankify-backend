import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, adminProcedure, router } from '../trpc-context';
import { prisma } from '../../utils/prisma';
import { MilestoneService } from '../../services/milestoneService';
import { WhatsAppService } from '../../services/whatsappService';

const milestoneService = new MilestoneService();
const whatsappService = new WhatsAppService();

export const milestonesRouter = router({
  // Get all milestone types
  getMilestoneTypes: protectedProcedure.query(async () => {
    return await prisma.milestoneType.findMany({
      where: { isActive: true },
      orderBy: [
        { type: 'asc' },
        { position: 'asc' },
        { threshold: 'asc' },
      ],
    });
  }),

  // Get milestone preferences for a campaign
  getCampaignMilestonePreferences: protectedProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(async ({ input, ctx }) => {
      // Verify user has access to this campaign
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: input.campaignId,
          OR: [
            { userId: ctx.user.id },
            { campaignUsers: { some: { userId: ctx.user.id } } },
          ],
        },
      });

      if (!campaign) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Campaign not found or access denied',
        });
      }

      return await prisma.milestonePreference.findMany({
        where: { campaignId: input.campaignId },
        include: {
          milestoneType: true,
        },
        orderBy: [
          { milestoneType: { type: 'asc' } },
          { milestoneType: { position: 'asc' } },
          { milestoneType: { threshold: 'asc' } },
        ],
      });
    }),

  // Update milestone preferences for a campaign
  updateCampaignMilestonePreferences: protectedProcedure
    .input(
      z.object({
        campaignId: z.string(),
        preferences: z.array(
          z.object({
            milestoneTypeId: z.string(),
            emailEnabled: z.boolean(),
            whatsappEnabled: z.boolean(),
            isActive: z.boolean(),
          })
        ),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify user has admin access to this campaign
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: input.campaignId,
          OR: [
            { userId: ctx.user.id },
            { 
              campaignUsers: { 
                some: { 
                  userId: ctx.user.id,
                  role: 'ADMIN',
                } 
              } 
            },
          ],
        },
      });

      if (!campaign) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Campaign not found or insufficient permissions',
        });
      }

      // Update or create preferences
      const results = await Promise.all(
        input.preferences.map(async (pref) => {
          return await prisma.milestonePreference.upsert({
            where: {
              campaignId_milestoneTypeId: {
                campaignId: input.campaignId,
                milestoneTypeId: pref.milestoneTypeId,
              },
            },
            update: {
              emailEnabled: pref.emailEnabled,
              whatsappEnabled: pref.whatsappEnabled,
              isActive: pref.isActive,
            },
            create: {
              campaignId: input.campaignId,
              milestoneTypeId: pref.milestoneTypeId,
              emailEnabled: pref.emailEnabled,
              whatsappEnabled: pref.whatsappEnabled,
              isActive: pref.isActive,
            },
            include: {
              milestoneType: true,
            },
          });
        })
      );

      return results;
    }),

  // Get WhatsApp groups from Whapi API
  getWhatsAppGroups: adminProcedure.query(async () => {
    try {
      return await whatsappService.getGroups();
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to fetch WhatsApp groups',
      });
    }
  }),

  // Sync WhatsApp groups with database
  syncWhatsAppGroups: adminProcedure.mutation(async () => {
    try {
      const groups = await whatsappService.getGroups();
      
      const syncedGroups = await Promise.all(
        groups.map(async (group) => {
          return await prisma.whatsAppGroup.upsert({
            where: { groupId: group.id },
            update: {
              name: group.name,
              description: group.description,
              isActive: true,
            },
            create: {
              groupId: group.id,
              name: group.name,
              description: group.description,
              isActive: true,
            },
          });
        })
      );

      return {
        synced: syncedGroups.length,
        groups: syncedGroups,
      };
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to sync WhatsApp groups',
      });
    }
  }),

  // Get WhatsApp groups connected to a campaign
  getCampaignWhatsAppGroups: protectedProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(async ({ input, ctx }) => {
      // Verify user has access to this campaign
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: input.campaignId,
          OR: [
            { userId: ctx.user.id },
            { campaignUsers: { some: { userId: ctx.user.id } } },
          ],
        },
      });

      if (!campaign) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Campaign not found or access denied',
        });
      }

      return await prisma.campaignWhatsAppGroup.findMany({
        where: { campaignId: input.campaignId },
        include: {
          whatsAppGroup: true,
        },
      });
    }),

  // Connect WhatsApp groups to a campaign
  connectWhatsAppGroupsToCampaign: protectedProcedure
    .input(
      z.object({
        campaignId: z.string(),
        groupIds: z.array(z.string()),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify user has admin access to this campaign
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: input.campaignId,
          OR: [
            { userId: ctx.user.id },
            { 
              campaignUsers: { 
                some: { 
                  userId: ctx.user.id,
                  role: 'ADMIN',
                } 
              } 
            },
          ],
        },
      });

      if (!campaign) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Campaign not found or insufficient permissions',
        });
      }

      // Remove existing connections
      await prisma.campaignWhatsAppGroup.deleteMany({
        where: { campaignId: input.campaignId },
      });

      // Create new connections
      if (input.groupIds.length > 0) {
        const connections = await Promise.all(
          input.groupIds.map(async (groupId) => {
            // Verify the WhatsApp group exists in our database
            const whatsAppGroup = await prisma.whatsAppGroup.findUnique({
              where: { id: groupId },
            });

            if (!whatsAppGroup) {
              throw new TRPCError({
                code: 'NOT_FOUND',
                message: `WhatsApp group not found: ${groupId}`,
              });
            }

            return await prisma.campaignWhatsAppGroup.create({
              data: {
                campaignId: input.campaignId,
                groupId: groupId,
              },
              include: {
                whatsAppGroup: true,
              },
            });
          })
        );

        return connections;
      }

      return [];
    }),

  // Get sent milestones for a campaign
  getCampaignSentMilestones: protectedProcedure
    .input(
      z.object({
        campaignId: z.string(),
        limit: z.number().optional().default(50),
        offset: z.number().optional().default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      // Verify user has access to this campaign
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: input.campaignId,
          OR: [
            { userId: ctx.user.id },
            { campaignUsers: { some: { userId: ctx.user.id } } },
          ],
        },
      });

      if (!campaign) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Campaign not found or access denied',
        });
      }

      const [milestones, total] = await Promise.all([
        prisma.sentMilestone.findMany({
          where: { campaignId: input.campaignId },
          include: {
            milestoneType: true,
            keyword: true,
          },
          orderBy: { achievedAt: 'desc' },
          take: input.limit,
          skip: input.offset,
        }),
        prisma.sentMilestone.count({
          where: { campaignId: input.campaignId },
        }),
      ]);

      return {
        milestones,
        total,
        hasMore: input.offset + input.limit < total,
      };
    }),

  // Manually trigger milestone check for a campaign
  triggerCampaignMilestoneCheck: adminProcedure
    .input(z.object({ campaignId: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const result = await milestoneService.checkCampaignMilestones(input.campaignId);
        return result;
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to check milestones',
        });
      }
    }),

  // Manually trigger milestone check for all campaigns
  triggerAllCampaignsMilestoneCheck: adminProcedure.mutation(async () => {
    try {
      const results = await milestoneService.checkAllCampaignMilestones();
      return results;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to check milestones for all campaigns',
      });
    }
  }),

  // Initialize default milestone types
  initializeDefaultMilestoneTypes: adminProcedure.mutation(async () => {
    try {
      await milestoneService.initializeDefaultMilestoneTypes();
      return { success: true, message: 'Default milestone types initialized' };
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to initialize milestone types',
      });
    }
  }),

  // Get milestone statistics for a campaign
  getCampaignMilestoneStats: protectedProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(async ({ input, ctx }) => {
      // Verify user has access to this campaign
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: input.campaignId,
          OR: [
            { userId: ctx.user.id },
            { campaignUsers: { some: { userId: ctx.user.id } } },
          ],
        },
      });

      if (!campaign) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Campaign not found or access denied',
        });
      }

      const [totalMilestones, milestonesThisMonth, milestonesByType] = await Promise.all([
        prisma.sentMilestone.count({
          where: { campaignId: input.campaignId },
        }),
        prisma.sentMilestone.count({
          where: {
            campaignId: input.campaignId,
            achievedAt: {
              gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            },
          },
        }),
        prisma.sentMilestone.groupBy({
          by: ['milestoneTypeId'],
          where: { campaignId: input.campaignId },
          _count: { id: true },
        }),
      ]);

      // Get milestone type details
      const milestoneTypes = await prisma.milestoneType.findMany({
        where: {
          id: { in: milestonesByType.map(m => m.milestoneTypeId) },
        },
      });

      const milestonesByTypeWithDetails = milestonesByType.map(milestone => {
        const type = milestoneTypes.find(t => t.id === milestone.milestoneTypeId);
        return {
          milestoneType: type,
          count: milestone._count.id,
        };
      });

      return {
        totalMilestones,
        milestonesThisMonth,
        milestonesByType: milestonesByTypeWithDetails,
      };
    }),
});
