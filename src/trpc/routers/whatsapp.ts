import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { adminProcedure, router } from '../context';
import { prisma } from '../../utils/prisma';
import { WhatsAppService } from '../../services/whatsappService';

const whatsappService = new WhatsAppService();

export const whatsappRouter = router({
  // Get available WhatsApp groups from WHAPI
  getGroups: adminProcedure.query(async () => {
    try {
      // Check if WHAPI_TOKEN is configured
      if (!process.env.WHAPI_TOKEN) {
        console.warn('WHAPI_TOKEN not configured, returning empty groups list');
        return {
          success: true,
          data: [],
        };
      }

      const groups = await whatsappService.getGroups();
      
      // Sync groups with database
      for (const group of groups) {
        await prisma.whatsAppGroup.upsert({
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
      }

      return {
        success: true,
        data: groups,
      };
    } catch (error) {
      console.error('Error fetching WhatsApp groups:', error);
      // Return empty array instead of throwing error to prevent UI crashes
      return {
        success: false,
        data: [],
        error: 'WhatsApp service unavailable',
      };
    }
  }),

  // Save selected WhatsApp groups for a campaign
  saveCampaignGroups: adminProcedure
    .input(
      z.object({
        campaignId: z.string(),
        groupIds: z.array(z.string()),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { campaignId, groupIds } = input;

        // Verify campaign exists
        const campaign = await prisma.campaign.findUnique({
          where: { id: campaignId },
        });

        if (!campaign) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found',
          });
        }

        // Remove existing group associations
        await prisma.campaignWhatsAppGroup.deleteMany({
          where: { campaignId },
        });

        // Add new group associations
        const groupAssociations = [];
        for (const groupId of groupIds) {
          // Verify group exists in our database
          const group = await prisma.whatsAppGroup.findUnique({
            where: { groupId },
          });

          if (group) {
            groupAssociations.push({
              campaignId,
              groupId: group.id,
            });
          }
        }

        if (groupAssociations.length > 0) {
          await prisma.campaignWhatsAppGroup.createMany({
            data: groupAssociations,
          });
        }

        return {
          success: true,
          data: {
            campaignId,
            groupsAssigned: groupAssociations.length,
          },
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        console.error('Error saving campaign WhatsApp groups:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to save WhatsApp groups for campaign',
        });
      }
    }),

  // Get WhatsApp groups assigned to a campaign
  getCampaignGroups: adminProcedure
    .input(z.object({ campaignId: z.string() }))
    .query(async ({ input }) => {
      try {
        const { campaignId } = input;

        const campaignGroups = await prisma.campaignWhatsAppGroup.findMany({
          where: { 
            campaignId,
            isActive: true,
          },
          include: {
            whatsAppGroup: true,
          },
        });

        const groups = campaignGroups.map(cg => ({
          id: cg.whatsAppGroup.groupId,
          name: cg.whatsAppGroup.name,
          description: cg.whatsAppGroup.description,
        }));

        return {
          success: true,
          data: groups,
        };
      } catch (error) {
        console.error('Error fetching campaign WhatsApp groups:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch campaign WhatsApp groups',
        });
      }
    }),
});
