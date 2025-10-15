import { prisma } from '../utils/prisma';
import { geminiService } from './geminiService';
import { contentPlanService } from './contentPlanService';
import { brandService } from './brandService';
import { keywordAnalysisService } from './keywordAnalysisService';

// Types for content blocks (new JSON structure)
export interface ContentBlock {
  headingType: 'h1' | 'h2' | 'h3';
  headingText: string;
  bodyText: string;
}

// Types for our generated content
export interface GeneratedContentData {
  contentPlanId: string;
  articleContent: ContentBlock[]; // Structured format only
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
  updatedAt: Date;
  contentPlan?: any;
}

export interface GeneratedContent extends GeneratedContentData {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

// Style options
export type ContentStyle = 'מאמר' | 'יח״צ' | 'בקלינק';

export class ContentGenerationService {
  /**
   * Generate article content using Gemini API based on content plan, brand profile, and style
   * @param contentPlanId The ID of the approved content plan
   * @param brandProfileId The ID of the brand profile to use for tone and style
   * @param style The writing style to use (מאמר,arih״צ, orinkelink)
   * @param language The language to generate content in (default: 'he')
   * @returns The generated content ID
   */
  async generateContent(contentPlanId: string, brandProfileId: string, style: ContentStyle, language: string = 'he'): Promise<string> {
    try {
      // Fetch the content plan
      const contentPlan = await contentPlanService.getContentPlanById(contentPlanId);
      
      // NOTE: Removed the approval check to allow content regeneration on any plan update
      // Check if content plan is approved
      // if (!contentPlan.adminApproved) {
      //   throw new Error('Content plan must be approved before generating content');
      // }
      
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
        style,
        language
      );
      
      // Store the generated content in the database
      const generatedContent = await prisma.generatedContent.create({
        data: {
          contentPlanId,
          articleContent: JSON.stringify(generatedArticle.articleContent), // Store structured content blocks as JSON
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
   * @param id The ID of the generated content
   * @returns The generated content
   */
  async getGeneratedContentById(id: string): Promise<GeneratedContent> {
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
        throw new Error(`Generated content with ID ${id} not found`);
      }
      
      // Parse JSON fields
      let qnaSections: string[] = [];
      let articleContent: ContentBlock[] = [];
      
      try {
        if (generatedContent.qnaSections) {
          const parsedQna = JSON.parse(String(generatedContent.qnaSections));
          qnaSections = Array.isArray(parsedQna) ? parsedQna : [];
        }
      } catch (e) {
        console.error('Error parsing qnaSections:', e);
        qnaSections = [];
      }
      
      try {
        if (generatedContent.articleContent) {
          const raw = JSON.parse(String(generatedContent.articleContent));
          if (Array.isArray(raw)) {
            articleContent = raw.map((b: any) => {
              const type = (b.headingType ?? b.heading_type ?? '').toString().toLowerCase();
              return {
                headingType: (['h1','h2','h3'].includes(type) ? type : 'h2') as 'h1'|'h2'|'h3',
                headingText: (b.headingText ?? b.heading_text ?? '').toString(),
                bodyText: (b.bodyText ?? b.body_text ?? '').toString(),
              };
            });
          } else {
            articleContent = [];
          }
        } else if ((generatedContent as any).articleText) {
          // Legacy fallback: parse old articleText into blocks
          articleContent = this.parseArticleTextToBlocks((generatedContent as any).articleText);
        }
      } catch (e) {
        console.error('Error parsing articleContent:', e);
        articleContent = [];
      }

      // Return the content with relations
      return {
        id: generatedContent.id,
        contentPlanId: generatedContent.contentPlanId,
        articleContent,
        style: generatedContent.style || '',
        intro: generatedContent.intro || '',
        qnaSections,
        externalLink: generatedContent.externalLink,
        finalized: generatedContent.finalized,
        createdAt: generatedContent.createdAt,
        updatedAt: generatedContent.updatedAt,
        contentPlan: generatedContent.contentPlan
      } as any;
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
      
      // Ensure articleContent is parsed to new structure
      let articleContent: ContentBlock[] = [];
      try {
        if (generatedContent.articleContent) {
          const raw = JSON.parse(String(generatedContent.articleContent));
          articleContent = Array.isArray(raw) ? raw.map((b: any) => ({
            headingType: (String(b.headingType ?? b.heading_type ?? 'h2').toLowerCase()) as 'h1'|'h2'|'h3',
            headingText: String(b.headingText ?? b.heading_text ?? ''),
            bodyText: String(b.bodyText ?? b.body_text ?? ''),
          })) : [];
        }
      } catch {}
      
      return {
        id: generatedContent.id,
        contentPlanId: generatedContent.contentPlanId,
        articleContent,
        style: generatedContent.style || '',
        intro: generatedContent.intro || '',
        qnaSections: (() => { try { return JSON.parse(String(generatedContent.qnaSections)); } catch { return []; } })(),
        externalLink: generatedContent.externalLink,
        finalized: generatedContent.finalized,
        createdAt: generatedContent.createdAt,
        updatedAt: generatedContent.updatedAt
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
  async update(id: string, data: Partial<GeneratedContentData>): Promise<GeneratedContent> {
    try {
      // Create a new update data object
      const updateData: any = {};
      
      // Handle articleContent if provided
      if (data.articleContent) {
        updateData.articleContent = JSON.stringify(data.articleContent);
      }
      
      // Copy other fields directly
      if (data.style !== undefined) updateData.style = data.style;
      if (data.intro !== undefined) updateData.intro = data.intro;
      if (data.externalLink !== undefined) updateData.externalLink = data.externalLink;
      if (data.finalized !== undefined) updateData.finalized = data.finalized;
      
      // Handle qnaSections if provided
      if (data.qnaSections) {
        updateData.qnaSections = typeof data.qnaSections === 'string'
          ? data.qnaSections
          : JSON.stringify(data.qnaSections);
      }

      await prisma.generatedContent.update({
        where: { id },
        data: updateData
      });
      
      // Get the updated content with proper parsing
      return await this.getGeneratedContentById(id);
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
    style: ContentStyle,
    language: string
  ): Promise<Omit<GeneratedContentData, 'contentPlanId' | 'finalized'>> {
    try {
      // Create a prompt for Gemini based on all the inputs
      const prompt = this.createGeminiPrompt(contentPlan, keywordAnalysis, brandToneData, style, language);
      
      
      
      // Generate content with Gemini using the public method
      const text = await geminiService.generateContent(prompt);
      
     
      
      // Parse the response to extract structured content
      const parsed = this.parseGeminiResponse(text, contentPlan, keywordAnalysis);
      
      
      return parsed;
    } catch (error) {
      console.error('Error generating article with Gemini:', error);
      throw new Error(`Failed to generate article content with AI: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create a detailed prompt for Gemini based on content plan, keyword analysis, brand tone, and style
   */
  private createGeminiPrompt(
    contentPlan: any,
    keywordAnalysis: any,
    brandToneData: any,
    style: ContentStyle,
    language: string
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
    
    // Map language codes to full names
    const languageMap: Record<string, string> = {
      'he': 'Hebrew',
      'en': 'English',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'ru': 'Russian',
      'ja': 'Japanese',
      'zh': 'Chinese'
    };
    
    const languageName = languageMap[language] || 'Hebrew'; // Default to Hebrew if not found
    
    return `
      You are an expert content writer. Produce a complete article in ${languageName} following these inputs and constraints.
      
      Topic: ${keywordAnalysis.keyword}
      Article Goal: ${contentPlan.articleGoal}
      Style: ${style} (${styleDescriptions[style]})
      
      Brand Guidelines:
      ${brandToneDescription}
      
      Content Structure Requirements:
      - Target length: ${contentPlan.recommendedWordCount} words (acceptable range 600-1500)
      - Main Headlines (H1): ${contentPlan.headlines.join(', ')}
      - Subheadings (H2/H3): ${contentPlan.subheadings.join(', ')}
      - Keyword Placement Rules:
      ${keywordGuidelines}
      - ${qaSection}
      - External Link: ${keywordAnalysis.recommendedExternalLink || 'Include one relevant external link contextually'}
      
      OUTPUT FORMAT (STRICT):
      - Return ONLY a single JSON object. No prose, no markdown, no extra text.
      - The JSON shape MUST be exactly:
      {
        "intro": "string",
        "articleContent": [
          { "headingType": "h1"|"h2"|"h3", "headingText": "string", "bodyText": "string" }
        ],
        "qnaSections": ["string"],
        "externalLink": "string|null"
      }
      
      Rules:
      - headingType values must be lowercase: "h1", "h2", or "h3".
      - headingText and bodyText must not contain markdown (#, *, _, ~~) or HTML tags.
      - Maintain logical heading hierarchy (start with one h1, followed by h2/h3).
      - Ensure articleContent fully represents the article body; do not include Q&A or External Links there.
      - Ensure the JSON is valid and parseable.
    `;
  }
  
  /**
   * Parse text and separate headings from content
   * @param text The text to parse
   * @returns Object with headings array and content string
   */
  private parseHeadingsAndContent(text: string): { headings: string[]; subheadings: string[]; content: string } {
    if (!text) return { headings: [], subheadings: [], content: "" };
    
    const lines = text.split('\n');
    const headings: string[] = [];
    const subheadings: string[] = [];
    const contentLines: string[] = [];
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      // Check if line is a heading in the new format
      if (trimmedLine.startsWith('Heading1:')) {
        // Extract the heading text (remove "Heading1:" prefix)
        const headingText = trimmedLine.substring(9).trim();
        if (headingText) {
          headings.push(headingText);
        }
      } else if (trimmedLine.startsWith('H2:') || trimmedLine.startsWith('H3:')) {
        // Extract the subheading text (remove "H2:" or "H3:" prefix)
        const prefixLength = trimmedLine.startsWith('H2:') ? 3 : 3;
        const subheadingText = trimmedLine.substring(prefixLength).trim();
        if (subheadingText) {
          subheadings.push(subheadingText);
        }
      } else {
        contentLines.push(line);
      }
    }
    
    return {
      headings,
      subheadings,
      content: contentLines.join('\n')
    };
  }

  /**
   * Clean text by removing common markdown-like formatting and other unwanted characters
   * @param text The text to clean
   * @returns Cleaned text
   */
  private cleanTextFormatting(text: string): string {
    if (!text) return '';
    
    return text
      .replace(/\*\*/g, '') // Remove double asterisks
      .replace(/\*/g, '') // Remove single asterisks
      .replace(/__/g, '') // Remove double underscores
      .replace(/_/g, '') // Remove single underscores
      .replace(/#{1,6}\s*/g, '') // Remove markdown headers (# ## ### etc)
      .replace(/~~/g, '') // Remove strikethrough
      .replace(/`/g, '') // Remove backticks
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove markdown links, keep text
      .trim();
  }

  /**
   * Remove Q&A and External Links sections from article text
   * @param articleText The article text to clean
   * @param qnaSections The Q&A sections to remove
   * @returns Article text with Q&A and External Links sections removed
   */
  private removeQnaAndLinksFromArticleText(articleText: string, qnaSections: string[]): string {
    if (!articleText) {
      return articleText;
    }

    let cleanedArticleText = articleText;

    // Remove Q&A sections if present
    if (qnaSections && qnaSections.length > 0) {
      for (const qna of qnaSections) {
        const lines = qna.split('\n').filter(line => line.trim().length > 0);
        
        if (lines.length > 0) {
          const firstLine = lines[0].trim();
          const escapedFirstLine = firstLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const qnaPattern = new RegExp(`.*${escapedFirstLine}.*?(?=\\n\\n|Heading1:|H2:|H3:|$)`, 'gs');
          cleanedArticleText = cleanedArticleText.replace(qnaPattern, '');
        }
      }
    }

    // Remove Q&A section headers and content
    cleanedArticleText = cleanedArticleText.replace(/H2:\s*Q&A[\s\S]*?(?=Heading1:|H2:|H3:|$)/gi, '');
    cleanedArticleText = cleanedArticleText.replace(/H2:\s*Questions?\s*(&|and)\s*Answers?[\s\S]*?(?=Heading1:|H2:|H3:|$)/gi, '');
    
    // Remove External Links section headers and content
    cleanedArticleText = cleanedArticleText.replace(/H2:\s*External\s*Links?[\s\S]*?(?=Heading1:|H2:|H3:|$)/gi, '');
    cleanedArticleText = cleanedArticleText.replace(/H2:\s*References?[\s\S]*?(?=Heading1:|H2:|H3:|$)/gi, '');
    cleanedArticleText = cleanedArticleText.replace(/H2:\s*Sources?[\s\S]*?(?=Heading1:|H2:|H3:|$)/gi, '');
    
    // Clean up any extra whitespace
    return cleanedArticleText.replace(/\s+/g, ' ').trim();
  }

  private parseGeminiResponse(
    response: string,
    contentPlan: any,
    keywordAnalysis: any
  ): Omit<GeneratedContentData, 'contentPlanId' | 'finalized'> {
    try {
      // Try to extract JSON from response if it's wrapped in markdown code blocks
      let jsonString = response.trim();
      
      // Remove markdown code blocks if present
      if (jsonString.startsWith('```json')) {
        jsonString = jsonString.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (jsonString.startsWith('```')) {
        jsonString = jsonString.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      console.log('Attempting to parse JSON, length:', jsonString.length);
      
      // Prefer strict JSON response path
      const parsed = JSON.parse(jsonString);
      let intro = '';
      let qnaSections: string[] = [];
      let externalLink: string | null = keywordAnalysis.recommendedExternalLink || null;
      let articleContent: ContentBlock[] = [];

      if (Array.isArray(parsed)) {
        // Backward-compat: model returned just the array of blocks
        articleContent = parsed as any[];
      } else if (parsed && typeof parsed === 'object') {
        intro = typeof parsed.intro === 'string' ? parsed.intro : '';
        if (Array.isArray(parsed.qnaSections)) {
          qnaSections = parsed.qnaSections.filter((s: any) => typeof s === 'string');
        }
        if (typeof parsed.externalLink === 'string') {
          externalLink = parsed.externalLink;
        } else if (parsed.externalLink === null) {
          externalLink = null;
        }
        if (Array.isArray(parsed.articleContent)) {
          articleContent = parsed.articleContent as any[];
        }
      }

      // Normalize blocks and sanitize
      articleContent = (articleContent || []).map((b: any) => {
        const ht = (b.headingType ?? b.heading_type ?? '').toString().toLowerCase();
        const hx = (b.headingText ?? b.heading_text ?? '').toString()
          .replace(/[#*_~`]/g, '');
        const bt = (b.bodyText ?? b.body_text ?? '').toString()
          .replace(/[#*_~`]/g, '');
        return {
          headingType: (['h1','h2','h3'].includes(ht) ? ht : 'h2') as 'h1'|'h2'|'h3',
          headingText: hx,
          bodyText: bt,
        };
      });

      return {
        articleContent,
        style: contentPlan.style,
        intro,
        qnaSections,
        externalLink
      };
    } catch (jsonError) {
      // Fallback to legacy delimiter parsing if model didn't return JSON
      try {
        // Extract intro section
        const introMatch = response.match(/INTRO_START\s*([\s\S]*?)\s*INTRO_END/);
        let intro = introMatch ? introMatch[1].trim() : '';
        intro = intro.replace(/\*\*/g, '').replace(/\*/g, '').replace(/__/g, '').replace(/_/g, '');
        
        // Extract article text
        const articleMatch = response.match(/ARTICLE_TEXT_START\s*([\s\S]*?)\s*ARTICLE_TEXT_END/);
        let articleText = articleMatch ? articleMatch[1].trim() : '';
        articleText = articleText
          .replace(/\*\*/g, '')
          .replace(/\*/g, '')
          .replace(/__/g, '')
          .replace(/_/g, '')
          .replace(/#{1,6}\s*/g, '')
          .replace(/~~/g, '')
          .replace(/`/g, '');
        
        // Q&A
        const qnaMatch = response.match(/QNA_SECTIONS_START\s*([\s\S]*?)\s*QNA_SECTIONS_END/);
        let qnaSections: string[] = [];
        if (qnaMatch) {
          const qnaContent = qnaMatch[1].trim();
          qnaSections = qnaContent.split('---').map(section => section.trim()).filter(Boolean);
        }
        
        // Link
        const linkMatch = response.match(/EXTERNAL_LINK_START\s*([\s\S]*?)\s*EXTERNAL_LINK_END/);
        const externalLink = linkMatch ? linkMatch[1].trim() : keywordAnalysis.recommendedExternalLink || null;
        
        // Parse into blocks
        const articleContent = this.parseArticleTextToBlocks(articleText);
        
        return { articleContent, style: contentPlan.style, intro, qnaSections, externalLink };
      } catch (fallbackError) {
        console.error('Error parsing Gemini response (fallback):', fallbackError);
        throw new Error('Failed to parse AI-generated content');
      }
    }
  }

  /**
   * Helper method to extract plain text from structured content blocks
   * @param articleContent Array of content blocks
   * @returns Plain text representation of the content
   */
  extractTextFromContentBlocks(articleContent: ContentBlock[]): string {
    if (!articleContent || !Array.isArray(articleContent) || articleContent.length === 0) {
      return '';
    }
    
    return articleContent.map(block => {
      const headingPrefix = block.headingType === 'h1' ? 'Heading1: ' : 
                           block.headingType === 'h2' ? 'H2: ' : 
                           block.headingType === 'h3' ? 'H3: ' : '';
      
      const headingText = block.headingText ? `${headingPrefix}${block.headingText}\n` : '';
      const bodyText = block.bodyText ? `${block.bodyText}` : '';
      
      return `${headingText}${bodyText}`;
    }).join('\n\n');
  }

  /**
   * Parse article text into structured content blocks
   * @param articleText The article text with heading markers
   * @returns Array of content blocks with heading types and body text
   */
  private parseArticleTextToBlocks(articleText: string): ContentBlock[] {
    if (!articleText) return [];

    const blocks: ContentBlock[] = [];
    const lines = articleText.split('\n');
    
    let currentHeadingType: 'h1' | 'h2' | 'h3' = 'h1';
    let currentHeadingText = '';
    let bodyLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check if line is a heading
      if (line.startsWith('Heading1:') || line.startsWith('H2:') || line.startsWith('H3:')) {
        // Save previous block if exists
        if (currentHeadingText && bodyLines.length > 0) {
          blocks.push({
            headingType: currentHeadingType,
            headingText: currentHeadingText,
            bodyText: bodyLines.join('\n').trim()
          });
        }
        
        // Start new block based on heading type
        if (line.startsWith('Heading1:')) {
          currentHeadingType = 'h1';
          currentHeadingText = line.substring(9).trim();
        } else if (line.startsWith('H2:')) {
          currentHeadingType = 'h2';
          currentHeadingText = line.substring(3).trim();
        } else if (line.startsWith('H3:')) {
          currentHeadingType = 'h3';
          currentHeadingText = line.substring(3).trim();
        }
        bodyLines = [];
      } else if (line.length > 0) {
        // Add to body text
        bodyLines.push(line);
      } else if (bodyLines.length > 0) {
        // Empty line - preserve as paragraph break
        bodyLines.push('');
      }
    }

    // Save final block
    if (currentHeadingText && bodyLines.length > 0) {
      blocks.push({
        headingType: currentHeadingType,
        headingText: currentHeadingText,
        bodyText: bodyLines.join('\n').trim()
      });
    }

    // Handle case where there's body text before any heading
    if (blocks.length === 0 && bodyLines.length > 0) {
      blocks.push({
        headingType: 'h1',
        headingText: 'Introduction',
        bodyText: bodyLines.join('\n').trim()
      });
    }

    return blocks;
  }
}

// Export a singleton instance
export const contentGenerationService = new ContentGenerationService();