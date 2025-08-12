import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, adminProcedure, router } from '../context';
import { prisma } from '../../utils/prisma';

const createCampaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required'),
  startingDate: z.string().transform((str) => new Date(str)),
  searchConsoleAccount: z.string().min(1, 'Search Console account is required'),
  searchConsoleSite: z.string().min(1, 'Search Console site is required'),
  keywords: z.string().min(1, 'Keywords are required'),
  userId: z.string().min(1, 'User ID is required'),
  googleAccountId: z.string().min(1, 'Google Account ID is required'),
});

const updateCampaignSchema = z.object({
  id: z.string().min(1, 'Campaign ID is required'),
  name: z.string().min(1, 'Campaign name is required').optional(),
  startingDate: z
    .string()
    .transform((str) => new Date(str))
    .optional(),
  searchConsoleAccount: z
    .string()
    .min(1, 'Search Console account is required')
    .optional(),
  searchConsoleSite: z
    .string()
    .min(1, 'Search Console site is required')
    .optional(),
  keywords: z.string().min(1, 'Keywords are required').optional(),
  status: z.enum(['ACTIVE', 'PAUSED']).optional(),
});

export const campaignsRouter = router({
  // Create a new campaign
  createCampaign: adminProcedure
    .input(createCampaignSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        // Verify the user exists
        const user = await prisma.user.findUnique({
          where: { id: input.userId },
        });

        if (!user) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'User not found',
          });
        }

        // Verify the Google account exists
        const googleAccount = await prisma.googleAccount.findUnique({
          where: { id: input.googleAccountId },
        });

        if (!googleAccount) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Google account not found',
          });
        }

        // Create the campaign
        const campaign = await prisma.campaign.create({
          data: {
            name: input.name,
            startingDate: input.startingDate,
            searchConsoleAccount: input.searchConsoleAccount,
            searchConsoleSite: input.searchConsoleSite,
            keywords: input.keywords,
            userId: input.userId,
            googleAccountId: input.googleAccountId,
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            googleAccount: {
              select: {
                id: true,
                accountName: true,
                email: true,
              },
            },
          },
        });

        return campaign;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create campaign',
        });
      }
    }),

  // Get all campaigns with pagination and filtering
  getCampaigns: adminProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(10),
        search: z.string().optional(),
        statusFilter: z
          .enum(['all', 'ACTIVE', 'PAUSED'])
          .default('all'),
        userId: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const { page, limit, search, statusFilter, userId } = input;
        const skip = (page - 1) * limit;

        // Build where clause
        const where: any = {};

        if (search) {
          where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { searchConsoleSite: { contains: search, mode: 'insensitive' } },
          ];
        }

        if (statusFilter !== 'all') {
          where.status = statusFilter;
        }

        if (userId) {
          where.userId = userId;
        }

        // Get campaigns with pagination
        const [campaigns, total] = await Promise.all([
          prisma.campaign.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
              googleAccount: {
                select: {
                  id: true,
                  accountName: true,
                  email: true,
                },
              },
            },
          }),
          prisma.campaign.count({ where }),
        ]);

        return {
          campaigns,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch campaigns',
        });
      }
    }),

  // Get a single campaign by ID
  getCampaign: adminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      try {
        const campaign = await prisma.campaign.findUnique({
          where: { id: input.id },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            googleAccount: {
              select: {
                id: true,
                accountName: true,
                email: true,
              },
            },
          },
        });

        if (!campaign) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found',
          });
        }

        return campaign;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch campaign',
        });
      }
    }),

  // Update a campaign
  updateCampaign: adminProcedure
    .input(updateCampaignSchema)
    .mutation(async ({ input }) => {
      try {
        const { id, ...updateData } = input;

        // Check if campaign exists
        const existingCampaign = await prisma.campaign.findUnique({
          where: { id },
        });

        if (!existingCampaign) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found',
          });
        }

        // Update the campaign
        const campaign = await prisma.campaign.update({
          where: { id },
          data: updateData,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            googleAccount: {
              select: {
                id: true,
                accountName: true,
                email: true,
              },
            },
          },
        });

        return campaign;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update campaign',
        });
      }
    }),

  // Delete a campaign
  deleteCampaign: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      try {
        // Check if campaign exists
        const existingCampaign = await prisma.campaign.findUnique({
          where: { id: input.id },
        });

        if (!existingCampaign) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found',
          });
        }

        // Delete the campaign
        await prisma.campaign.delete({
          where: { id: input.id },
        });

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete campaign',
        });
      }
    }),

  // Get campaigns by user ID
  getCampaignsByUser: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input }) => {
      try {
        const campaigns = await prisma.campaign.findMany({
          where: { userId: input.userId },
          orderBy: { createdAt: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            googleAccount: {
              select: {
                id: true,
                accountName: true,
                email: true,
              },
            },
          },
        });

        return campaigns;
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch user campaigns',
        });
      }
    }),

  // Toggle campaign status (ACTIVE <-> PAUSED)
  toggleCampaignStatus: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      try {
        // Check if campaign exists
        const existingCampaign = await prisma.campaign.findUnique({
          where: { id: input.id },
        });

        if (!existingCampaign) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found',
          });
        }

        // Toggle the status
        const newStatus = existingCampaign.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';

        // Update the campaign status
        const campaign = await prisma.campaign.update({
          where: { id: input.id },
          data: { status: newStatus },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            googleAccount: {
              select: {
                id: true,
                accountName: true,
                email: true,
              },
            },
          },
        });

        return campaign;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to toggle campaign status',
        });
      }
    }),
});
