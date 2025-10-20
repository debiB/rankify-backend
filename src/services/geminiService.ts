import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import pdfParse from 'pdf-parse';

// Types for our brand analysis
export interface ToneData {
  tone: string[]; // formal, casual, persuasive, etc.
  style: {
    sentenceLength: string; // short, medium, long
    readability: string; // simple, complex
    firstPersonUsage: boolean; // uses "we/our/site"
  };
  structure: {
    headlineStyle: string;
    subheadingStyle: string;
  };
  keywords: string[];
  summary: string;
  // New fields for enhanced brand personalization
  brandVoiceCharacteristics: string[];
  targetAudienceInsights: string[];
  valueProposition: string;
  communicationPrinciples: string[];
}

export interface BrandAnalysisResult {
  toneData: ToneData;
  rawResponse: any;
}

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set in environment variables');
    }
    
    this.genAI = new GoogleGenerativeAI(apiKey);
    // Use the newer gemini-2.0-flash model
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  }

  /**
   * Generate content using a custom prompt with retry logic
   * @param prompt The prompt to send to Gemini
   * @param maxRetries Maximum number of retry attempts (default: 3)
   * @param baseDelay Base delay in milliseconds between retries (default: 1000)
   */
  async generateContent(prompt: string, maxRetries: number = 3, baseDelay: number = 1000): Promise<string> {
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.model.generateContent(prompt);
        const response = await result.response;
        return response.text();
      } catch (error: any) {
        lastError = error;
        
        // If this is the last attempt, throw the error
        if (attempt === maxRetries) {
          console.error('Error generating content with Gemini after', maxRetries + 1, 'attempts:', error);
          throw new Error('Failed to generate content after multiple attempts');
        }
        
        // Check if the error is retryable (503 Service Unavailable, etc.)
        const isRetryable = error.message?.includes('503') || 
                           error.message?.includes('overloaded') ||
                           error.message?.includes('Service Unavailable') ||
                           error.message?.includes('rate limit');
        
        // If not retryable, throw immediately
        if (!isRetryable) {
          console.error('Non-retryable error generating content with Gemini:', error);
          throw new Error('Failed to generate content: ' + error.message);
        }
        
        // Calculate delay with exponential backoff
        const delay = baseDelay * Math.pow(2, attempt);
        
        // Add some random jitter to prevent thundering herd
        const jitter = Math.random() * 1000;
        const totalDelay = delay + jitter;
        
        console.warn(`Gemini API error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(totalDelay)}ms:`, error.message);
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, totalDelay));
      }
    }
    
    // This should never be reached, but TypeScript needs it
    throw new Error('Failed to generate content: ' + (lastError?.message || 'Unknown error'));
  }

  /**
   * Analyze brand tone and style from text content with enhanced analysis
   */
  async analyzeBrandContent(content: string): Promise<BrandAnalysisResult> {
    const prompt = `
      As a brand analyst expert, analyze the following content and extract comprehensive information about the brand's identity, tone, style, and communication approach.
      
      Please provide your analysis in the following structured format:
      
      Tone: Identify the tone (e.g., formal, casual, persuasive, friendly, professional, authoritative, playful, etc.)
      Style: Analyze sentence length (short/medium/long), readability (simple/complex), and first-person usage (true/false for use of "we", "our", "us")
      Structure: Describe headline and subheading styles
      Keywords: List 10-15 important keywords that represent the brand
      Summary: Provide a brief summary of the brand's voice and messaging style
      Brand Voice Characteristics: List 3-5 key characteristics that define the brand's voice (e.g., "knowledgeable", "approachable", "innovative")
      Target Audience Insights: Describe insights about the intended audience based on the content (e.g., "tech-savvy professionals", "budget-conscious families")
      Value Proposition: Articulate the core value proposition communicated in the content
      Communication Principles: List 3-5 guiding principles for how this brand communicates (e.g., "clear and jargon-free", "benefit-focused", "emotionally resonant")
      
      Content to analyze:
      ${content}
      
      Respond ONLY with the structured format above. Do not include any additional commentary or explanation.
    `;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      // Parse the response into structured data
      const toneData = this.parseEnhancedAnalysisResponse(text);
      
      return {
        toneData,
        rawResponse: text
      };
    } catch (error) {
      console.error('Error analyzing brand content with Gemini:', error);
      throw new Error('Failed to analyze brand content');
    }
  }

  /**
   * Analyze brand from a URL by fetching and processing its content
   */
  async analyzeBrandFromUrl(url: string): Promise<BrandAnalysisResult> {
    try {
      // Fetch the content from the URL
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BrandAnalyzer/1.0)'
        }
      });
      
      // Extract text content using cheerio for better HTML parsing
      const $ = cheerio.load(response.data);
      
      // Remove script and style elements
      $('script, style').remove();
      
      // Extract text content
      let content = $('body').text();
      
      // Clean up whitespace
      content = content.replace(/\s+/g, ' ').trim();
      
      // Limit the text length to avoid overwhelming the API
      content = content.substring(0, 5000);
      
      // Analyze the content
      return await this.analyzeBrandContent(content);
    } catch (error) {
      console.error('Error fetching or analyzing URL:', error);
      throw new Error('Failed to analyze brand from URL');
    }
  }

  /**
   * Analyze brand from a PDF file
   */
  async analyzeBrandFromPdf(pdfUrl: string): Promise<BrandAnalysisResult> {
    try {
      // Fetch the PDF file
      const response = await axios.get(pdfUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BrandAnalyzer/1.0)'
        }
      });
      
      // Parse the PDF
      const data = await pdfParse(response.data);
      
      // Extract and clean text
      let content = data.text.replace(/\s+/g, ' ').trim();
      
      // Limit the text length to avoid overwhelming the API
      content = content.substring(0, 5000);
      
      // Analyze the content
      return await this.analyzeBrandContent(content);
    } catch (error) {
      console.error('Error fetching or analyzing PDF:', error);
      throw new Error('Failed to analyze brand from PDF');
    }
  }

  /**
   * Parse the enhanced Gemini response into structured data
   */
  private parseEnhancedAnalysisResponse(response: string): ToneData {
    // Initialize with default values
    const toneData: ToneData = {
      tone: [],
      style: {
        sentenceLength: 'medium',
        readability: 'medium',
        firstPersonUsage: false
      },
      structure: {
        headlineStyle: 'unknown',
        subheadingStyle: 'unknown'
      },
      keywords: [],
      summary: '',
      brandVoiceCharacteristics: [],
      targetAudienceInsights: [],
      valueProposition: '',
      communicationPrinciples: []
    };

    // Helper function to extract content between markers
    const extractSection = (text: string, sectionName: string): string => {
      const regex = new RegExp(`${sectionName}:([\\s\\S]*?)(?=\\n\\w+:|$)`, 'i');
      const match = text.match(regex);
      return match ? match[1].trim() : '';
    };

    // Parse each section
    const toneText = extractSection(response, 'Tone');
    if (toneText) {
      toneData.tone = toneText.split(',').map(t => t.trim()).filter(t => t.length > 0);
    }

    const styleText = extractSection(response, 'Style');
    if (styleText) {
      // Extract sentence length
      const lengthMatch = styleText.match(/sentence length.*?(short|medium|long)/i);
      if (lengthMatch) toneData.style.sentenceLength = lengthMatch[1].toLowerCase();
      
      // Extract readability
      const readabilityMatch = styleText.match(/readability.*?(simple|complex|medium)/i);
      if (readabilityMatch) toneData.style.readability = readabilityMatch[1].toLowerCase();
      
      // Extract first person usage
      const firstPersonMatch = styleText.match(/first-person.*?(true|false|yes|no)/i);
      if (firstPersonMatch) {
        toneData.style.firstPersonUsage = /true|yes/i.test(firstPersonMatch[1]);
      }
    }

    const structureText = extractSection(response, 'Structure');
    if (structureText) {
      // Extract headline style
      const headlineMatch = structureText.match(/headline.*?style.*?:?\s*(.*?)(?=\n|$)/i);
      if (headlineMatch) toneData.structure.headlineStyle = headlineMatch[1].trim();
      
      // Extract subheading style
      const subheadingMatch = structureText.match(/subheading.*?style.*?:?\s*(.*?)(?=\n|$)/i);
      if (subheadingMatch) toneData.structure.subheadingStyle = subheadingMatch[1].trim();
    }

    const keywordsText = extractSection(response, 'Keywords');
    if (keywordsText) {
      toneData.keywords = keywordsText.split(',').map(k => k.trim()).filter(k => k.length > 0);
    }

    const summaryText = extractSection(response, 'Summary');
    if (summaryText) {
      toneData.summary = summaryText;
    }

    const brandVoiceText = extractSection(response, 'Brand Voice Characteristics');
    if (brandVoiceText) {
      toneData.brandVoiceCharacteristics = brandVoiceText.split(',').map(c => c.trim()).filter(c => c.length > 0);
    }

    const audienceText = extractSection(response, 'Target Audience Insights');
    if (audienceText) {
      toneData.targetAudienceInsights = audienceText.split(',').map(a => a.trim()).filter(a => a.length > 0);
    }

    const valuePropText = extractSection(response, 'Value Proposition');
    if (valuePropText) {
      toneData.valueProposition = valuePropText;
    }

    const principlesText = extractSection(response, 'Communication Principles');
    if (principlesText) {
      toneData.communicationPrinciples = principlesText.split(',').map(p => p.trim()).filter(p => p.length > 0);
    }

    return toneData;
  }
}

// Export a singleton instance
export const geminiService = new GeminiService();