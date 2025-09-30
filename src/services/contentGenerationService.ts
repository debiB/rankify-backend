import { prisma } from '../utils/prisma';
import { geminiService } from './geminiService';
import { contentPlanService } from './contentPlanService';
import { brandService } from './brandService';
import { keywordAnalysisService } from './keywordAnalysisService';

// Types for our generated content
export interface GeneratedContentData {
  contentPlanId: string;
  articleText: string;
  style: string;
  intro: string;
  qnaSections: string[];
  externalLink: string | null;
  finalized: boolean;
}

// Extended interface for generated content with relations
export interface GeneratedContentWithRelations extends GeneratedContentData {
  id: string;
  createdAt: Date;
  contentPlan?: any;
}

export interface GeneratedContent extends GeneratedContentData {
  id: string;
  createdAt: Date;
}

// Style options
export type ContentStyle = 'מאמר' | 'יח״צ' | 'בקלינק';

export class ContentGenerationService {
  /**
   * Generate article content using Gemini API based on content plan, brand profile, and style
   * @param contentPlanId The ID of the approved content plan
   * @param brandProfileId The ID of the brand profile to use for tone and style
   * @param style The writing style to use (מאמר,arih״צ, orinkelink)
   * @returns The generated content ID
   */
  async generateContent(contentPlanId: string, brandProfileId: string, style: ContentStyle): Promise<string> {
    try {
      // Fetch the content plan
      const contentPlan = await contentPlanService.getContentPlanById(contentPlanId);
      
      // Check if content plan is approved
      if (!contentPlan.adminApproved) {
        throw new Error('Content plan must be approved before generating content');
      }
      
      // Fetch the keyword analysis
      const keywordAnalysis = await keywordAnalysisService.getAnalysisById(contentPlan.keywordAnalysisId);
      
      // Fetch the brand profile
      const brandProfile = await brandService.getBrandProfile(brandProfileId);
      
      if (!brandProfile) {
        throw new Error('Brand profile not found');
      }
      
      // Generate the article content using Gemini
      const generatedArticle = await this.generateArticleWithGemini(
        contentPlan,
        keywordAnalysis,
        brandProfile.toneData,
        style
      );
      
      // Store the generated content in the database
      const generatedContent = await prisma.generatedContent.create({
        data: {
          contentPlanId,
          articleText: generatedArticle.articleText,
          style,
          intro: generatedArticle.intro,
          qnaSections: JSON.stringify(generatedArticle.qnaSections),
          externalLink: generatedArticle.externalLink,
          finalized: false // Content is not finalized by default
        }
      });
      
      return generatedContent.id;
    } catch (error) {
      console.error('Error generating content:', error);
      throw new Error(`Failed to generate content: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Get generated content by ID
   * @param id The generated content ID
   * @returns The generated content
   */
  async getGeneratedContentById(id: string): Promise<GeneratedContentWithRelations> {
    try {
      const generatedContent = await prisma.generatedContent.findUnique({
        where: { id },
        include: {
          contentPlan: {
            include: {
              keywordAnalysis: true
            }
          }
        }
      });
      
      if (!generatedContent) {
        throw new Error('Generated content not found');
      }
      
      return {
        id: generatedContent.id,
        contentPlanId: generatedContent.contentPlanId,
        articleText: generatedContent.articleText,
        style: generatedContent.style,
        intro: generatedContent.intro,
        qnaSections: JSON.parse(generatedContent.qnaSections as string),
        externalLink: generatedContent.externalLink,
        finalized: generatedContent.finalized,
        createdAt: generatedContent.createdAt,
        contentPlan: generatedContent.contentPlan
      };
    } catch (error) {
      console.error('Error retrieving generated content:', error);
      throw new Error(`Failed to retrieve generated content: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Finalize generated content (mark as complete)
   * @param id The generated content ID
   * @returns The updated generated content
   */
  async finalizeContent(id: string): Promise<GeneratedContent> {
    try {
      const generatedContent = await prisma.generatedContent.update({
        where: { id },
        data: { finalized: true }
      });
      
      return {
        id: generatedContent.id,
        contentPlanId: generatedContent.contentPlanId,
        articleText: generatedContent.articleText,
        style: generatedContent.style,
        intro: generatedContent.intro,
        qnaSections: JSON.parse(generatedContent.qnaSections as string),
        externalLink: generatedContent.externalLink,
        finalized: generatedContent.finalized,
        createdAt: generatedContent.createdAt
      };
    } catch (error) {
      console.error('Error finalizing content:', error);
      throw new Error(`Failed to finalize content: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Update generated content
   * @param id The generated content ID
   * @param updates The updates to apply
   * @returns The updated generated content
   */
  async updateGeneratedContent(
    id: string,
    updates: Partial<Omit<GeneratedContentData, 'contentPlanId' | 'finalized'>>
  ): Promise<GeneratedContent> {
    try {
      const updateData: any = {};
      
      // Only include fields that are being updated
      if (updates.articleText !== undefined) updateData.articleText = updates.articleText;
      if (updates.style !== undefined) updateData.style = updates.style;
      if (updates.intro !== undefined) updateData.intro = updates.intro;
      if (updates.qnaSections !== undefined) updateData.qnaSections = JSON.stringify(updates.qnaSections);
      if (updates.externalLink !== undefined) updateData.externalLink = updates.externalLink;
      
      const generatedContent = await prisma.generatedContent.update({
        where: { id },
        data: updateData
      });
      
      return {
        id: generatedContent.id,
        contentPlanId: generatedContent.contentPlanId,
        articleText: generatedContent.articleText,
        style: generatedContent.style,
        intro: generatedContent.intro,
        qnaSections: JSON.parse(generatedContent.qnaSections as string),
        externalLink: generatedContent.externalLink,
        finalized: generatedContent.finalized,
        createdAt: generatedContent.createdAt
      };
    } catch (error) {
      console.error('Error updating generated content:', error);
      throw new Error(`Failed to update generated content: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Generate article content using Gemini API
   */
  private async generateArticleWithGemini(
    contentPlan: any,
    keywordAnalysis: any,
    brandToneData: any,
    style: ContentStyle
  ): Promise<Omit<GeneratedContentData, 'contentPlanId' | 'finalized'>> {
    try {
      // Create a prompt for Gemini based on all the inputs
      const prompt = this.createGeminiPrompt(contentPlan, keywordAnalysis, brandToneData, style);
      
      // Generate content with Gemini using the public method
      const text = await geminiService.generateContent(prompt);
      
      // Parse the response to extract structured content
      return this.parseGeminiResponse(text, contentPlan, keywordAnalysis);
    } catch (error) {
      console.error('Error generating article with Gemini:', error);
      throw new Error('Failed to generate article content with AI');
    }
  }

  /**
   * Simulate Gemini response for testing purposes
   * In a real implementation, this would call the actual Gemini API
   */
  private async simulateGeminiResponse(prompt: string): Promise<string> {
    // This is a placeholder implementation
    // In a real scenario, you would call geminiService.generateContent(prompt)
    return `
      INTRO_START
      This article provides comprehensive information about the topic, helping readers understand key concepts and best practices.
      INTRO_END
      
      ARTICLE_TEXT_START
      <h1>Complete Guide to the Topic</h1>
      <p>This is the main content of the article...</p>
      <h2>Key Concepts</h2>
      <p>Important information about the topic...</p>
      <h3>Subsection Details</h3>
      <p>More detailed information...</p>
      ARTICLE_TEXT_END
      
      QNA_SECTIONS_START
      What are the benefits?
      The benefits include...
      ---
      How to get started?
      To get started, you should...
      QNA_SECTIONS_END
      
      EXTERNAL_LINK_START
      https://example.com
      EXTERNAL_LINK_END
    `;
  }
  
  /**
   * Create a detailed prompt for Gemini based on content plan, keyword analysis, brand tone, and style
   */
  private createGeminiPrompt(
    contentPlan: any,
    keywordAnalysis: any,
    brandToneData: any,
    style: ContentStyle
  ): string {
    // Map Hebrew style names to English descriptions
    const styleDescriptions: Record<ContentStyle, string> = {
      'מאמר': 'standard article format with formal tone and comprehensive information',
      'יח״צ': 'press release format with announcement-style writing and company news focus',
      'בקלינק': 'BQlink brand style with conversational tone and digital marketing expertise'
    };
    
    // Create brand tone description
    const brandToneDescription = `
      Brand Tone: ${brandToneData.tone.join(', ')}
      Writing Style: Sentence length - ${brandToneData.style.sentenceLength}, Readability - ${brandToneData.style.readability}
      First Person Usage: ${brandToneData.style.firstPersonUsage ? 'Yes' : 'No'}
      Headline Style: ${brandToneData.structure.headlineStyle}
      Subheading Style: ${brandToneData.structure.subheadingStyle}
    `;
    
    // Create keyword placement guidelines
    const keywordGuidelines = contentPlan.keywordPlacement.join('\n');
    
    // Create Q&A sections if suggested QA exists
    const qaSection = keywordAnalysis.suggestedQA && keywordAnalysis.suggestedQA.length > 0
      ? `Include Q&A sections addressing these questions:\n${keywordAnalysis.suggestedQA.slice(0, 5).join('\n')}`
      : 'Include relevant Q&A sections where appropriate';
    
    return `
      You are an expert content writer. Write a comprehensive article in Hebrew based on the following requirements:
      
      Topic: ${keywordAnalysis.keyword}
      Article Goal: ${contentPlan.articleGoal}
      
      Style: ${style} (${styleDescriptions[style]})
      
      Brand Guidelines:
      ${brandToneDescription}
      
      Content Structure Requirements:
      - Word Count Target: ${contentPlan.recommendedWordCount} words (between 600-1500 words)
      - Main Headlines (H1): ${contentPlan.headlines.join(', ')}
      - Subheadings (H2/H3): ${contentPlan.subheadings.join(', ')}
      
      Keyword Placement Rules:
      ${keywordGuidelines}
      
      ${qaSection}
      
      External Link: ${keywordAnalysis.recommendedExternalLink || 'Include one relevant external link contextually'}
      
      Specific Requirements:
      1. Intro section should clearly state the purpose and desired outcome
      2. Follow the approved headline hierarchy (H1/H2/H3)
      3. Include Q&A sections where applicable
      4. Embed one external link contextually
      5. Include the keyword per placement rules
      6. Word count should be between 600-1500 words
      7. Write in the specified style: ${style}
      
      Please format your response as follows:
      
      INTRO_START
      [Write the introduction here - clearly stating purpose and desired outcome]
      INTRO_END
      
      ARTICLE_TEXT_START
      [Write the complete article text here with proper H1/H2/H3 headings]
      ARTICLE_TEXT_END
      
      QNA_SECTIONS_START
      [List Q&A sections separated by "---"]
      QNA_SECTIONS_END
      
      EXTERNAL_LINK_START
      [Provide the external link URL]
      EXTERNAL_LINK_END
    `;
  }
  
  /**
   * Parse the Gemini response into structured content
   */
  private parseGeminiResponse(
    response: string,
    contentPlan: any,
    keywordAnalysis: any
  ): Omit<GeneratedContentData, 'contentPlanId' | 'finalized'> {
    try {
      // Extract intro section
      const introMatch = response.match(/INTRO_START\s*([\s\S]*?)\s*INTRO_END/);
      const intro = introMatch ? introMatch[1].trim() : '';
      
      // Extract article text
      const articleMatch = response.match(/ARTICLE_TEXT_START\s*([\s\S]*?)\s*ARTICLE_TEXT_END/);
      const articleText = articleMatch ? articleMatch[1].trim() : '';
      
      // Extract Q&A sections
      const qnaMatch = response.match(/QNA_SECTIONS_START\s*([\s\S]*?)\s*QNA_SECTIONS_END/);
      let qnaSections: string[] = [];
      
      if (qnaMatch) {
        const qnaContent = qnaMatch[1].trim();
        qnaSections = qnaContent.split('---').map(section => section.trim()).filter(section => section.length > 0);
      }
      
      // Extract external link
      const linkMatch = response.match(/EXTERNAL_LINK_START\s*([\s\S]*?)\s*EXTERNAL_LINK_END/);
      const externalLink = linkMatch ? linkMatch[1].trim() : keywordAnalysis.recommendedExternalLink || null;
      
      return {
        articleText,
        style: contentPlan.style,
        intro,
        qnaSections,
        externalLink
      };
    } catch (error) {
      console.error('Error parsing Gemini response:', error);
      throw new Error('Failed to parse AI-generated content');
    }
  }
}

// Export a singleton instance
export const contentGenerationService = new ContentGenerationService();