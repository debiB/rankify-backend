import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '../trpc-context';
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
        console.log('Creating brand profile with input:', input);
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
        // Log more detailed error information
        if (error instanceof Error) {
          console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
          });
        } else {
          console.error('Unknown error type:', typeof error, error);
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create brand profile',
          cause: error // Include the original error as cause
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
   * Get all brand profiles
   */
  getAllProfiles: protectedProcedure
    .query(async () => {
      try {
        const brandProfiles = await brandService.getAllBrandProfiles();
        
        return {
          success: true,
          brandProfiles
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        
        console.error('Error fetching brand profiles:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch brand profiles'
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
    }),

  /**
   * Get detailed brand analysis results
   */
  getDetailedAnalysis: protectedProcedure
    .input(z.object({
      id: z.string().min(1, 'ID is required')
    }))
    .query(async ({ input }: { input: any }) => {
      try {
        const detailedAnalysis = await brandService.getDetailedBrandAnalysis(input.id);
        
        return {
          success: true,
          ...detailedAnalysis
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        
        console.error('Error fetching detailed brand analysis:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch detailed brand analysis'
        });
      }
    }),

  /**
   * Re-analyze a brand profile
   */
  reanalyzeProfile: protectedProcedure
    .input(z.object({
      id: z.string().min(1, 'ID is required')
    }))
    .mutation(async ({ input }: { input: any }) => {
      try {
        const brandProfile = await brandService.reanalyzeBrandProfile(input.id);
        
        return {
          success: true,
          brandProfile
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        
        console.error('Error re-analyzing brand profile:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to re-analyze brand profile'
        });
      }
    }),

  /**
   * Update brand resources (URLs, PDFs, otherDocs) for existing brands
   */
  updateBrandResources: protectedProcedure
    .input(z.object({
      id: z.string().min(1, 'ID is required'),
      urls: z.array(z.string().url()).optional(),
      pdfs: z.array(z.string().url()).optional(),
      otherDocs: z.array(z.string().url()).optional(),
    }))
    .mutation(async ({ input }: { input: any }) => {
      try {
        // Get the current brand profile
        const currentBrandProfile = await brandService.getBrandProfile(input.id);
        
        if (!currentBrandProfile) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Brand profile not found'
          });
        }
        
        // Merge existing resources with new ones
        const updatedUrls = input.urls 
          ? [...new Set([...(currentBrandProfile.urls?.map((u: { url: string }) => u.url) || []), ...input.urls])]
          : currentBrandProfile.urls?.map((u: { url: string }) => u.url) || [];
          
        const updatedPdfs = input.pdfs
          ? [...new Set([...(currentBrandProfile.pdfs?.map((p: { url: string }) => p.url) || []), ...input.pdfs])]
          : currentBrandProfile.pdfs?.map((p: { url: string }) => p.url) || [];
          
        const updatedOtherDocs = input.otherDocs
          ? [...new Set([...(currentBrandProfile.otherDocs?.map((d: { url: string }) => d.url) || []), ...input.otherDocs])]
          : currentBrandProfile.otherDocs?.map((d: { url: string }) => d.url) || [];
        
        // Update the brand profile with new resources
        const brandProfile = await brandService.updateBrandProfile({
          id: input.id,
          urls: updatedUrls,
          pdfs: updatedPdfs,
          otherDocs: updatedOtherDocs
        });
        
        return {
          success: true,
          brandProfile
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        
        console.error('Error updating brand resources:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update brand resources'
        });
      }
    })
});