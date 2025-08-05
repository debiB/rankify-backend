import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from './context';
import { PrismaClient } from '@prisma/client';
import { hashPassword, comparePassword, generateToken } from '../utils/auth';

const prisma = new PrismaClient();

export const appRouter = router({
  // Public routes
  register: publicProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string().min(6),
      name: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const existingUser = await prisma.user.findUnique({
        where: { email: input.email }
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
        },
        select: { id: true, email: true, name: true, createdAt: true }
      });

      const token = generateToken(user.id);
      
      return { user, token };
    }),

  login: publicProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string(),
    }))
    .mutation(async ({ input }) => {
      const user = await prisma.user.findUnique({
        where: { email: input.email }
      });

      if (!user) {
        throw new Error('Invalid credentials');
      }

      const isValidPassword = await comparePassword(input.password, user.password);
      
      if (!isValidPassword) {
        throw new Error('Invalid credentials');
      }

      const token = generateToken(user.id);
      
      return { 
        user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
        token 
      };
    }),

  // Protected routes
  getProfile: protectedProcedure
    .query(async ({ ctx }) => {
      return ctx.user;
    }),

  getUsers: protectedProcedure
    .query(async () => {
      return await prisma.user.findMany({
        select: { id: true, email: true, name: true, createdAt: true }
      });
    }),
});

export type AppRouter = typeof appRouter; 