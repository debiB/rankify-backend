import { router, publicProcedure } from '../context';
import { contentPlanService } from '../../services/contentPlanService';
import { z } from 'zod';
import type { AnyRouter } from '@trpc/server';

export const contentPlanRouter: AnyRouter = router({
  /**
   * Generate a content plan from keyword analysis
   * POST /content/plan
   */
  generate: publicProcedure
    .input(z.object({
      keywordAnalysisId: z.string().min(1, 'Keyword analysis ID is required')
    }))
    .mutation(async ({ input }) => {
      try {
        const contentPlanId = await contentPlanService.generateContentPlan(input.keywordAnalysisId);
        
        return {
          success: true,
          contentPlanId,
          message: 'Content plan generated successfully'
        };
      } catch (error) {
        console.error('Error in generateContentPlan procedure:', error);
        throw new Error(error instanceof Error ? error.message : 'Failed to generate content plan');
      }
    }),
    
  /**
   * Retrieve a content plan by ID
   * GET /content/plan/:id
   */
  getById: publicProcedure
    .input(z.object({
      id: z.string().min(1, 'Content plan ID is required')
    }))
    .query(async ({ input }) => {
      try {
        const contentPlan = await contentPlanService.getContentPlanById(input.id);
        
        return {
          success: true,
          data: contentPlan
        };
      } catch (error) {
        console.error('Error in getContentPlanById procedure:', error);
        throw new Error(error instanceof Error ? error.message : 'Failed to retrieve content plan');
      }
    }),
    
  /**
   * Update (approve/edit) a content plan
   * PUT /content/plan/:id
   */
  update: publicProcedure
    .input(z.object({
      id: z.string().min(1, 'Content plan ID is required'),
      updates: z.object({
        articleGoal: z.string().optional(),
        headlines: z.array(z.string()).optional(),
        subheadings: z.array(z.string()).optional(),
        recommendedWordCount: z.number().optional(),
        keywordPlacement: z.array(z.string()).optional(),
        style: z.string().optional()
      }).optional(),
      adminApproved: z.boolean().optional()
    }))
    .mutation(async ({ input }) => {
      try {
        const updates = input.updates || {};
        const adminApproved = input.adminApproved ?? false;
        
        const updatedContentPlan = await contentPlanService.updateContentPlan(
          input.id,
          updates,
          adminApproved
        );
        
        return {
          success: true,
          data: updatedContentPlan,
          message: 'Content plan updated successfully'
        };
      } catch (error) {
        console.error('Error in updateContentPlan procedure:', error);
        throw new Error(error instanceof Error ? error.message : 'Failed to update content plan');
      }
    })
});