import { z } from 'zod';
import { router, protectedProcedure, adminProcedure } from '../trpc-context';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../utils/auth';
import { sendTemporaryPassword } from '../../utils/email';
import { inferRouterOutputs } from '@trpc/server';

const prisma = new PrismaClient();

export const usersRouter = router({
  // Get user statistics for admin dashboard
  getUserStats: adminProcedure.query(async () => {
    try {
      const [totalUsers, activeUsers, inactiveUsers, adminUsers] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { status: 'ACTIVE' } }),
        prisma.user.count({ where: { status: 'INACTIVE' } }),
        prisma.user.count({ where: { role: 'ADMIN' } }),
      ]);

      return {
        totalUsers,
        activeUsers,
        inactiveUsers,
        adminUsers,
      };
    } catch (error) {
      throw new Error('Failed to fetch user statistics');
    }
  }),

  getUsers: adminProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(10),
        search: z.string().optional(),
        roleFilter: z.enum(['all', 'ADMIN', 'USER']).default('all'),
        statusFilter: z.enum(['all', 'ACTIVE', 'INACTIVE']).default('all'),
      })
    )
    .query(async ({ input }) => {
      try {
        const { page, limit, search, roleFilter, statusFilter } = input;
        const skip = (page - 1) * limit;

        // Build where clause for filtering
        const where: any = {};

        if (search) {
          where.OR = [
            { email: { contains: search } },
            { name: { contains: search } },
          ];
        }

        if (roleFilter !== 'all') {
          where.role = roleFilter;
        }

        if (statusFilter !== 'all') {
          where.status = statusFilter;
        }

        // Get total count for pagination
        const totalCount = await prisma.user.count({ where });

        // Get paginated users
        const users = await prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
            createdAt: true,
          },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        });

        return {
          users,
          pagination: {
            page,
            limit,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
            hasNextPage: page < Math.ceil(totalCount / limit),
            hasPrevPage: page > 1,
          },
        };
      } catch (error) {
        console.error('Get users error:', error);
        throw new Error('Failed to fetch users. Please try again.');
      }
    }),

  createUser: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        name: z.string(),
        role: z.enum(['ADMIN', 'USER']),
        status: z.enum(['ACTIVE', 'INACTIVE']),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const existingUser = await prisma.user.findUnique({
          where: { email: input.email },
        });

        if (existingUser) {
          throw new Error('User already exists');
        }

        // Generate a temporary password
        const tempPassword =
          Math.random().toString(36).slice(-8) +
          Math.random().toString(36).slice(-8);
        const hashedPassword = await hashPassword(tempPassword);

        const user = await prisma.user.create({
          data: {
            email: input.email,
            password: hashedPassword,
            name: input.name,
            role: input.role,
            status: input.status,
            hasChangedPassword: false,
          },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
            hasChangedPassword: true,
            createdAt: true,
          },
        });

        // Send email with temporary password
        try {
          await sendTemporaryPassword(
            user.email,
            user.name || 'User',
            tempPassword
          );
        } catch (error) {
          console.error('Failed to send email:', error);
          // Don't fail the user creation if email fails
        }

        return user;
      } catch (error) {
        console.error('Create user error:', error);
        if (error instanceof Error && error.message === 'User already exists') {
          throw error;
        }
        throw new Error('Failed to create user. Please try again.');
      }
    }),

  updateUser: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        name: z.string(),
        email: z.string().email(),
        role: z.enum(['ADMIN', 'USER']),
        status: z.enum(['ACTIVE', 'INACTIVE']),
      })
    )
    .mutation(async ({ input }) => {
      try {
        // Check if email is already taken by another user
        const existingUser = await prisma.user.findFirst({
          where: {
            email: input.email,
            id: { not: input.userId },
          },
        });

        if (existingUser) {
          throw new Error('Email is already taken by another user');
        }

        const user = await prisma.user.update({
          where: { id: input.userId },
          data: {
            name: input.name,
            email: input.email,
            role: input.role,
            status: input.status,
          },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
            createdAt: true,
          },
        });

        return user;
      } catch (error) {
        console.error('Update user error:', error);
        if (error instanceof Error && error.message === 'Email is already taken by another user') {
          throw error;
        }
        throw new Error('Failed to update user. Please try again.');
      }
    }),

  updateUserStatus: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        status: z.enum(['ACTIVE', 'INACTIVE']),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // Prevent admin from deactivating their own account
        if (ctx.user?.id === input.userId && input.status === 'INACTIVE') {
          throw new Error('You cannot deactivate your own account');
        }

        const user = await prisma.user.update({
          where: { id: input.userId },
          data: { status: input.status },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
            createdAt: true,
          },
        });

        return user;
      } catch (error) {
        console.error('Update user status error:', error);
        if (error instanceof Error && error.message === 'You cannot deactivate your own account') {
          throw error;
        }
        throw new Error('Failed to update user status. Please try again.');
      }
    }),

  deleteUser: adminProcedure
    .input(
      z.object({
        userId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // Prevent admin from deleting their own account
        if (ctx.user?.id === input.userId) {
          throw new Error('You cannot delete your own account');
        }

        await prisma.user.delete({
          where: { id: input.userId },
        });

        return { success: true };
      } catch (error) {
        console.error('Delete user error:', error);
        if (error instanceof Error && error.message === 'You cannot delete your own account') {
          throw error;
        }
        throw new Error('Failed to delete user. Please try again.');
      }
    }),

  changePassword: protectedProcedure
    .input(
      z.object({
        newPassword: z
          .string()
          .min(6, 'Password must be at least 6 characters long'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const hashedPassword = await hashPassword(input.newPassword);

      const user = await prisma.user.update({
        where: { id: ctx.user!.id },
        data: {
          password: hashedPassword,
          hasChangedPassword: true,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          hasChangedPassword: true,
          createdAt: true,
        },
      });

      return user;
    }),

  resetUserPassword: adminProcedure
    .input(
      z.object({
        userId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      // Get the user to reset password for
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
        },
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Generate a temporary password
      const tempPassword =
        Math.random().toString(36).slice(-8) +
        Math.random().toString(36).slice(-8);
      const hashedPassword = await hashPassword(tempPassword);

      // Update the user's password
      await prisma.user.update({
        where: { id: input.userId },
        data: {
          password: hashedPassword,
          hasChangedPassword: false, // Reset this flag so user must change password
        },
      });

      // Send email with temporary password
      try {
        await sendTemporaryPassword(
          user.email,
          user.name || 'User',
          tempPassword
        );
      } catch (error) {
        console.error('Failed to send email:', error);
        // Don't fail the password reset if email fails
      }

      return {
        success: true,
        tempPassword,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      };
    }),

  // Map user to campaigns for email notifications
  setCampaignEmailPreferences: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        campaignIds: z.array(z.string()),
      })
    )
    .mutation(async ({ input }) => {
      const { userId, campaignIds } = input;

      // Verify user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Remove existing email preferences for this user
      await prisma.userCampaignEmailPreference.deleteMany({
        where: { userId },
      });

      // Add new email preferences
      const emailPreferences = [];
      for (const campaignId of campaignIds) {
        // Verify campaign exists
        const campaign = await prisma.campaign.findUnique({
          where: { id: campaignId },
        });

        if (campaign) {
          emailPreferences.push({
            userId,
            campaignId,
            isActive: true,
          });
        }
      }

      if (emailPreferences.length > 0) {
        await prisma.userCampaignEmailPreference.createMany({
          data: emailPreferences,
        });
      }

      return {
        success: true,
        data: {
          userId,
          campaignsAssigned: emailPreferences.length,
        },
      };
    }),

  // Get campaigns assigned to a user for email notifications
  getCampaignEmailPreferences: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input }) => {
      const { userId } = input;

      const userCampaigns = await prisma.userCampaignEmailPreference.findMany({
        where: { 
          userId,
          isActive: true,
        },
        include: {
          campaign: true,
        },
      });

      const campaigns = userCampaigns.map((uc: any) => ({
        id: uc.campaign.id,
        name: uc.campaign.name,
        status: uc.campaign.status,
        startingDate: uc.campaign.startingDate,
      }));

      return {
        success: true,
        data: campaigns,
      };
    }),

  // Get all users (for admin dropdown)
  getAllUsers: adminProcedure.query(async () => {
    const users = await prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return {
      success: true,
      data: users,
    };
  }),

  // Get user notification preferences
  getNotificationPreferences: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input, ctx }) => {
      const { userId } = input;

      // Only allow users to get their own preferences or admins to get any user's preferences
      if (ctx.user?.role !== 'ADMIN' && ctx.user?.id !== userId) {
        throw new Error('Unauthorized');
      }

      const preferences = await prisma.userNotificationPreferences.findUnique({
        where: { userId },
      });

      // If no preferences exist, return defaults
      if (!preferences) {
        return {
          success: true,
          data: {
            enableEmail: true,
            enableWhatsApp: true,
            enableAllNotifications: true,
          },
        };
      }

      return {
        success: true,
        data: {
          enableEmail: preferences.enableEmail,
          enableWhatsApp: preferences.enableWhatsApp,
          enableAllNotifications: preferences.enableAllNotifications,
        },
      };
    }),

  // Set user notification preferences
  setNotificationPreferences: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        enableEmail: z.boolean(),
        enableWhatsApp: z.boolean(),
        enableAllNotifications: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { userId, enableEmail, enableWhatsApp, enableAllNotifications } = input;

      // Only allow users to update their own preferences or admins to update any user's preferences
      if (ctx.user?.role !== 'ADMIN' && ctx.user?.id !== userId) {
        throw new Error('Unauthorized');
      }

      // Verify user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Upsert notification preferences
      const preferences = await prisma.userNotificationPreferences.upsert({
        where: { userId },
        update: {
          enableEmail,
          enableWhatsApp,
          enableAllNotifications,
        },
        create: {
          userId,
          enableEmail,
          enableWhatsApp,
          enableAllNotifications,
        },
      });

      return {
        success: true,
        data: {
          enableEmail: preferences.enableEmail,
          enableWhatsApp: preferences.enableWhatsApp,
          enableAllNotifications: preferences.enableAllNotifications,
        },
      };
    }),
});
