import { z } from 'zod';
import { router, protectedProcedure } from '../trpc-context';
import { TRPCError } from '@trpc/server';
import { PrismaClient } from '@prisma/client';
import type { TRPCContext } from '../trpc-context';

const prisma = new PrismaClient();

export const settingsRouter = router({
  // Get user settings
  getUserSettings: protectedProcedure.query(async ({ ctx }) => {
    const { user } = ctx;

    try {
      let userSettings = await prisma.userSettings.findUnique({
        where: { userId: user.id },
      });

      // If no settings exist, create default settings
      if (!userSettings) {
        userSettings = await prisma.userSettings.create({
          data: {
            userId: user.id,
            enableNotifications: true,
            notificationSound: true,
            doNotDisturbMode: false,
            emailNotifications: true,
            systemLanguage: 'en',
            systemTheme: 'dark',
          },
        });
      }

      return userSettings;
    } catch (error) {
      console.error('Error fetching user settings:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch user settings',
      });
    }
  }),

  // Update user settings
  updateUserSettings: protectedProcedure
    .input(
      z.object({
        enableNotifications: z.boolean().optional(),
        notificationSound: z.boolean().optional(),
        doNotDisturbMode: z.boolean().optional(),
        emailNotifications: z.boolean().optional(),
        systemLanguage: z.string().optional(),
        systemTheme: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { user } = ctx;

      try {
        // Upsert user settings
        const updatedSettings = await prisma.userSettings.upsert({
          where: { userId: user.id },
          update: {
            ...input,
            updatedAt: new Date(),
          },
          create: {
            userId: user.id,
            enableNotifications: input.enableNotifications ?? true,
            notificationSound: input.notificationSound ?? true,
            doNotDisturbMode: input.doNotDisturbMode ?? false,
            emailNotifications: input.emailNotifications ?? true,
            systemLanguage: input.systemLanguage ?? 'en',
            systemTheme: input.systemTheme ?? 'dark',
          },
        });

        return updatedSettings;
      } catch (error) {
        console.error('Error updating user settings:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update user settings',
        });
      }
    }),

  // Update notification preferences
  updateNotificationPreferences: protectedProcedure
    .input(
      z.object({
        enableNotifications: z.boolean(),
        notificationSound: z.boolean(),
        doNotDisturbMode: z.boolean(),
        emailNotifications: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { user } = ctx;

      try {
        const updatedSettings = await prisma.userSettings.upsert({
          where: { userId: user.id },
          update: {
            enableNotifications: input.enableNotifications,
            notificationSound: input.notificationSound,
            doNotDisturbMode: input.doNotDisturbMode,
            emailNotifications: input.emailNotifications,
            updatedAt: new Date(),
          },
          create: {
            userId: user.id,
            enableNotifications: input.enableNotifications,
            notificationSound: input.notificationSound,
            doNotDisturbMode: input.doNotDisturbMode,
            emailNotifications: input.emailNotifications,
            systemLanguage: 'en',
            systemTheme: 'dark',
          },
        });

        return updatedSettings;
      } catch (error) {
        console.error('Error updating notification preferences:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update notification preferences',
        });
      }
    }),

  // Update language preference
  updateLanguagePreference: protectedProcedure
    .input(
      z.object({
        systemLanguage: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { user } = ctx;

      try {
        const updatedSettings = await prisma.userSettings.upsert({
          where: { userId: user.id },
          update: {
            systemLanguage: input.systemLanguage,
            updatedAt: new Date(),
          },
          create: {
            userId: user.id,
            systemLanguage: input.systemLanguage,
            enableNotifications: true,
            notificationSound: true,
            doNotDisturbMode: false,
            emailNotifications: true,
            systemTheme: 'dark',
          },
        });

        return updatedSettings;
      } catch (error) {
        console.error('Error updating language preference:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update language preference',
        });
      }
    }),

  // Update theme preference
  updateThemePreference: protectedProcedure
    .input(
      z.object({
        systemTheme: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { user } = ctx;

      try {
        const updatedSettings = await prisma.userSettings.upsert({
          where: { userId: user.id },
          update: {
            systemTheme: input.systemTheme,
            updatedAt: new Date(),
          },
          create: {
            userId: user.id,
            systemTheme: input.systemTheme,
            enableNotifications: true,
            notificationSound: true,
            doNotDisturbMode: false,
            emailNotifications: true,
            systemLanguage: 'en',
          },
        });

        return updatedSettings;
      } catch (error) {
        console.error('Error updating theme preference:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update theme preference',
        });
      }
    }),
});