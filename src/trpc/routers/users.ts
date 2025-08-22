import { z } from 'zod';
import { router, protectedProcedure, adminProcedure } from '../context';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../utils/auth';
import { sendTemporaryPassword } from '../../utils/email';

const prisma = new PrismaClient();

export const usersRouter = router({
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
    }),

  updateUserStatus: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        status: z.enum(['ACTIVE', 'INACTIVE']),
      })
    )
    .mutation(async ({ input, ctx }) => {
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
    }),

  deleteUser: adminProcedure
    .input(
      z.object({
        userId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Prevent admin from deleting their own account
      if (ctx.user?.id === input.userId) {
        throw new Error('You cannot delete your own account');
      }

      await prisma.user.delete({
        where: { id: input.userId },
      });

      return { success: true };
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
});
