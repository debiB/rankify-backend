import { prisma } from '../utils/prisma';
import { keywordAnalysisService } from './keywordAnalysisService';

// Define types for our content plan
interface HeadlineStructure {
  level: 'H1' | 'H2' | 'H3';
  text: string;
}

export interface ContentPlanData {
  keywordAnalysisId: string;
  articleGoal: string;
  headlines: string[];
  subheadings: string[];
  recommendedWordCount: number;
  keywordPlacement: string[];
  style: string;
}

interface GeneratedContentPlan extends ContentPlanData {
  id: string;
  adminApproved: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class ContentPlanService {
  /**
   * Generate a content plan from keyword analysis
   * @param keywordAnalysisId The ID of the keyword analysis to use
   * @returns The generated content plan ID
   */
  async generateContentPlan(keywordAnalysisId: string): Promise<string> {
    try {
      // Get the keyword analysis data
      const keywordAnalysis = await keywordAnalysisService.getAnalysisById(keywordAnalysisId);
      
      // Generate content plan based on keyword analysis
      const contentPlanData: ContentPlanData = {
        keywordAnalysisId,
        articleGoal: this.generateArticleGoal(keywordAnalysis),
        headlines: this.generateHeadlines(keywordAnalysis),
        subheadings: this.generateSubheadings(keywordAnalysis),
        recommendedWordCount: this.calculateWordCount(keywordAnalysis),
        keywordPlacement: this.determineKeywordPlacement(keywordAnalysis),
        style: this.determineStyle(keywordAnalysis)
      };
      
      // Store the content plan in the database
      const contentPlan = await prisma.contentPlan.create({
        data: {
          keywordAnalysisId: contentPlanData.keywordAnalysisId,
          articleGoal: contentPlanData.articleGoal,
          headlines: JSON.stringify(contentPlanData.headlines),
          subheadings: JSON.stringify(contentPlanData.subheadings),
          recommendedWordCount: contentPlanData.recommendedWordCount,
          keywordPlacement: JSON.stringify(contentPlanData.keywordPlacement),
          style: contentPlanData.style
        }
      });
      
      return contentPlan.id;
    } catch (error) {
      console.error('Error generating content plan:', error);
      throw new Error(`Failed to generate content plan: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Get a content plan by ID
   * @param id The content plan ID
   * @returns The content plan
   */
  async getContentPlanById(id: string): Promise<GeneratedContentPlan> {
    try {
      const contentPlan = await prisma.contentPlan.findUnique({
        where: { id }
      });
      
      if (!contentPlan) {
        throw new Error('Content plan not found');
      }
      
      return {
        id: contentPlan.id,
        keywordAnalysisId: contentPlan.keywordAnalysisId,
        articleGoal: contentPlan.articleGoal,
        headlines: JSON.parse(contentPlan.headlines as string),
        subheadings: JSON.parse(contentPlan.subheadings as string),
        recommendedWordCount: contentPlan.recommendedWordCount,
        keywordPlacement: JSON.parse(contentPlan.keywordPlacement as string),
        adminApproved: contentPlan.adminApproved,
        style: contentPlan.style,
        createdAt: contentPlan.createdAt,
        updatedAt: contentPlan.updatedAt
      };
    } catch (error) {
      console.error('Error retrieving content plan:', error);
      throw new Error(`Failed to retrieve content plan: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Update (approve/edit) a content plan
   * @param id The content plan ID
   * @param updates The updates to apply
   * @param adminApproved Whether to mark as admin approved
   * @returns The updated content plan
   */
  async updateContentPlan(
    id: string, 
    updates: Partial<ContentPlanData>, 
    adminApproved: boolean = false
  ): Promise<GeneratedContentPlan> {
    try {
      const updateData: any = {};
      
      // Only include fields that are being updated
      if (updates.articleGoal !== undefined) updateData.articleGoal = updates.articleGoal;
      if (updates.headlines !== undefined) updateData.headlines = JSON.stringify(updates.headlines);
      if (updates.subheadings !== undefined) updateData.subheadings = JSON.stringify(updates.subheadings);
      if (updates.recommendedWordCount !== undefined) updateData.recommendedWordCount = updates.recommendedWordCount;
      if (updates.keywordPlacement !== undefined) updateData.keywordPlacement = JSON.stringify(updates.keywordPlacement);
      if (updates.style !== undefined) updateData.style = updates.style;
      
      // Update admin approval status
      updateData.adminApproved = adminApproved;
      
      const contentPlan = await prisma.contentPlan.update({
        where: { id },
        data: updateData
      });
      
      return {
        id: contentPlan.id,
        keywordAnalysisId: contentPlan.keywordAnalysisId,
        articleGoal: contentPlan.articleGoal,
        headlines: JSON.parse(contentPlan.headlines as string),
        subheadings: JSON.parse(contentPlan.subheadings as string),
        recommendedWordCount: contentPlan.recommendedWordCount,
        keywordPlacement: JSON.parse(contentPlan.keywordPlacement as string),
        adminApproved: contentPlan.adminApproved,
        style: contentPlan.style,
        createdAt: contentPlan.createdAt,
        updatedAt: contentPlan.updatedAt
      };
    } catch (error) {
      console.error('Error updating content plan:', error);
      throw new Error(`Failed to update content plan: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Generate article goal based on keyword analysis
   */
  private generateArticleGoal(keywordAnalysis: any): string {
    // Use the first page goal from the keyword analysis or create a default
    if (keywordAnalysis.pageGoals && keywordAnalysis.pageGoals.length > 0) {
      return keywordAnalysis.pageGoals[0];
    }
    
    return `Provide comprehensive information about ${keywordAnalysis.keyword} to help users understand its importance and application.`;
  }
  
  /**
   * Generate headlines based on keyword analysis
   */
  private generateHeadlines(keywordAnalysis: any): string[] {
    // Start with H1 headlines from keyword analysis
    let headlines: string[] = [];
    
    if (keywordAnalysis.headings?.h1 && keywordAnalysis.headings.h1.length > 0) {
      headlines = [...keywordAnalysis.headings.h1];
    } else {
      // Generate default H1 headline
      headlines.push(`The Ultimate Guide to ${keywordAnalysis.keyword}`);
    }
    
    // Add H2 headlines if available
    if (keywordAnalysis.headings?.h2 && keywordAnalysis.headings.h2.length > 0) {
      headlines = [...headlines, ...keywordAnalysis.headings.h2];
    }
    
    return headlines;
  }
  
  /**
   * Generate subheadings based on keyword analysis
   */
  private generateSubheadings(keywordAnalysis: any): string[] {
    // Use H3 headlines from keyword analysis as subheadings
    if (keywordAnalysis.headings?.h3 && keywordAnalysis.headings.h3.length > 0) {
      return keywordAnalysis.headings.h3;
    }
    
    // Generate default subheadings if none provided
    return [
      `Understanding ${keywordAnalysis.keyword}`,
      `Benefits of ${keywordAnalysis.keyword}`,
      `Best Practices for ${keywordAnalysis.keyword}`,
      `Common Mistakes to Avoid`,
      `Conclusion`
    ];
  }
  
  /**
   * Calculate recommended word count based on keyword analysis
   */
  private calculateWordCount(keywordAnalysis: any): number {
    // Use the average word count from keyword analysis or default to 1200
    if (keywordAnalysis.avgWordCount && keywordAnalysis.avgWordCount > 0) {
      // Ensure word count is within reasonable bounds (600-2000 words)
      return Math.max(600, Math.min(2000, keywordAnalysis.avgWordCount));
    }
    
    return 1200; // Default word count
  }
  
  /**
   * Determine keyword placement strategy
   */
  private determineKeywordPlacement(keywordAnalysis: any): string[] {
    // Create keyword placement guidelines based on analysis
    const placements: string[] = [
      `Include "${keywordAnalysis.keyword}" in the H1 heading`,
      `Use "${keywordAnalysis.keyword}" naturally in the first paragraph`,
      `Incorporate "${keywordAnalysis.keyword}" in at least 2 H2 headings`,
      `Place "${keywordAnalysis.keyword}" in the conclusion`,
      `Maintain a keyword density of approximately ${keywordAnalysis.keywordDensity || 2}%`
    ];
    
    // Add suggestions from QA section if available
    if (keywordAnalysis.suggestedQA && keywordAnalysis.suggestedQA.length > 0) {
      placements.push(`Address these related questions: ${keywordAnalysis.suggestedQA.slice(0, 3).join(', ')}`);
    }
    
    return placements;
  }
  
  /**
   * Determine writing style based on keyword analysis
   */
  private determineStyle(keywordAnalysis: any): string {
    // Determine style based on keyword and analysis
    return `Professional and informative style focused on ${keywordAnalysis.keyword}. Use clear, concise language that is accessible to beginners but still provides value to experienced practitioners. Include examples and practical tips where relevant.`;
  }
}

// Export singleton instance
export const contentPlanService = new ContentPlanService();