import { prisma } from '../utils/prisma';
import { geminiService, ToneData } from './geminiService';
import axios from 'axios';
import * as pdfParse from 'pdf-parse';
import * as cheerio from 'cheerio';

export interface CreateBrandProfileInput {
  name: string;
  urls: string[];
  pdfs: string[];
  otherDocs: string[];
}

export interface UpdateBrandProfileInput {
  id: string;
  name?: string;
  toneData?: ToneData;
  urls?: string[];
  pdfs?: string[];
  otherDocs?: string[];
}

export interface ResourceAnalysis {
  url?: string;
  type: 'url' | 'pdf' | 'document';
  content: string;
  toneData: ToneData;
}

export class BrandService {
  /**
   * Create a new brand profile with initial analysis
   */
  async createBrandProfile(input: CreateBrandProfileInput) {
    try {
      // Analyze all provided resources
      const toneData = await this.analyzeBrandResources(input.urls, input.pdfs, input.otherDocs);
      
      // Create the brand profile in the database
      const brandProfile = await prisma.brandProfile.create({
        data: {
          name: input.name,
          toneData: toneData as any,
          lastUpdated: new Date(),
          createdAt: new Date(),
          urls: {
            create: input.urls.map(url => ({ url }))
          },
          pdfs: {
            create: input.pdfs.map(pdf => ({ url: pdf }))
          },
          otherDocs: {
            create: input.otherDocs.map(doc => ({ url: doc }))
          }
        } as any,
        include: {
          urls: true,
          pdfs: true,
          otherDocs: true
        }
      });
      
      return brandProfile;
    } catch (error) {
      console.error('Create brand profile error:', error);
      throw new Error('Failed to create brand profile. Please try again.');
    }
  }

  /**
   * Get a brand profile by ID
   */
  async getBrandProfile(id: string) {
    try {
      return await prisma.brandProfile.findUnique({
        where: { id },
        include: {
          urls: true,
          pdfs: true,
          otherDocs: true
        }
      });
    } catch (error) {
      console.error('Get brand profile error:', error);
      throw new Error('Failed to get brand profile. Please try again.');
    }
  }

  /**
   * Get all brand profiles - returns only the latest profile per brand name
   */
  async getAllBrandProfiles() {
    try {
      // Get all brand profiles ordered by name and lastUpdated
      const allProfiles = await prisma.brandProfile.findMany({
        include: {
          urls: true,
          pdfs: true,
          otherDocs: true
        },
        orderBy: [
          { name: 'asc' },
          { lastUpdated: 'desc' }
        ]
      });
      
      // Filter to get only the latest profile per brand name
      const distinctBrands = new Map();
      for (const profile of allProfiles) {
        if (!distinctBrands.has(profile.name)) {
          distinctBrands.set(profile.name, profile);
        }
      }
      
      return Array.from(distinctBrands.values());
    } catch (error) {
      console.error('Get all brand profiles error:', error);
      throw new Error('Failed to get brand profiles. Please try again.');
    }
  }

