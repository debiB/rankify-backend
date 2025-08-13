import { google, webmasters_v3 } from 'googleapis';
import { PrismaClient, GoogleAccount, Campaign } from '@prisma/client';
import moment from 'moment-timezone';

const MAX_SEARCH_CONSOLE_ROWS = 25000;
const QUOTA_MAX_RETRIES = 3;
const QUOTA_SHORT_TERM_QUOTA_WAIT = 15 * 60 * 1000; // 15 minutes in milliseconds

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

      await this.authenticate(account);

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
      });

      const results = [];

      for (const account of accounts) {
        try {
          await this.authenticate(account);

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

  async getAnalytics({
    campaign,
    googleAccount,
    waitForAllData = false,
    startAt,
    endAt,
    dimensions,
  }: {
    campaign: Campaign;
    googleAccount: GoogleAccount;
    waitForAllData?: boolean;
    startAt?: moment.Moment;
    endAt?: moment.Moment;
    dimensions?: webmasters_v3.Schema$SearchAnalyticsQueryRequest['dimensions'];
  }): Promise<webmasters_v3.Schema$ApiDataRow[] | null> {
    try {
      if (!googleAccount) {
        throw new Error('Google account not found');
      }

      await this.authenticate(googleAccount);

      const webmasters = google.webmasters({
        version: 'v3',
        auth: this.oauth2Client,
      });

      const rows: webmasters_v3.Schema$ApiDataRow[] = [];
      let startRow = 0;
      let retryCount = 0;

      // Fetch data in chunks
      while (true) {
        try {
          const startDate = startAt
            ? startAt
                .clone()
                .endOf('day')
                .tz('America/Los_Angeles')
                .format('YYYY-MM-DD')
            : moment()
                .endOf('day')
                .tz('America/Los_Angeles')
                .subtract(1, 'month')
                .format('YYYY-MM-DD');
          const endDate = endAt
            ? endAt
                .clone()
                .endOf('day')
                .tz('America/Los_Angeles')
                .format('YYYY-MM-DD')
            : moment()
                .endOf('day')
                .tz('America/Los_Angeles')
                .format('YYYY-MM-DD');

          const response = await webmasters.searchanalytics.query({
            siteUrl: campaign.searchConsoleSite,
            requestBody: {
              startDate, // Pacific time
              endDate, // Pacific time
              dimensions,
              startRow,
              rowLimit: MAX_SEARCH_CONSOLE_ROWS,
            },
          });

          if (
            !response.data ||
            !response.data.rows ||
            !response.data.rows.length
          ) {
            break;
          }

          rows.push(...response.data.rows);

          // If less than max rows, we've reached the end
          if (response.data.rows.length < MAX_SEARCH_CONSOLE_ROWS) {
            break;
          }

          startRow += MAX_SEARCH_CONSOLE_ROWS;
          retryCount = 0; // Reset retry count on successful request

          // Add a small delay between requests to avoid hitting short-term quota
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (error: any) {
          if (
            error.message?.includes('quota') &&
            retryCount < QUOTA_MAX_RETRIES
          ) {
            // If we're not waiting for all data, break the loop
            if (!waitForAllData) break;

            console.error(
              `Quota exceeded. Waiting ${
                QUOTA_SHORT_TERM_QUOTA_WAIT / 1000 / 60
              } minutes before retry ${retryCount + 1}/${QUOTA_MAX_RETRIES}`
            );
            await new Promise((resolve) =>
              setTimeout(resolve, QUOTA_SHORT_TERM_QUOTA_WAIT)
            );
            retryCount++;
            continue;
          }
          throw error;
        }
      }

      return rows;
    } catch (error) {
      console.error('Error fetching Search Console analytics:', error);
      return null;
    }
  }

  private async authenticate(account: GoogleAccount) {
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
    } catch (error) {
      console.error('Error refreshing token:', error);
      throw new Error('Failed to refresh access token');
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
