import axios from 'axios';
import * as cheerio from 'cheerio';
import { prisma } from '../utils/prisma';
import { searchConsoleService } from './searchConsole';
import { googleSearchService } from './googleSearch';
import { geminiService } from './geminiService';
import { GoogleAccount, Campaign } from '@prisma/client';

// Define types for our keyword analysis
export interface Headings {
  h1: string[];
  h2: string[];
  h3: string[];
}

export interface KeywordAnalysisResult {
  pageGoals: string[];
  headings: Headings;
  avgWordCount: number;
  keywordDensity: number;
  suggestedQA: string[];
  recommendedExternalLink: string;
}

interface PageContent {
  url: string;
  content: string;
}

interface GSCKeywordData {
  keyword: string;
  topPages: {
    url: string;
    position: number;
    impressions: number;
  }[];
}

export class KeywordAnalysisService {
  /**
   * Analyze a keyword using Google Search data and Gemini API
   * @param keyword The keyword to analyze
   * @param campaignId Optional campaign ID (for backward compatibility)
   * @returns Analysis result ID
   */
  async analyzeKeyword(keyword: string, campaignId?: string): Promise<string> {
    try {
      console.log(`Analyzing keyword: ${keyword}`);
      
      // Step 1: Fetch data from Google Search instead of GSC
      const searchData = await this.fetchGoogleSearchData(keyword);
      
      console.log(`Search data received:`, JSON.stringify(searchData, null, 2));
      
      // Step 2: If still no data, throw error
      if (!searchData || searchData.topPages.length === 0) {
        throw new Error(`No Google Search data found for keyword: ${keyword}. Please ensure the keyword is valid and Google Search API is properly configured.`);
      }
      
      // Step 3: Get content for top 5 pages
      const pageContents = await this.getPageContents(searchData.topPages.slice(0, 5));
      
      // Step 4: Analyze pages with Gemini API
      const analysis = await this.analyzeWithGemini(keyword, pageContents);
      
      // Step 5: Store results in database
      const analysisId = await this.storeAnalysis(keyword, analysis);
      
      return analysisId;
    } catch (error) {
      console.error('Error analyzing keyword:', error);
      throw new Error(`Failed to analyze keyword: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Fetch Google Search data for a keyword
   */
  private async fetchGoogleSearchData(keyword: string): Promise<GSCKeywordData | null> {
    try {
      console.log(`Fetching Google Search data for keyword: ${keyword}`);
      
      // Fetch data from Google Search
      const searchData = await googleSearchService.searchKeyword(keyword);
      
      console.log(`Google Search data received:`, JSON.stringify(searchData, null, 2));
      
      if (!searchData) {
        console.log(`No Google Search data found for keyword: ${keyword}`);
        return null;
      }
      
      return {
        keyword: searchData.keyword,
        topPages: searchData.topPages.map(page => ({
          url: page.url,
          position: page.position,
          impressions: page.impressions
        }))
      };
    } catch (error) {
      console.error('Error fetching Google Search data:', error);
      return null;
    }
  }
  
  /**
   * Get stored GSC data for a keyword (keeping for backward compatibility)
   */
  private async getStoredGSCData(keyword: string, campaignId: string): Promise<GSCKeywordData | null> {
    try {
      // Find the campaign to get the site URL
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId }
      });
      
      if (!campaign) {
        throw new Error('Campaign not found');
      }
      
      // Get keyword data from database
      const keywordData = await prisma.searchConsoleKeyword.findFirst({
        where: {
          keyword: keyword,
          analytics: {
            siteUrl: campaign.searchConsoleSite
          }
        },
        include: {
          dailyStats: {
            orderBy: {
              date: 'desc'
            },
            take: 1
          }
        }
      });
      
      if (!keywordData) {
        return null;
      }
      
      // Get top ranking pages for this keyword
      const topPages = await prisma.searchConsoleKeywordDailyStat.findMany({
        where: {
          keywordId: keywordData.id
        },
        orderBy: {
          date: 'desc'
        },
        take: 5
      });
      
      return {
        keyword,
        topPages: topPages.map(stat => ({
          url: stat.topRankingPageUrl,
          position: stat.averageRank || 0,
          impressions: stat.searchVolume
        }))
      };
    } catch (error) {
      console.error('Error getting stored GSC data:', error);
      return null;
    }
  }
  
  /**
   * Fetch GSC data for a keyword if not available in storage (keeping for backward compatibility)
   */
  private async fetchGSCData(keyword: string, campaignId?: string): Promise<GSCKeywordData | null> {
    try {
      // If campaignId is provided, use the existing logic
      if (campaignId) {
        // Get campaign and associated Google account
        const campaign = await prisma.campaign.findUnique({
          where: { id: campaignId },
          include: {
            googleAccount: true,
            user: true
          }
        });
        
        if (!campaign || !campaign.googleAccount) {
          throw new Error('Campaign or Google account not found');
        }
        
        // Fetch data from Search Console
        const gscData = await searchConsoleService.getAnalytics({
          campaign,
          googleAccount: campaign.googleAccount,
          dimensions: ['page', 'query'],
          exactUrlMatch: false
        });
        
        if (!gscData) {
          return null;
        }
        
        // Filter data for our specific keyword
        const keywordRows = gscData.filter(row => 
          row.keys && row.keys.includes(keyword)
        );
        
        // Sort by impressions to get top pages
        const sortedPages = keywordRows.sort((a, b) => 
          (b.impressions || 0) - (a.impressions || 0)
        );
        
        return {
          keyword,
          topPages: sortedPages.slice(0, 5).map(row => ({
            url: row.keys?.[0] || '',
            position: row.position || 0,
            impressions: row.impressions || 0
          }))
        };
      } else {
        // If no campaignId is provided, search across all available Google accounts and sites
        const allSites = await searchConsoleService.getAllSites();
        
        // Try to find data across all sites
        for (const accountInfo of allSites) {
          const googleAccount = await prisma.googleAccount.findUnique({
            where: { id: accountInfo.accountId }
          });
          
          if (!googleAccount) continue;
          
          // Try each site for this account
          for (const site of accountInfo.sites) {
            try {
              // Create a mock campaign object for the getAnalytics call
              const mockCampaign = {
                searchConsoleSite: site.siteUrl
              } as any;
              
              // Fetch data from Search Console for this site
              const gscData = await searchConsoleService.getAnalytics({
                campaign: mockCampaign,
                googleAccount,
                dimensions: ['page', 'query'],
                exactUrlMatch: false
              });
              
              if (!gscData || gscData.length === 0) continue;
              
              // Filter data for our specific keyword
              const keywordRows = gscData.filter(row => 
                row.keys && row.keys.includes(keyword)
              );
              
              if (keywordRows.length > 0) {
                // Sort by impressions to get top pages
                const sortedPages = keywordRows.sort((a, b) => 
                  (b.impressions || 0) - (a.impressions || 0)
                );
                
                return {
                  keyword,
                  topPages: sortedPages.slice(0, 5).map(row => ({
                    url: row.keys?.[0] || '',
                    position: row.position || 0,
                    impressions: row.impressions || 0
                  }))
                };
              }
            } catch (siteError) {
              console.error(`Error fetching data for site ${site.siteUrl}:`, siteError);
              // Continue with next site
            }
          }
        }
        
        // If we get here, no data was found across all sites
        return null;
      }
    } catch (error) {
      console.error('Error fetching GSC data:', error);
      return null;
    }
  }
  
  /**
   * Get content for a list of pages by fetching actual web content
   */
  private async getPageContents(topPages: { url: string }[]): Promise<PageContent[]> {
    const pageContents: PageContent[] = [];
    
    for (const page of topPages) {
      try {
        // Fetch the page content with a timeout
        const response = await axios.get(page.url, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; KeywordAnalyzer/1.0)'
          }
        });
        
        // Use cheerio to extract text content from HTML
        const $ = cheerio.load(response.data);
        
        // Remove script and style elements
        $('script, style').remove();
        
        // Extract text content
        let textContent = $('body').text();
        
        // Clean up whitespace
        textContent = textContent.replace(/\s+/g, ' ').trim();
        
        // Limit content length to avoid overwhelming the AI model
        textContent = textContent.substring(0, 5000);
        
        pageContents.push({
          url: page.url,
          content: textContent
        });
      } catch (error) {
        console.error(`Error fetching content for ${page.url}:`, error);
        // Add placeholder content for failed requests
        pageContents.push({
          url: page.url,
          content: `Content could not be fetched for ${page.url}. This is a placeholder.`
        });
      }
    }
    
    return pageContents;
  }
  
  /**
   * Analyze pages with Gemini API
   */
  private async analyzeWithGemini(keyword: string, pageContents: PageContent[]): Promise<KeywordAnalysisResult> {
    try {
      // Combine all page contents for analysis
      const combinedContent = pageContents.map(page => 
        `URL: ${page.url}\nContent: ${page.content}`
      ).join('\n\n');
      
      // Create prompt for Gemini analysis
      const prompt = `
        Analyze the following web pages and provide content analysis for the keyword: "${keyword}"
        
        Pages:
        ${combinedContent}
        
        Please provide your analysis in the following format:
        
        Page Goals:
        - List the primary purpose of each page's content
        
        Headings:
        H1:
        - Extract all H1 headings from the pages
        H2:
        - Extract all H2 headings from the pages
        H3:
        - Extract all H3 headings from the pages
        
        Average Word Count:
        - Calculate the average word count across all pages (number only)
        
        Keyword Density:
        - Calculate the density of the keyword "${keyword}" as a percentage (number only, e.g., 2.5)
        
        Suggested Q&A:
        - Provide 5-10 suggested questions and answers that would enhance the content
        
        Recommended External Link:
        - Suggest one authoritative external link that would add value (provide full URL)
        
        SEO Rules Compliance:
        - Confirm the keyword appears in H1
        - Confirm the keyword appears in at least one H2
        - Confirm the keyword appears in the first paragraph
        - Confirm the keyword appears in the last paragraph
        - Confirm the keyword appears 2-4 additional times in the body
        - Confirm article length is between 600-1500 words
        - Confirm H1/H2/H3 hierarchy is clear
        - Confirm external link is not a competitor site
      `;
      
      // Call Gemini API through our service
      const response = await geminiService.generateContent(prompt);
      
      // Parse the response into structured data
      return this.parseGeminiAnalysisResponse(response, keyword);
    } catch (error) {
      console.error('Error analyzing with Gemini:', error);
      throw new Error('Failed to analyze content with Gemini API');
    }
  }
  
  /**
   * Parse the Gemini response into structured keyword analysis data
   */
  private parseGeminiAnalysisResponse(response: string, keyword: string): KeywordAnalysisResult {
    // Initialize default values
    const result: KeywordAnalysisResult = {
      pageGoals: [],
      headings: {
        h1: [],
        h2: [],
        h3: []
      },
      avgWordCount: 1000,
      keywordDensity: 2.0,
      suggestedQA: [],
      recommendedExternalLink: ''
    };
    
    try {
      // Extract Page Goals
      const goalsMatch = response.match(/Page Goals:\n([\s\S]*?)(?=\n\n|$)/);
      if (goalsMatch && goalsMatch[1]) {
        result.pageGoals = goalsMatch[1]
          .split('\n')
          .filter(line => line.trim().startsWith('-'))
          .map(line => line.replace(/^-/, '').trim());
      }
      
      // Extract H1 Headings
      const h1Match = response.match(/H1:\n([\s\S]*?)(?=\n\n|$)/);
      if (h1Match && h1Match[1]) {
        result.headings.h1 = h1Match[1]
          .split('\n')
          .filter(line => line.trim().startsWith('-'))
          .map(line => line.replace(/^-/, '').trim());
      }
      
      // Extract H2 Headings
      const h2Match = response.match(/H2:\n([\s\S]*?)(?=\n\n|$)/);
      if (h2Match && h2Match[1]) {
        result.headings.h2 = h2Match[1]
          .split('\n')
          .filter(line => line.trim().startsWith('-'))
          .map(line => line.replace(/^-/, '').trim());
      }
      
      // Extract H3 Headings
      const h3Match = response.match(/H3:\n([\s\S]*?)(?=\n\n|$)/);
      if (h3Match && h3Match[1]) {
        result.headings.h3 = h3Match[1]
          .split('\n')
          .filter(line => line.trim().startsWith('-'))
          .map(line => line.replace(/^-/, '').trim());
      }
      
      // Extract Average Word Count
      const wordCountMatch = response.match(/Average Word Count:\n-.*?(\d+)/);
      if (wordCountMatch && wordCountMatch[1]) {
        result.avgWordCount = parseInt(wordCountMatch[1], 10);
      }
      
      // Extract Keyword Density
      const densityMatch = response.match(/Keyword Density:\n-.*?([\d.]+)/);
      if (densityMatch && densityMatch[1]) {
        result.keywordDensity = parseFloat(densityMatch[1]);
      }
      
      // Extract Suggested Q&A
      const qaMatch = response.match(/Suggested Q&A:\n([\s\S]*?)(?=\n\n|$)/);
      if (qaMatch && qaMatch[1]) {
        result.suggestedQA = qaMatch[1]
          .split('\n')
          .filter(line => line.trim().startsWith('-'))
          .map(line => line.replace(/^-/, '').trim());
      }
      
      // Extract Recommended External Link
      const linkMatch = response.match(/Recommended External Link:\n-.*?(https?:\/\/[^\s\n]+)/);
      if (linkMatch && linkMatch[1]) {
        result.recommendedExternalLink = linkMatch[1];
      }
      
      return result;
    } catch (error) {
      console.error('Error parsing Gemini response:', error);
      // Return default values if parsing fails
      return result;
    }
  }
  
  /**
   * Store analysis results in database
   */
  private async storeAnalysis(keyword: string, analysis: KeywordAnalysisResult): Promise<string> {
    try {
      // Type assertion to bypass TypeScript error
      const keywordAnalysisModel = (prisma as any).keywordAnalysis;
      
      const result = await keywordAnalysisModel.create({
        data: {
          keyword,
          pageGoals: JSON.stringify(analysis.pageGoals),
          h1Headlines: JSON.stringify(analysis.headings.h1),
          h2Headlines: JSON.stringify(analysis.headings.h2),
          h3Headlines: JSON.stringify(analysis.headings.h3),
          avgWordCount: analysis.avgWordCount,
          keywordDensity: analysis.keywordDensity,
          suggestedQA: JSON.stringify(analysis.suggestedQA),
          recommendedExternalLink: analysis.recommendedExternalLink,
          analysisDate: new Date()
        }
      });
      
      return result.id;
    } catch (error) {
      console.error('Error storing analysis:', error);
      throw new Error('Failed to store keyword analysis');
    }
  }
  
  /**
   * Get stored analysis by ID
   */
  async getAnalysisById(id: string) {
    try {
      // Type assertion to bypass TypeScript error
      const keywordAnalysisModel = (prisma as any).keywordAnalysis;
      
      const analysis = await keywordAnalysisModel.findUnique({
        where: { id }
      });
      
      if (!analysis) {
        throw new Error('Keyword analysis not found');
      }
      
      return {
        id: analysis.id,
        keyword: analysis.keyword,
        pageGoals: JSON.parse(analysis.pageGoals as string),
        headings: {
          h1: JSON.parse(analysis.h1Headlines as string),
          h2: JSON.parse(analysis.h2Headlines as string),
          h3: JSON.parse(analysis.h3Headlines as string)
        },
        avgWordCount: analysis.avgWordCount,
        keywordDensity: analysis.keywordDensity,
        suggestedQA: JSON.parse(analysis.suggestedQA as string),
        recommendedExternalLink: analysis.recommendedExternalLink,
        analysisDate: analysis.analysisDate
      };
    } catch (error) {
      console.error('Error retrieving analysis:', error);
      throw new Error('Failed to retrieve keyword analysis');
    }
  }
}

// Export singleton instance
export const keywordAnalysisService = new KeywordAnalysisService();