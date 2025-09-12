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

/**
 * Service for interacting with Google Search Console API
 * 
 * Implementation details:
 * 
 * 1. Date Range Logic:
 *    - Current month: Fetches data from the first day of the current month up to today
 *    - Previous months: Fetches data for the last 7 days of the month only
 *    - This optimizes data retrieval while maintaining relevant insights
 * 
 * 2. Efficient Data Retrieval:
 *    - Fetches data for the entire property at once rather than filtering by specific URLs
 *    - Always includes date dimension to ensure results are broken down by date
 *    - Reduces the number of API calls and improves performance
 * 
 * 3. Aggregation Logic:
 *    - Maintains Google Search Console methodology for aggregating metrics
 *    - For each keyword, selects the page with the highest impressions
 *    - Calculates weighted position based on impressions
 *    - Sums clicks and impressions across matching pages
 *    - Recalculates CTR based on aggregated metrics
 */
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

  /**
   * Get analytics data from Google Search Console
   * 
   * Date range logic:
   * - Current month: Fetch data from the first day of the current month up to today
   * - Previous months: Fetch data for the last 7 days only
   * 
   * @param campaign The campaign to fetch data for
   * @param googleAccount The Google account to use for authentication
   * @param waitForAllData Whether to wait for all data to be fetched (retry on quota errors)
   * @param startAt Optional start date override
   * @param endAt Optional end date override
   * @param dimensions The dimensions to fetch data for
   * @returns The analytics data or null if an error occurred
   */
  async getAnalytics({
    campaign,
    googleAccount,
    waitForAllData = false,
    startAt,
    endAt,
    dimensions,
    exactUrlMatch,
    topRankingPageUrl
  }: {
    campaign: Campaign;
    googleAccount: GoogleAccount;
    waitForAllData?: boolean;
    startAt?: moment.Moment;
    endAt?: moment.Moment;
    dimensions?: webmasters_v3.Schema$SearchAnalyticsQueryRequest['dimensions'];
    exactUrlMatch?: boolean;
    topRankingPageUrl?: string;
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

      // Calculate date ranges based on new requirements
      // If startAt and endAt are provided, use them as overrides
      // Otherwise, apply the new date range logic
      let startDate: string;
      let endDate: string;
      
      if (startAt && endAt) {
        // Use provided date range (override)
        startDate = startAt
          .clone()
          .startOf('day') // Use startOf to include full day
          .tz('America/Los_Angeles')
          .format('YYYY-MM-DD');
        endDate = endAt
          .clone()
          .endOf('day')
          .tz('America/Los_Angeles')
          .format('YYYY-MM-DD');
      } else {
        // Apply new date range logic
        const today = moment().endOf('day').tz('America/Los_Angeles');
        const currentMonth = today.clone().startOf('month');
        const isCurrentMonth = !startAt || (startAt && startAt.isSame(currentMonth, 'month'));
        
        if (isCurrentMonth) {
          // Current month: Fetch from first day of current month to today
          startDate = currentMonth.format('YYYY-MM-DD');
          endDate = today.format('YYYY-MM-DD');
        } else {
          // Previous months: Fetch last 7 days only
          const endOfMonth = startAt ? startAt.clone().endOf('month') : today.clone().subtract(1, 'month').endOf('month');
          startDate = endOfMonth.clone().subtract(6, 'days').format('YYYY-MM-DD'); // 7 days including end date
          endDate = endOfMonth.format('YYYY-MM-DD');
        }
      }
      
      console.log(`Fetching GSC data from ${startDate} to ${endDate}`);
      
      // Fetch data in chunks
      while (true) {
        try {

          // Prepare request body
          const requestBody: webmasters_v3.Schema$SearchAnalyticsQueryRequest = {
            startDate, // Pacific time
            endDate, // Pacific time
            startRow,
            rowLimit: MAX_SEARCH_CONSOLE_ROWS,
          };
          
          // Ensure date dimension is included to break down results by date
          if (dimensions && !dimensions.includes('date')) {
            requestBody.dimensions = ['date', ...dimensions];
          } else if (!dimensions) {
            requestBody.dimensions = ['date'];
          } else {
            requestBody.dimensions = dimensions;
          }
          
          const response = await webmasters.searchanalytics.query({
            siteUrl: campaign.searchConsoleSite,
            requestBody,
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
