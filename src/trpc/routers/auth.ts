import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '../context';
import { PrismaClient } from '@prisma/client';
import { hashPassword, comparePassword, generateToken } from '../../utils/auth';

const prisma = new PrismaClient();

export const authRouter = router({
  register: publicProcedure
    .input(
      z.object({
        email: z.email(),
        password: z.string().min(6),
        name: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
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
    }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      })
    )
    .mutation(async ({ input }) => {
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
    }),

  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string(),
        newPassword: z.string().min(6),
      })
    )
    .mutation(async ({ input, ctx }) => {
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
    }),
});
