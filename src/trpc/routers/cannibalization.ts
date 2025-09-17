import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../context';
import { prisma } from '../../utils/prisma';

export const cannibalizationRouter = router({
  getResults: protectedProcedure
    .input(
      z.object({
        campaignId: z.string(),
        limit: z.number().optional().default(10),
      })
    )
    .query(async ({ input, ctx }) => {
      const { campaignId, limit } = input;

      try {
        // Check if user has access to this campaign
        const campaign = await prisma.campaign.findFirst({
          where: {
            id: campaignId,
            OR: [
              { userId: ctx.user.id },
              {
                campaignUsers: {
                  some: {
                    userId: ctx.user.id,
                  },
                },
              },
            ],
          },
        });

        if (!campaign) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found or access denied',
          });
        }

        // Mock cannibalization data for now
        // In a real implementation, this would analyze keyword overlap between pages
        const mockResults = [
          {
            keyword: 'seo tools',
            topPageUrl: '/seo-tools',
            topPageImpressions: 1500,
            competingPages: [
              {
                pageUrl: '/seo-tools',
                impressions: 1500,
                overlapPercentage: 100,
              },
              {
                pageUrl: '/free-seo-tools',
                impressions: 800,
                overlapPercentage: 45,
              },
            ],
          },
          {
            keyword: 'keyword research',
            topPageUrl: '/keyword-research-guide',
            topPageImpressions: 2200,
            competingPages: [
              {
                pageUrl: '/keyword-research-guide',
                impressions: 2200,
                overlapPercentage: 100,
              },
              {
                pageUrl: '/keyword-tools',
                impressions: 950,
                overlapPercentage: 35,
              },
            ],
          },
        ];

        return {
          results: mockResults.slice(0, limit),
          totalCount: mockResults.length,
        };
      } catch (error) {
        console.error('Error fetching cannibalization results:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch cannibalization results',
        });
      }
    }),
});
