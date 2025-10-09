import { router, publicProcedure } from '../trpc-context';
import { keywordAnalysisService } from '../../services/keywordAnalysisService';
import { z } from 'zod';

export const keywordAnalysisRouter = router({
  /**
   * Submit a keyword for analysis
   * POST /keyword/analyze
   */
  analyze: publicProcedure
    .input(z.object({
      keyword: z.string().min(1, 'Keyword is required'),
      campaignId: z.string().optional()
    }))
    .mutation(async ({ input }) => {
      try {
        const analysisId = await keywordAnalysisService.analyzeKeyword(
          input.keyword,
          input.campaignId
        );
        
        return {
          success: true,
          analysisId,
          message: 'Keyword analysis completed successfully'
        };
      } catch (error) {
        console.error('Error in analyzeKeyword procedure:', error);
        throw new Error(error instanceof Error ? error.message : 'Failed to analyze keyword');
      }
    }),
    
  /**
   * Retrieve stored analysis by ID
   * GET /keyword/analysis/:id
   */
  getById: publicProcedure
    .input(z.object({
      id: z.string().min(1, 'Analysis ID is required')
    }))
    .query(async ({ input }) => {
      try {
        const analysis = await keywordAnalysisService.getAnalysisById(input.id);
        
        return {
          success: true,
          data: analysis
        };
      } catch (error) {
        console.error('Error in getAnalysisById procedure:', error);
        throw new Error(error instanceof Error ? error.message : 'Failed to retrieve analysis');
      }
    })
});