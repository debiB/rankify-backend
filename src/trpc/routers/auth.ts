import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '../trpc-context';
import { PrismaClient } from '@prisma/client';
import { hashPassword, comparePassword, generateToken } from '../../utils/auth';

const prisma = new PrismaClient();

export const authRouter = router({
  register: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(6),
        name: z.string().optional(),
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

        const hashedPassword = await hashPassword(input.password);

        const user = await prisma.user.create({
          data: {
            email: input.email,
            password: hashedPassword,
            name: input.name,
            role: 'USER',
            status: 'ACTIVE',
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

        const token = generateToken(user.id);

        return { user, token };
      } catch (error) {
        console.error('Registration error:', error);
        if (error instanceof Error && error.message === 'User already exists') {
          throw error;
        }
        throw new Error('Failed to register user. Please try again.');
      }
    }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const user = await prisma.user.findUnique({
          where: { email: input.email },
        });

        if (!user) {
          throw new Error('Invalid credentials');
        }

        const isValidPassword = await comparePassword(
          input.password,
          user.password
        );

        if (!isValidPassword) {
          throw new Error('Invalid credentials');
        }

        const token = generateToken(user.id);

        return {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            status: user.status,
            hasChangedPassword: user.hasChangedPassword,
            createdAt: user.createdAt,
          },
          token,
        };
      } catch (error) {
        console.error('Login error:', error);
        if (error instanceof Error && error.message === 'Invalid credentials') {
          throw error;
        }
        throw new Error('Failed to login. Please try again.');
      }
    }),

  getProfile: protectedProcedure.query(async ({ ctx }) => {
    return ctx.user;
  }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, 'Name is required'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const user = await prisma.user.update({
          where: { id: ctx.user.id },
          data: {
            name: input.name,
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
      } catch (error) {
        console.error('Update profile error:', error);
        throw new Error('Failed to update profile. Please try again.');
      }
    }),

  getAccountInfo: protectedProcedure.query(async ({ ctx }) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: {
          id: true,
          email: true,
          name: true,
          firstName: true,
          lastName: true,
          phoneNumber: true,
          countryCode: true,
          role: true,
          status: true,
          hasChangedPassword: true,
          createdAt: true,
        },
      });

      if (!user) {
        throw new Error('User not found');
      }

      return user;
    } catch (error) {
      console.error('Get account info error:', error);
      if (error instanceof Error && error.message === 'User not found') {
        throw error;
      }
      throw new Error('Failed to get account information. Please try again.');
    }
  }),

  updateAccountInfo: protectedProcedure
    .input(
      z.object({
        firstName: z.string().optional().nullable(),
        lastName: z.string().optional().nullable(),
        email: z.string().email().optional(),
        phoneNumber: z.string().optional().nullable(),
        countryCode: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // Check if email is being changed and if it's already taken
        if (input.email) {
          const existingUser = await prisma.user.findFirst({
            where: {
              email: input.email,
              NOT: { id: ctx.user.id },
            },
          });
          
          if (existingUser) {
            throw new Error('Email is already in use by another account');
          }
        }

        // Filter out undefined values and convert empty strings to null
        const updateData: any = {};
        if (input.firstName !== undefined) updateData.firstName = input.firstName || null;
        if (input.lastName !== undefined) updateData.lastName = input.lastName || null;
        if (input.email !== undefined) updateData.email = input.email;
        if (input.phoneNumber !== undefined) updateData.phoneNumber = input.phoneNumber || null;
        if (input.countryCode !== undefined) updateData.countryCode = input.countryCode || null;

        const user = await prisma.user.update({
          where: { id: ctx.user.id },
          data: updateData,
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
      } catch (error) {
        console.error('Update account info error:', error);
        if (error instanceof Error && error.message === 'Email is already in use by another account') {
          throw error;
        }
        throw new Error('Failed to update account information. Please try again.');
      }
    }),

  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string(),
        newPassword: z.string().min(6),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const user = await prisma.user.findUnique({
          where: { id: ctx.user.id },
        });

        if (!user) {
          throw new Error('User not found');
        }

        const isValidPassword = await comparePassword(
          input.currentPassword,
          user.password
        );

        if (!isValidPassword) {
          throw new Error('Current password is incorrect');
        }

        const hashedNewPassword = await hashPassword(input.newPassword);

        await prisma.user.update({
          where: { id: ctx.user.id },
          data: {
            password: hashedNewPassword,
            hasChangedPassword: true,
          },
        });

        return { success: true };
      } catch (error) {
        console.error('Change password error:', error);
        if (error instanceof Error && (error.message === 'User not found' || error.message === 'Current password is incorrect')) {
          throw error;
        }
        throw new Error('Failed to change password. Please try again.');
      }
    }),
});