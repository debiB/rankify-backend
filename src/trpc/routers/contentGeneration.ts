import { router, publicProcedure } from '../context';
import { contentGenerationService } from '../../services/contentGenerationService';
import { contentReviewService, ReviewResult } from '../../services/contentReviewService';
import { z } from 'zod';
import type { AnyRouter } from '@trpc/server';
import type { GeneratedContent, GeneratedContentData, ContentStyle } from '../../services/contentGenerationService';

export const contentGenerationRouter: AnyRouter = router({
  /**
   * Generate article content using Gemini API
   * POST /content/generate
   */
  generate: publicProcedure
    .input(z.object({
      contentPlanId: z.string().min(1, 'Content plan ID is required'),
      brandProfileId: z.string().min(1, 'Brand profile ID is required'),
      style: z.enum(['מאמר', 'יח״צ', 'בקלינק'])
    }))
    .mutation(async ({ input }) => {
      try {
        const generatedContentId = await contentGenerationService.generateContent(
          input.contentPlanId,
          input.brandProfileId,
          input.style
        );
        
        return {
          success: true,
          generatedContentId,
          message: 'Content generated successfully'
        };
      } catch (error) {
        console.error('Error in generateContent procedure:', error);
        throw new Error(error instanceof Error ? error.message : 'Failed to generate content');
      }
    }),
    
  /**
   * Retrieve generated content by ID
   * GET /content/:id
   */
  getById: publicProcedure
    .input(z.object({
      id: z.string().min(1, 'Generated content ID is required')
    }))
    .query(async ({ input }) => {
      try {
        const generatedContent = await contentGenerationService.getGeneratedContentById(input.id);
        
        return {
          success: true,
          data: generatedContent
        };
      } catch (error) {
        console.error('Error in getGeneratedContentById procedure:', error);
        throw new Error(error instanceof Error ? error.message : 'Failed to retrieve generated content');
      }
    }),
    
  /**
   * Review article for SEO and readability
   * POST /content/review/:id
   */
  review: publicProcedure
    .input(z.object({
      id: z.string().min(1, 'Generated content ID is required')
    }))
    .query(async ({ input }) => {
      try {
        const reviewResult: ReviewResult = await contentReviewService.reviewContent(input.id);
        
        return {
          success: true,
          data: reviewResult
        };
      } catch (error) {
        console.error('Error in reviewContent procedure:', error);
        throw new Error(error instanceof Error ? error.message : 'Failed to review content');
      }
    }),
    
  /**
   * Finalize generated content
   * PUT /content/:id/finalize
   */
  finalize: publicProcedure
    .input(z.object({
      id: z.string().min(1, 'Generated content ID is required')
    }))
    .mutation(async ({ input }) => {
      try {
        const finalizedContent = await contentGenerationService.finalizeContent(input.id);
        
        return {
          success: true,
          data: finalizedContent,
          message: 'Content finalized successfully'
        };
      } catch (error) {
        console.error('Error in finalizeContent procedure:', error);
        throw new Error(error instanceof Error ? error.message : 'Failed to finalize content');
      }
    }),
    
  /**
   * Update generated content
   * PUT /content/:id
   */
  update: publicProcedure
    .input(z.object({
      id: z.string().min(1, 'Generated content ID is required'),
      updates: z.object({
        articleText: z.string().optional(),
        style: z.string().optional(),
        intro: z.string().optional(),
        qnaSections: z.array(z.string()).optional(),
        externalLink: z.string().nullable().optional()
      }).optional()
    }))
    .mutation(async ({ input }) => {
      try {
        const updates = input.updates || {};
        
        const updatedContent = await contentGenerationService.updateGeneratedContent(
          input.id,
          updates
        );
        
        return {
          success: true,
          data: updatedContent,
          message: 'Content updated successfully'
        };
      } catch (error) {
        console.error('Error in updateGeneratedContent procedure:', error);
        throw new Error(error instanceof Error ? error.message : 'Failed to update generated content');
      }
    })
});