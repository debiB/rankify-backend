import { z } from 'zod';
import { router, adminProcedure } from '../trpc-context';
import { PrismaClient } from '@prisma/client';
import { google } from 'googleapis';
import { searchConsoleService } from '../../services/searchConsole';
import { TRPCError } from '@trpc/server';

const prisma = new PrismaClient();

export const googleAccountsRouter = router({
  getAccounts: adminProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(10),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const { page, limit, search } = input;
      const skip = (page - 1) * limit;

      // Build where clause for filtering
      const where: any = {};

      if (search) {
        where.OR = [
          { email: { contains: search } },
          { accountName: { contains: search } },
        ];
      }

      // Get total count for pagination
      const totalCount = await prisma.googleAccount.count({ where });

      // Get paginated accounts
      const accounts = await prisma.googleAccount.findMany({
        where,
        select: {
          id: true,
          email: true,
          accountName: true,
          isActive: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      });

      return {
        accounts,
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

  updateAccount: adminProcedure
    .input(
      z.object({
        id: z.string(),
        accountName: z.string().min(1).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...updateData } = input;

      // If trying to activate account, check if refresh token is valid
      if (updateData.isActive === true) {
        const existingAccount = await prisma.googleAccount.findUnique({
          where: { id },
        });

        if (!existingAccount) {
          throw new Error('Account not found');
        }

        // Test if refresh token is valid by attempting to refresh
        try {
          const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI ||
              'http://localhost:3001/auth/google/callback'
          );

          oauth2Client.setCredentials({
            refresh_token: existingAccount.refreshToken,
          });

          // Try to refresh the token to validate it
          await oauth2Client.refreshAccessToken();
        } catch (error: any) {
          // If refresh token is invalid, don't allow activation
          if (error?.response?.data?.error === 'invalid_grant') {
            throw new Error(
              `Cannot activate account: Refresh token is invalid. Please reconnect your Google account first.`
            );
          }
          // For other errors, still allow activation (might be temporary network issues)
        }
      }

      const account = await prisma.googleAccount.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          email: true,
          accountName: true,
          isActive: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return account;
    }),

  deleteAccount: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.googleAccount.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),

  refreshToken: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      let account: any = null;

      try {
        account = await prisma.googleAccount.findUnique({
          where: { id: input.id },
        });

        if (!account) {
          throw new Error('Account not found');
        }

        // Create OAuth2 client
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI ||
            'http://localhost:3001/auth/google/callback'
        );

        // Set credentials with refresh token
        oauth2Client.setCredentials({
          refresh_token: account.refreshToken,
        });

        // Refresh the token
        const { credentials } = await oauth2Client.refreshAccessToken();

        // Update account with new tokens
        await prisma.googleAccount.update({
          where: { id: input.id },
          data: {
            accessToken: credentials.access_token!,
            refreshToken: credentials.refresh_token || account.refreshToken,
            expiresAt: new Date(credentials.expiry_date!),
            isActive: true,
          },
        });

        return { success: true, message: 'Token refreshed successfully' };
      } catch (error: any) {
        console.error('Token refresh error:', error);

        // Check if it's an invalid_grant error (refresh token is invalid)
        if (error?.response?.data?.error === 'invalid_grant' && account) {
          console.log(
            `Refresh token invalid for account ${account.email}. Marking as needing re-authentication.`
          );

          // Mark account as needing re-authentication
          await prisma.googleAccount.update({
            where: { id: input.id },
            data: {
              isActive: false,
            },
          });

          // Get OAuth URL for re-authentication
          const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI ||
              'http://localhost:3001/auth/google/callback'
          );

          const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: [
              'https://www.googleapis.com/auth/webmasters',
              'https://www.googleapis.com/auth/webmasters.readonly',
              'https://www.googleapis.com/auth/userinfo.email',
              'https://www.googleapis.com/auth/userinfo.profile',
            ],
            prompt: 'consent', // Force consent to get refresh token
          });

          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `REAUTH_REQUIRED|${authUrl}|Google account ${account.email} needs to be re-authenticated.`,
          });
        }

        throw new Error('Failed to refresh token');
      }
    }),

  getOAuthUrl: adminProcedure.query(async () => {
    try {
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        throw new Error(
          'Google OAuth not configured. Please set up GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'
        );
      }

      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI ||
          'http://localhost:3001/auth/google/callback'
      );

      const SCOPES = [
        'https://www.googleapis.com/auth/webmasters',
        'https://www.googleapis.com/auth/webmasters.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
      ];

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent', // Force consent to get refresh token
      });

      return { authUrl };
    } catch (error) {
      console.error('Error generating OAuth URL:', error);
      throw new Error('Failed to generate OAuth URL');
    }
  }),

  getSearchConsoleSites: adminProcedure.query(async () => {
    try {
      const sites = await searchConsoleService.getAllSites();
      return sites;
    } catch (error) {
      console.error('Error fetching Search Console sites:', error);
      throw new Error('Failed to fetch Search Console sites');
    }
  }),

  testAccount: adminProcedure
    .input(z.object({ accountId: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const account = await prisma.googleAccount.findUnique({
          where: { id: input.accountId },
        });

        if (!account) {
          throw new Error('Account not found');
        }

        // Test the account by trying to authenticate and get Search Console sites
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI ||
            'http://localhost:3001/auth/google/callback'
        );

        oauth2Client.setCredentials({
          refresh_token: account.refreshToken,
        });

        // Try to refresh the token to validate it
        const { credentials } = await oauth2Client.refreshAccessToken();

        // Create Search Console API client
        const searchConsole = google.searchconsole({
          version: 'v1',
          auth: oauth2Client,
        });

        // Get sites to test the connection
        const response = await searchConsole.sites.list();
        const sites = response.data.siteEntry || [];

        return {
          success: true,
          message: `Account connection successful. Found ${sites.length} Search Console sites.`,
          sitesCount: sites.length,
          sites: sites.slice(0, 5).map((site: any) => ({
            siteUrl: site.siteUrl,
            permissionLevel: site.permissionLevel,
          })), // Return first 5 sites as preview
        };
      } catch (error: any) {
        console.error('Error testing Google account:', error);

        // Provide more specific error messages
        if (error?.response?.data?.error === 'invalid_grant') {
          throw new Error(
            'Account needs to be re-authenticated. Please reconnect your Google account.'
          );
        } else if (error?.response?.data?.error === 'insufficient_permission') {
          throw new Error(
            'Account does not have sufficient permissions for Search Console access.'
          );
        } else if (error?.response?.status === 401) {
          throw new Error(
            'Authentication failed. Please check your account credentials.'
          );
        } else if (error?.response?.status === 403) {
          throw new Error(
            'Access denied. Please ensure the account has Search Console access.'
          );
        } else {
          throw new Error(
            `Connection test failed: ${error.message || 'Unknown error'}`
          );
        }
      }
    }),
});
