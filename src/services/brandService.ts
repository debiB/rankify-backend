import { PrismaClient } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { geminiService, ToneData } from './geminiService';
import { BrandProfile, BrandProfileUrl, BrandProfilePdf, BrandProfileOtherDoc } from '@prisma/client';
import axios from 'axios';
import pdfParse from 'pdf-parse';
import * as fs from 'fs';
import * as path from 'path';
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
}

export class BrandService {
  /**
   * Create a new brand profile with initial analysis
   */
  async createBrandProfile(input: CreateBrandProfileInput) {
    // Analyze all provided resources
    const toneData = await this.analyzeBrandResources(input.urls, input.pdfs, input.otherDocs);
    
    // Create the brand profile in the database
    const brandProfile = await prisma.brandProfile.create({
      data: {
        name: input.name,
        toneData: toneData as any,
        urls: {
          create: input.urls.map(url => ({ url }))
        },
        pdfs: {
          create: input.pdfs.map(pdf => ({ url: pdf }))
        },
        otherDocs: {
          create: input.otherDocs.map(doc => ({ url: doc }))
        }
      },
      include: {
        urls: true,
        pdfs: true,
        otherDocs: true
      }
    });
    
    return brandProfile;
  }

  /**
   * Get a brand profile by ID
   */
  async getBrandProfile(id: string) {
    return await prisma.brandProfile.findUnique({
      where: { id },
      include: {
        urls: true,
        pdfs: true,
        otherDocs: true
      }
    });
  }

  /**
   * Update a brand profile
   */
  async updateBrandProfile(input: UpdateBrandProfileInput) {
    const data: any = {};
    
    if (input.name) {
      data.name = input.name;
    }
    
    if (input.toneData) {
      data.toneData = input.toneData as any;
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
      summary: 'No content analyzed yet.'
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
      const data = await pdfParse(response.data);
      
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