import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface SearchConsoleSite {
  siteUrl: string;
  permissionLevel: string;
}

export class SearchConsoleService {
  private oauth2Client: any;

  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI ||
        'http://localhost:3001/auth/google/callback'
    );
  }

  async getSitesForAccount(accountId: string): Promise<SearchConsoleSite[]> {
    try {
      // Get the Google account from database
      const account = await prisma.googleAccount.findUnique({
        where: { id: accountId },
      });

      if (!account) {
        throw new Error('Google account not found');
      }

      if (!account.isActive) {
        throw new Error('Google account is not active');
      }

      // Check if token is expired
      if (new Date(account.expiresAt) < new Date()) {
        // Refresh the token
        await this.refreshToken(account);
      }

      // Set credentials
      this.oauth2Client.setCredentials({
        access_token: account.accessToken,
        refresh_token: account.refreshToken,
      });

      // Create Search Console API client
      const searchConsole = google.searchconsole({
        version: 'v1',
        auth: this.oauth2Client,
      });

      // Get sites
      const response = await searchConsole.sites.list();

      if (!response.data.siteEntry) {
        return [];
      }

      return response.data.siteEntry.map((site: any) => ({
        siteUrl: site.siteUrl,
        permissionLevel: site.permissionLevel,
      }));
    } catch (error) {
      console.error('Error fetching Search Console sites:', error);
      throw new Error('Failed to fetch Search Console sites');
    }
  }

  async getAllSites(): Promise<
    {
      accountId: string;
      accountName: string;
      accountEmail: string;
      sites: SearchConsoleSite[];
    }[]
  > {
    try {
      // Get all active Google accounts
      const accounts = await prisma.googleAccount.findMany({
        where: { isActive: true },
        select: {
          id: true,
          accountName: true,
          email: true,
          accessToken: true,
          refreshToken: true,
          expiresAt: true,
        },
      });

      const results = [];

      for (const account of accounts) {
        try {
          // Check if token is expired
          if (new Date(account.expiresAt) < new Date()) {
            // Refresh the token
            await this.refreshToken(account);
          }

          // Set credentials
          this.oauth2Client.setCredentials({
            access_token: account.accessToken,
            refresh_token: account.refreshToken,
          });

          // Create Search Console API client
          const searchConsole = google.searchconsole({
            version: 'v1',
            auth: this.oauth2Client,
          });

          // Get sites
          const response = await searchConsole.sites.list();

          if (response.data.siteEntry) {
            const sites = response.data.siteEntry.map((site: any) => ({
              siteUrl: site.siteUrl,
              permissionLevel: site.permissionLevel,
            }));

            results.push({
              accountId: account.id,
              accountName: account.accountName,
              accountEmail: account.email,
              sites,
            });
          }
        } catch (error) {
          console.error(
            `Error fetching sites for account ${account.accountName}:`,
            error
          );
          // Continue with other accounts even if one fails
        }
      }

      return results;
    } catch (error) {
      console.error('Error fetching all Search Console sites:', error);
      throw new Error('Failed to fetch Search Console sites');
    }
  }

  private async refreshToken(account: any): Promise<void> {
    try {
      this.oauth2Client.setCredentials({
        refresh_token: account.refreshToken,
      });

      const { credentials } = await this.oauth2Client.refreshAccessToken();

      // Update account with new tokens
      await prisma.googleAccount.update({
        where: { id: account.id },
        data: {
          accessToken: credentials.access_token!,
          refreshToken: credentials.refresh_token || account.refreshToken,
          expiresAt: new Date(credentials.expiry_date!),
          isActive: true,
        },
      });

      // Update the account object for this request
      account.accessToken = credentials.access_token!;
      account.refreshToken = credentials.refresh_token || account.refreshToken;
      account.expiresAt = new Date(credentials.expiry_date!);
    } catch (error) {
      console.error('Error refreshing token:', error);
      throw new Error('Failed to refresh access token');
    }
  }
}

export const searchConsoleService = new SearchConsoleService();
