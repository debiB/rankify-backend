import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import cheerio from 'cheerio';
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
   * Generate content using a custom prompt
   */
  async generateContent(prompt: string): Promise<string> {
    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('Error generating content with Gemini:', error);
      throw new Error('Failed to generate content');
    }
  }

  /**
   * Analyze brand tone and style from text content
   */
  async analyzeBrandContent(content: string): Promise<BrandAnalysisResult> {
    const prompt = `
      Analyze the following content and extract information about the brand's tone, style, and structure.
      Please provide your analysis in the following format:
      
      Tone: Identify the tone (e.g., formal, casual, persuasive, friendly, professional, etc.)
      Style: Analyze sentence length (short/medium/long), readability (simple/complex), and first-person usage (true/false for use of "we", "our", "us")
      Structure: Describe headline and subheading styles
      Keywords: List 10-15 important keywords that represent the brand
      Summary: Provide a brief summary of the brand's voice and messaging style
      
      Content to analyze:
      ${content}
    `;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      // Parse the response into structured data
      const toneData = this.parseAnalysisResponse(text);
      
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
   * Parse the Gemini response into structured data
   */
  private parseAnalysisResponse(response: string): ToneData {
    // This is a simplified parser - in a production environment, you might want to use
    // a more robust parsing approach or modify the prompt to return JSON
    
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
      summary: ''
    };

    // Parse tone
    const toneMatch = response.match(/Tone:(.*?)(?=Style:|Structure:|Keywords:|Summary:|$)/is);
    if (toneMatch && toneMatch[1]) {
      toneData.tone = toneMatch[1].split(',').map(t => t.trim()).filter(t => t.length > 0);
    }

    // Parse style
    const styleMatch = response.match(/Style:(.*?)(?=Structure:|Keywords:|Summary:|$)/is);
    if (styleMatch && styleMatch[1]) {
      const styleText = styleMatch[1];
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

    // Parse structure
    const structureMatch = response.match(/Structure:(.*?)(?=Keywords:|Summary:|$)/is);
    if (structureMatch && structureMatch[1]) {
      const structureText = structureMatch[1];
      // Extract headline style
      const headlineMatch = structureText.match(/headline.*?style.*?:\s*(.*?)(?=\n|$)/i);
      if (headlineMatch) toneData.structure.headlineStyle = headlineMatch[1].trim();
      
      // Extract subheading style
      const subheadingMatch = structureText.match(/subheading.*?style.*?:\s*(.*?)(?=\n|$)/i);
      if (subheadingMatch) toneData.structure.subheadingStyle = subheadingMatch[1].trim();
    }

    // Parse keywords
    const keywordsMatch = response.match(/Keywords:(.*?)(?=Summary:|$)/is);
    if (keywordsMatch && keywordsMatch[1]) {
      toneData.keywords = keywordsMatch[1].split(',').map(k => k.trim()).filter(k => k.length > 0);
    }

    // Parse summary
    const summaryMatch = response.match(/Summary:(.*?)(?=$)/is);
    if (summaryMatch && summaryMatch[1]) {
      toneData.summary = summaryMatch[1].trim();
    }

    return toneData;
  }
}

// Export a singleton instance
export const geminiService = new GeminiService();