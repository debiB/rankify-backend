import { prisma } from '../utils/prisma';
import { keywordAnalysisService } from './keywordAnalysisService';
import { brandService } from './brandService';
import { geminiService } from './geminiService';

// Define the structure for our article outline
export interface ArticleStructure {
  goal: string;
  headline: string;
  structure: Array<{
    H2: string;
    subheadings: string[];
  }>;
}

export class ArticleStructureService {
  /**
   * Generate an article structure based on keyword analysis and brand tone
   * @param keywordAnalysisId The ID of the keyword analysis to use
   * @param brandProfileId Optional ID of the brand profile to use for tone and style
   * @returns The generated article structure in JSON format
   */
  async generateArticleStructure(
    keywordAnalysisId: string,
    brandProfileId?: string
  ): Promise<ArticleStructure> {
    try {
      // Get the keyword analysis data
      const keywordAnalysis = await keywordAnalysisService.getAnalysisById(keywordAnalysisId);
      
      // Get brand tone and style if provided
      let brandToneStyle = null;
      if (brandProfileId) {
        const brandProfile = await brandService.getBrandProfile(brandProfileId);
        if (brandProfile && brandProfile.toneData) {
          brandToneStyle = brandProfile.toneData;
        }
      }
      
      // Generate the article structure using Gemini
      const structure = await this.generateStructureWithAI(keywordAnalysis, brandToneStyle);
      
      return structure;
    } catch (error) {
      console.error('Error generating article structure:', error);
      throw new Error(`Failed to generate article structure: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Generate article structure using AI with keyword analysis and brand tone
   */
  private async generateStructureWithAI(
    keywordAnalysis: any,
    brandToneStyle: any
  ): Promise<ArticleStructure> {
    // Create prompt for Gemini
    const prompt = this.createStructurePrompt(keywordAnalysis, brandToneStyle);
    
    try {
      // Call Gemini API
      const response = await geminiService.generateContent(prompt, 3, 1000);
      
      // Parse the response into our structured format
      return this.parseStructureResponse(response);
    } catch (error) {
      console.error('Error generating structure with AI:', error);
      throw new Error(`Failed to generate structure with AI: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Create the prompt for generating article structure
   */
  private createStructurePrompt(keywordAnalysis: any, brandToneStyle: any): string {
    let prompt = `
      As an AI content planner, create a structured article outline based on the following inputs:
      
      Target Keyword: ${keywordAnalysis.keyword}
    `;
    
    // Add brand tone and style if available
    if (brandToneStyle) {
      prompt += `
        Brand Tone and Style Information:
        Tone: ${brandToneStyle.tone.join(', ')}
        Style: Sentence length - ${brandToneStyle.style.sentenceLength}, Readability - ${brandToneStyle.style.readability}
        Brand Voice Characteristics: ${brandToneStyle.brandVoiceCharacteristics.join(', ')}
        Target Audience Insights: ${brandToneStyle.targetAudienceInsights.join(', ')}
        Value Proposition: ${brandToneStyle.valueProposition}
        Communication Principles: ${brandToneStyle.communicationPrinciples.join(', ')}
      `;
    }
    
    // Add keyword analysis data
    prompt += `
      Keyword Analysis Insights:
      Page Goals: ${keywordAnalysis.pageGoals.slice(0, 3).join('; ')}
      H1 Headlines from top pages: ${keywordAnalysis.headings.h1.slice(0, 3).join('; ')}
      H2 Headlines from top pages: ${keywordAnalysis.headings.h2.slice(0, 5).join('; ')}
      H3 Headlines from top pages: ${keywordAnalysis.headings.h3.slice(0, 5).join('; ')}
      Average Word Count: ${keywordAnalysis.avgWordCount}
      Keyword Density: ${keywordAnalysis.keywordDensity}%
      
      Your Task:
      Create a compelling article structure that:
      1. Aligns with the brand tone and style (if provided)
      2. Incorporates keyword analysis for SEO relevance
      3. Has a logical flow and readability
      4. Avoids repetition across sections
      5. Produces natural, engaging section titles
      
      Output Format Requirements:
      Respond ONLY with a valid JSON object in the exact format below. Do not include any additional text, markdown, or explanation:
      
      {
        "goal": "string (1-2 sentences describing the purpose, audience, and intended outcome)",
        "headline": "string (compelling H1 headline reflecting the goal and target keyword)",
        "structure": [
          {
            "H2": "string (main section title)",
            "subheadings": ["string", "string"] 
          }
        ]
      }
    `;
    
    return prompt;
  }
  
  /**
   * Parse the AI response into our structured format
   */
  private parseStructureResponse(response: string): ArticleStructure {
    try {
      // Clean the response to extract only the JSON
      let cleanResponse = response.trim();
      
      // Remove markdown code block markers if present
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.substring(7);
      } else if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.substring(3);
      }
      
      if (cleanResponse.endsWith('```')) {
        cleanResponse = cleanResponse.substring(0, cleanResponse.length - 3);
      }
      
      // Parse the JSON
      const structure: ArticleStructure = JSON.parse(cleanResponse);
      
      // Validate the structure
      if (!structure.goal || !structure.headline || !Array.isArray(structure.structure)) {
        throw new Error('Invalid structure format');
      }
      
      // Validate each section
      for (const section of structure.structure) {
        if (!section.H2 || !Array.isArray(section.subheadings)) {
          throw new Error('Invalid section format');
        }
      }
      
      return structure;
    } catch (error) {
      console.error('Error parsing structure response:', error);
      throw new Error(`Failed to parse AI response into valid structure format: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Create a default structure if AI generation fails
   */
  private createDefaultStructure(keywordAnalysis: any): ArticleStructure {
    return {
      goal: `Provide comprehensive information about ${keywordAnalysis.keyword} to help users understand its importance and application.`,
      headline: `The Ultimate Guide to ${keywordAnalysis.keyword}`,
      structure: [
        {
          H2: `What is ${keywordAnalysis.keyword}?`,
          subheadings: [
            "Definition and basic explanation",
            "Key components and characteristics"
          ]
        },
        {
          H2: `Why ${keywordAnalysis.keyword} Matters`,
          subheadings: [
            "Benefits and advantages",
            "Common use cases"
          ]
        },
        {
          H2: `How to Implement ${keywordAnalysis.keyword}`,
          subheadings: [
            "Step-by-step process",
            "Best practices and tips"
          ]
        },
        {
          H2: `Common Challenges and Solutions`,
          subheadings: [
            "Frequent issues encountered",
            "Strategies to overcome obstacles"
          ]
        },
        {
          H2: `Conclusion`,
          subheadings: [
            "Key takeaways",
            "Next steps for implementation"
          ]
        }
      ]
    };
  }
}

// Export singleton instance
export const articleStructureService = new ArticleStructureService();