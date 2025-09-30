import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '../context';
import { brandService } from '../../services/brandService';
import { TRPCError } from '@trpc/server';

export const brandRouter = router({
  /**
   * Upload brand resources and create a new brand profile
   */
  uploadResources: protectedProcedure
    .input(z.object({
      name: z.string().min(1, 'Name is required'),
      urls: z.array(z.string().url()).optional().default([]),
      pdfs: z.array(z.string().url()).optional().default([]),
      otherDocs: z.array(z.string().url()).optional().default([]),
    }))
    .mutation(async ({ input }: { input: any }) => {
      try {
        const brandProfile = await brandService.createBrandProfile({
          name: input.name,
          urls: input.urls,
          pdfs: input.pdfs,
          otherDocs: input.otherDocs
        });
        
        return {
          success: true,
          brandProfile
        };
      } catch (error) {
        console.error('Error creating brand profile:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create brand profile'
        });
      }
    }),

  /**
   * Get a brand profile by ID
   */
  getProfile: protectedProcedure
    .input(z.object({
      id: z.string().min(1, 'ID is required')
    }))
    .query(async ({ input }: { input: any }) => {
      try {
        const brandProfile = await brandService.getBrandProfile(input.id);
        
        if (!brandProfile) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Brand profile not found'
          });
        }
        
        return {
          success: true,
          brandProfile
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        
        console.error('Error fetching brand profile:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch brand profile'
        });
      }
    }),

  /**
   * Update/fine-tune a brand profile
   */
  updateProfile: protectedProcedure
    .input(z.object({
      id: z.string().min(1, 'ID is required'),
      name: z.string().optional(),
      toneData: z.any().optional() // We'll use any for the tone data since it's a complex JSON object
    }))
    .mutation(async ({ input }: { input: any }) => {
      try {
        const brandProfile = await brandService.updateBrandProfile({
          id: input.id,
          name: input.name,
          toneData: input.toneData
        });
        
        return {
          success: true,
          brandProfile
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        
        console.error('Error updating brand profile:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update brand profile'
        });
      }
    })
});