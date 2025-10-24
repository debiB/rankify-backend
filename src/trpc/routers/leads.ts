import { z } from 'zod';
import { router, adminProcedure } from '../trpc-context';

export const leadsRouter = router({
  list: adminProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(10),
        search: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const { page, limit, search } = input;
      const skip = (page - 1) * limit;

      const where: any = {};
      if (search) {
        where.OR = [
          { name: { contains: search } },
          { email: { contains: search } },
          { phone: { contains: search } },
        ];
      }

      const prismaAny = ctx.prisma as any;
      const [totalCount, leads] = await Promise.all([
        prismaAny.lead.count({ where }),
        prismaAny.lead.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            source: true,
            starRating: true,
            isDealClosed: true,
            workCompleted: true,
            dealAmount: true,
            submittedAt: true,
            createdAt: true,
          },
        }),
      ]);

      return {
        leads,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit),
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPrevPage: page > 1,
        },
      };
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string(),
        starRating: z.number().min(1).max(5).nullable().optional(),
        isDealClosed: z.boolean().optional(),
        workCompleted: z.boolean().optional(),
        dealAmount: z.number().min(0).nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { id, starRating, isDealClosed, workCompleted, dealAmount } = input;

      const prismaAny = ctx.prisma as any;
      const lead = await prismaAny.lead.update({
        where: { id },
        data: {
          ...(starRating !== undefined ? { starRating } : {}),
          ...(isDealClosed !== undefined ? { isDealClosed } : {}),
          ...(workCompleted !== undefined ? { workCompleted } : {}),
          ...(dealAmount !== undefined ? { dealAmount } : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          source: true,
          starRating: true,
          isDealClosed: true,
          workCompleted: true,
          dealAmount: true,
          submittedAt: true,
          createdAt: true,
        },
      });

      return { success: true, lead };
    }),
});
