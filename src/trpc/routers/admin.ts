import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { adminProcedure, router } from '../context';
import { prisma } from '../../utils/prisma';
import { CronService } from '../../services/cronService';
import * as fs from 'fs';
import * as path from 'path';

export const adminRouter = router({
  // Delete all search console analytics data
  deleteAllSearchData: adminProcedure.mutation(async () => {
    try {
      // Delete all search console related data in the correct order
      // to avoid foreign key constraint violations

      console.log('Starting deletion of all search data...');

      // 1. Delete all monthly stats first (they reference keywords)
      const deletedMonthlyStats =
        await prisma.searchConsoleKeywordMonthlyStat.deleteMany({});
      console.log(`Deleted ${deletedMonthlyStats.count} monthly stats`);

      // 2. Delete all keywords (they reference analytics)
      const deletedKeywords = await prisma.searchConsoleKeyword.deleteMany({});
      console.log(`Deleted ${deletedKeywords.count} keywords`);

      // 3. Delete all analytics records
      const deletedAnalytics =
        await prisma.searchConsoleKeywordAnalytics.deleteMany({});
      console.log(`Deleted ${deletedAnalytics.count} analytics records`);

      const totalDeleted =
        deletedMonthlyStats.count +
        deletedKeywords.count +
        deletedAnalytics.count;

      console.log(`Successfully deleted ${totalDeleted} total records`);

      return {
        success: true,
        deletedRecords: {
          monthlyStats: deletedMonthlyStats.count,
          keywords: deletedKeywords.count,
          analytics: deletedAnalytics.count,
          total: totalDeleted,
        },
      };
    } catch (error) {
      console.error('Error deleting all search data:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to delete search data',
      });
    }
  }),

  // Get system statistics
  getSystemStats: adminProcedure.query(async () => {
    try {
      const [
        totalAnalytics,
        totalKeywords,
        totalMonthlyStats,
        totalCampaigns,
        totalUsers,
      ] = await Promise.all([
        prisma.searchConsoleKeywordAnalytics.count(),
        prisma.searchConsoleKeyword.count(),
        prisma.searchConsoleKeywordMonthlyStat.count(),
        prisma.campaign.count(),
        prisma.user.count(),
      ]);

      return {
        analytics: totalAnalytics,
        keywords: totalKeywords,
        monthlyStats: totalMonthlyStats,
        campaigns: totalCampaigns,
        users: totalUsers,
      };
    } catch (error) {
      console.error('Error getting system stats:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get system statistics',
      });
    }
  }),

  // Export all search console data as JSON
  exportSearchConsoleData: adminProcedure.mutation(async () => {
    try {
      console.log('Starting export of all search console data...');

      // Fetch all search console data with relationships
      const allData = await prisma.searchConsoleKeywordAnalytics.findMany({
        include: {
          keywords: {
            include: {
              monthlyStats: {
                orderBy: [{ year: 'asc' }, { month: 'asc' }],
              },
            },
          },
        },
      });

      // Create export directory if it doesn't exist
      const exportDir = path.join(process.cwd(), 'exports');
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `search-console-data-export-${timestamp}.json`;
      const filepath = path.join(exportDir, filename);

      // Prepare the export data
      const exportData = {
        exportDate: new Date().toISOString(),
        totalAnalytics: allData.length,
        totalKeywords: allData.reduce(
          (sum, analytics) => sum + analytics.keywords.length,
          0
        ),
        totalMonthlyStats: allData.reduce(
          (sum, analytics) =>
            sum +
            analytics.keywords.reduce(
              (kSum, keyword) => kSum + keyword.monthlyStats.length,
              0
            ),
          0
        ),
        data: allData,
      };

      // Write the JSON file
      fs.writeFileSync(filepath, JSON.stringify(exportData, null, 2));

      console.log(`Successfully exported data to: ${filepath}`);

      return {
        success: true,
        filename,
        filepath,
        stats: {
          analytics: exportData.totalAnalytics,
          keywords: exportData.totalKeywords,
          monthlyStats: exportData.totalMonthlyStats,
        },
      };
    } catch (error) {
      console.error('Error exporting search console data:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to export search console data',
      });
    }
  }),

  // Manually trigger monthly analytics job
  triggerMonthlyAnalytics: adminProcedure.mutation(async () => {
    try {
      console.log('Admin triggered monthly analytics job...');
      const cronService = CronService.getInstance();
      await cronService.triggerMonthlyAnalytics();
      
      return { 
        success: true, 
        message: 'Monthly analytics job triggered successfully' 
      };
    } catch (error) {
      console.error('Error triggering monthly analytics job:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to trigger monthly analytics job',
      });
    }
  }),

  // Get cron job status
  getCronStatus: adminProcedure.query(async () => {
    try {
      const cronService = CronService.getInstance();
      return cronService.getCronStatus();
    } catch (error) {
      console.error('Error getting cron status:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get cron status',
      });
    }
  }),
});
