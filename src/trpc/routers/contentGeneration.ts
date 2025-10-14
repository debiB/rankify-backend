import { router, publicProcedure } from '../trpc-context';
import { contentGenerationService } from '../../services/contentGenerationService';
import { contentReviewService, ReviewResult } from '../../services/contentReviewService';
import { z } from 'zod';
import type { GeneratedContent, GeneratedContentData, ContentStyle, ContentBlock } from '../../services/contentGenerationService';
import type { inferRouterOutputs } from '@trpc/server';

export const contentGenerationRouter = router({
  /**
   * Generate article content using Gemini API
   * POST /content/generate
   */
  generate: publicProcedure
    .input(z.object({
      contentPlanId: z.string().min(1, 'Content plan ID is required'),
      brandProfileId: z.string().min(1, 'Brand profile ID is required'),
      style: z.enum(['מאמר', 'יח״צ', 'בקלינק']),
      language: z.string().optional().default('he') // Add language parameter
    }))
    .mutation(async ({ input }) => {
      try {
        const generatedContentId = await contentGenerationService.generateContent(
          input.contentPlanId,
          input.brandProfileId,
          input.style,
          input.language // Pass language to the service
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
        const content = await contentGenerationService.getGeneratedContentById(input.id);
        return {
          success: true,
          data: content
        };
      } catch (error) {
        console.error('Error retrieving generated content:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to retrieve content'
        };
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
        articleContent: z.array(z.object({
          headingType: z.enum(['h1', 'h2', 'h3']),
          headingText: z.string(),
          bodyText: z.string()
        })).optional(),
        style: z.string().optional(),
        intro: z.string().optional(),
        qnaSections: z.array(z.string()).optional(),
        externalLink: z.string().nullable().optional(),
        finalized: z.boolean().optional()
      }).partial()
    }))
    .mutation(async ({ input }) => {
      try {
        // Convert qnaSections to JSON string if provided
        const updatesToApply = { ...input.updates };
        if (updatesToApply.qnaSections) {
          updatesToApply.qnaSections = JSON.stringify(updatesToApply.qnaSections) as any;
        }
        
        const updatedContent = await contentGenerationService.update(
          input.id,
          updatesToApply
        );
        
        return {
          success: true,
          data: updatedContent
        };
      } catch (error) {
        console.error('Error updating generated content:', error);
        throw new Error(error instanceof Error ? error.message : 'Failed to update content');
      }
    }),

  /**
   * Finalize generated content (mark as complete)
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
          data: finalizedContent
        };
      } catch (error) {
        console.error('Error finalizing content:', error);
        throw new Error(error instanceof Error ? error.message : 'Failed to finalize content');
      }
    }),

  /**
   * Review generated content for quality metrics
   * GET /content/:id/review
   */
  review: publicProcedure
    .input(z.object({
      id: z.string().min(1, 'Generated content ID is required')
    }))
    .query(async ({ input }) => {
      try {
        const reviewResult: ReviewResult = await contentReviewService.review(input.id);
        return {
          success: true,
          data: reviewResult
        };
      } catch (error) {
        console.error('Error reviewing content:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to review content'
        };
      }
    })
});