  /**
   * Get detailed analysis results for a brand profile
   */
  async getDetailedBrandAnalysis(id: string) {
    try {
      const brandProfile = await this.getBrandProfile(id);
      
      if (!brandProfile) {
        throw new Error('Brand profile not found');
      }
      
      // Get individual resource analyses
      const individualAnalyses = await this.analyzeIndividualResources(
        brandProfile.urls.map((url: { url: string }) => url.url),
        brandProfile.pdfs.map((pdf: { url: string }) => pdf.url),
        brandProfile.otherDocs.map((doc: { url: string }) => doc.url)
      );
      
      return {
        brandProfile,
        individualAnalyses
      };
    } catch (error) {
      console.error('Get detailed brand analysis error:', error);
      throw new Error(`Failed to get detailed brand analysis: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update a brand profile
   */
  async updateBrandProfile(input: UpdateBrandProfileInput) {
    try {
      const data: any = {};
      
      if (input.name) {
        data.name = input.name;
      }
      
      if (input.toneData) {
        data.toneData = input.toneData as any;
      }
      
      // Always update the lastUpdated field
      data.lastUpdated = new Date();
      
      // Update associated resources if provided
      if (input.urls) {
        // Remove existing URLs and add new ones
        await prisma.brandProfileUrl.deleteMany({
          where: { brandProfileId: input.id }
        });
        
        data.urls = {
          create: input.urls.map(url => ({ url }))
        };
      }
      
      if (input.pdfs) {
        // Remove existing PDFs and add new ones
        await prisma.brandProfilePdf.deleteMany({
          where: { brandProfileId: input.id }
        });
        
        data.pdfs = {
          create: input.pdfs.map(pdf => ({ url: pdf }))
        };
      }
      
      if (input.otherDocs) {
        // Remove existing documents and add new ones
        await prisma.brandProfileOtherDoc.deleteMany({
          where: { brandProfileId: input.id }
        });
        
        data.otherDocs = {
          create: input.otherDocs.map(doc => ({ url: doc }))
        };
      }
      
      return await prisma.brandProfile.update({
        where: { id: input.id },
        data,
        include: {
          urls: true,
          pdfs: true,
          otherDocs: true
        }
      });
    } catch (error) {
      console.error('Update brand profile error:', error);
      throw new Error('Failed to update brand profile. Please try again.');
    }
  }

  /**
   * Re-analyze a brand profile with fresh data
   */
  async reanalyzeBrandProfile(id: string) {
    try {
      const brandProfile = await this.getBrandProfile(id);
      
      if (!brandProfile) {
        throw new Error('Brand profile not found');
      }
      
      // Extract URLs, PDFs, and other documents from the brand profile
      const urls = brandProfile.urls.map((url: { url: string }) => url.url);
      const pdfs = brandProfile.pdfs.map((pdf: { url: string }) => pdf.url);
      const otherDocs = brandProfile.otherDocs.map((doc: { url: string }) => doc.url);
      
      // Analyze all resources
      const toneData = await this.analyzeBrandResources(urls, pdfs, otherDocs);
      
      // Update the brand profile with new tone data
      return await prisma.brandProfile.update({
        where: { id },
        data: {
          toneData: toneData as any,
          lastUpdated: new Date()
        } as any,
        include: {
          urls: true,
          pdfs: true,
          otherDocs: true
        }
      });
    } catch (error) {
      console.error('Re-analyze brand profile error:', error);
      throw new Error(`Failed to re-analyze brand profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Analyze individual resources and return detailed analysis
   */
  async analyzeIndividualResources(urls: string[], pdfs: string[], otherDocs: string[]): Promise<ResourceAnalysis[]> {
    const analyses: ResourceAnalysis[] = [];
    
    // Process URLs
    for (const url of urls) {
      try {
        const analysis = await geminiService.analyzeBrandFromUrl(url);
        analyses.push({
          url,
          type: 'url',
          content: analysis.rawResponse,
          toneData: analysis.toneData
        });
      } catch (error) {
        console.error(`Error analyzing URL ${url}:`, error);
        // Continue with other URLs even if one fails
      }
    }
    
    // Process PDF documents
    for (const pdfUrl of pdfs) {
      try {
        const pdfContent = await this.extractTextFromPdf(pdfUrl);
        if (pdfContent) {
          // Analyze the PDF content with Gemini
          const analysis = await geminiService.analyzeBrandContent(pdfContent);
          analyses.push({
            url: pdfUrl,
            type: 'pdf',
            content: analysis.rawResponse,
            toneData: analysis.toneData
          });
        }
      } catch (error) {
        console.error(`Error processing PDF ${pdfUrl}:`, error);
        // Continue with other documents even if one fails
      }
    }
    
    // Process other documents (assuming they are text files or similar)
    for (const docUrl of otherDocs) {
      try {
        const docContent = await this.extractTextFromDocument(docUrl);
        if (docContent) {
          // Analyze the document content with Gemini
          const analysis = await geminiService.analyzeBrandContent(docContent);
          analyses.push({
            url: docUrl,
            type: 'document',
            content: analysis.rawResponse,
            toneData: analysis.toneData
          });
        }
      } catch (error) {
        console.error(`Error processing document ${docUrl}:`, error);
        // Continue with other documents even if one fails
      }
    }
    
    return analyses;
  }

  /**
   * Analyze brand resources and extract tone data
   */
  private async analyzeBrandResources(urls: string[], pdfs: string[], otherDocs: string[]): Promise<ToneData> {
    // Collect content from all resources
    let combinedContent = '';
    
    // Process URLs
    for (const url of urls) {
      try {
        const analysis = await geminiService.analyzeBrandFromUrl(url);
        combinedContent += analysis.rawResponse + '\n\n';
      } catch (error) {
        console.error(`Error analyzing URL ${url}:`, error);
        // Continue with other URLs even if one fails
      }
    }
    
    // Process PDF documents
    for (const pdfUrl of pdfs) {
      try {
        const pdfContent = await this.extractTextFromPdf(pdfUrl);
        if (pdfContent) {
          // Analyze the PDF content with Gemini
          const analysis = await geminiService.analyzeBrandContent(pdfContent);
          combinedContent += analysis.rawResponse + '\n\n';
        }
      } catch (error) {
        console.error(`Error processing PDF ${pdfUrl}:`, error);
        // Continue with other documents even if one fails
      }
    }
    
    // Process other documents (assuming they are text files or similar)
    for (const docUrl of otherDocs) {
      try {
        const docContent = await this.extractTextFromDocument(docUrl);
        if (docContent) {
          // Analyze the document content with Gemini
          const analysis = await geminiService.analyzeBrandContent(docContent);
          combinedContent += analysis.rawResponse + '\n\n';
        }
      } catch (error) {
        console.error(`Error processing document ${docUrl}:`, error);
        // Continue with other documents even if one fails
      }
    }
    
    // If we have content, analyze it
    if (combinedContent.trim()) {
      const analysis = await geminiService.analyzeBrandContent(combinedContent);
      return analysis.toneData;
    }
    
    // Return default tone data if no content was processed
    return {
      tone: ['neutral'],
      style: {
        sentenceLength: 'medium',
        readability: 'medium',
        firstPersonUsage: false
      },
      structure: {
        headlineStyle: 'standard',
        subheadingStyle: 'standard'
      },
      keywords: [],
      summary: 'No content analyzed yet.',
      brandVoiceCharacteristics: [],
      targetAudienceInsights: [],
      valueProposition: '',
      communicationPrinciples: []
    };
  }
  
  /**
   * Extract text content from a PDF file
   */
  private async extractTextFromPdf(pdfUrl: string): Promise<string> {
    try {
      // Fetch the PDF file
      const response = await axios.get(pdfUrl, {
        responseType: 'arraybuffer',
        timeout: 15000
      });
      
      // Parse the PDF
      const data = await (pdfParse as any).default(response.data);
      
      // Extract and clean text
      let text = data.text.replace(/\s+/g, ' ').trim();
      
      // Limit content length to avoid overwhelming the AI model
      return text.substring(0, 5000);
    } catch (error) {
      console.error('Error extracting text from PDF:', error);
      throw new Error(`Failed to extract text from PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Extract text content from other document types
   */
  private async extractTextFromDocument(docUrl: string): Promise<string> {
    try {
      // Fetch the document
      const response = await axios.get(docUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DocumentExtractor/1.0)'
        }
      });
      
      // For text-based documents, return the content directly
      if (typeof response.data === 'string') {
        let text = response.data.replace(/\s+/g, ' ').trim();
        return text.substring(0, 5000);
      }
      
      // For HTML documents, extract text content
      if (docUrl.endsWith('.html') || docUrl.endsWith('.htm') || response.headers['content-type']?.includes('text/html')) {
        const $ = cheerio.load(response.data);
        $('script, style').remove();
        let text = $('body').text().replace(/\s+/g, ' ').trim();
        return text.substring(0, 5000);
      }
      
      // For other document types, return a placeholder
      return `Document content from ${docUrl}`;
    } catch (error) {
      console.error('Error extracting text from document:', error);
      throw new Error(`Failed to extract text from document: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Export a singleton instance
export const brandService = new BrandService();