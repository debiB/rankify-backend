import { z } from 'zod';
import { router, protectedProcedure } from '../context';
import { keywordCannibalizationService } from '../../services/keywordCannibalization';


export const cannibalizationRouter = router({

  /**
   * Run audit with custom date range
   */
  runAudit: protectedProcedure
    .input(
      z.object({
        campaignId: z.string(),
        startDate: z.string().transform((str) => new Date(str)),
        endDate: z.string().transform((str) => new Date(str)),
      })
    )
    .mutation(async ({ input }) => {
      const auditId = await keywordCannibalizationService.runCustomAudit(
        input.campaignId,
        input.startDate,
        input.endDate
      );
      return { auditId };
    }),

  /**
   * Get cannibalization results for a campaign
   * Defaults to last 3 months if no date range provided
   */
  getResults: protectedProcedure
    .input(
      z.object({
        campaignId: z.string(),
        limit: z.number().min(1).max(100).optional().default(50),
        startDate: z.string().optional().transform((str) => str ? new Date(str) : undefined),
        endDate: z.string().optional().transform((str) => str ? new Date(str) : undefined),
      })
    )
    .query(async ({ input }) => {
      // Default to last 3 months if no date range provided
      let startDate = input.startDate;
      let endDate = input.endDate;
      
      if (!startDate || !endDate) {
        endDate = new Date();
        startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 3);
      }
      
      const results = await keywordCannibalizationService.getCannibalizationResults(
        input.campaignId,
        input.limit,
        startDate,
        endDate
      );
      return results;
    }),


  getKeywordDetails: protectedProcedure
    .input(
      z.object({
        campaignId: z.string(),
        keyword: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      // Get the latest audit for the campaign
      const latestAudit = await (ctx.prisma as any).keywordCannibalizationAudit.findFirst({
        where: {
          campaignId: input.campaignId,
          status: 'COMPLETED',
        },
        orderBy: { createdAt: 'desc' },
        include: {
          results: {
            where: {
              keyword: input.keyword,
            },
            include: {
              competingPages: {
                orderBy: { overlapPercentage: 'desc' },
              },
            },
          },
        },
      });

      return latestAudit?.results[0] || null;
    }),

  /**
   * Get cannibalization summary statistics for a campaign
   */
  getSummary: protectedProcedure
    .input(
      z.object({
        campaignId: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      const latestAudit = await (ctx.prisma as any).keywordCannibalizationAudit.findFirst({
        where: {
          campaignId: input.campaignId,
          status: 'COMPLETED',
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          auditType: true,
          startDate: true,
          endDate: true,
          totalKeywords: true,
          cannibalizationCount: true,
          createdAt: true,
          results: {
            select: {
              keyword: true,
              competingPages: {
                select: {
                  overlapPercentage: true,
                },
              },
            },
            where: {
              competingPages: {
                some: {},
              },
            },
          },
        },
      });

      if (!latestAudit) {
        return null;
      }

      // Calculate additional statistics
      const cannibalizationByKeyword = latestAudit.results.length;
      const totalCompetingPages = latestAudit.results.reduce(
        (sum: number, result: any) => sum + result.competingPages.length,
        0
      );
      const averageOverlapPercentage =
        latestAudit.results.length > 0
          ? latestAudit.results.reduce((sum: number, result: any) => {
              const avgForKeyword =
                result.competingPages.reduce((s: number, page: any) => s + page.overlapPercentage, 0) /
                result.competingPages.length;
              return sum + avgForKeyword;
            }, 0) / latestAudit.results.length
          : 0;

      // Get high-impact cannibalization (>50% overlap)
      const highImpactCount = latestAudit.results.filter((result: any) =>
        result.competingPages.some((page: any) => page.overlapPercentage > 50)
      ).length;

      return {
        auditId: latestAudit.id,
        auditType: latestAudit.auditType,
        auditDate: latestAudit.createdAt,
        dateRange: {
          startDate: latestAudit.startDate,
          endDate: latestAudit.endDate,
        },
        totalKeywords: latestAudit.totalKeywords,
        keywordsWithCannibalization: cannibalizationByKeyword,
        cannibalizationRate: latestAudit.totalKeywords > 0 
          ? (cannibalizationByKeyword / latestAudit.totalKeywords) * 100 
          : 0,
        totalCompetingPages,
        averageOverlapPercentage: Math.round(averageOverlapPercentage * 100) / 100,
        highImpactCannibalization: highImpactCount,
      };
    }),

  /**
   * Get top cannibalized keywords (highest overlap percentages)
   */
  getTopCannibalized: protectedProcedure
    .input(
      z.object({
        campaignId: z.string(),
        limit: z.number().min(1).max(20).optional().default(10),
      })
    )
    .query(async ({ input, ctx }) => {
      const latestAudit = await (ctx.prisma as any).keywordCannibalizationAudit.findFirst({
        where: {
          campaignId: input.campaignId,
          status: 'COMPLETED',
        },
        orderBy: { createdAt: 'desc' },
        include: {
          results: {
            include: {
              competingPages: {
                orderBy: { overlapPercentage: 'desc' },
                take: 1, // Get the highest overlap for each keyword
              },
            },
            where: {
              competingPages: {
                some: {},
              },
            },
          },
        },
      });

      if (!latestAudit) {
        return [];
      }

      // Get top cannibalized keywords (sorted by highest overlap percentage)
      const topCannibalized = latestAudit.results
        .map((result: any) => ({
          keyword: result.keyword,
          maxOverlap: Math.max(...result.competingPages.map((page: any) => page.overlapPercentage)),
          competingPagesCount: result.competingPages.length,
        }))
        .sort((a: any, b: any) => b.maxOverlap - a.maxOverlap)
        .slice(0, input.limit);

      return topCannibalized;
    }),
});
