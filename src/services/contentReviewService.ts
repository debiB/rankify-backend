import { prisma } from '../utils/prisma';
import { contentGenerationService } from './contentGenerationService';
import { GeneratedContentWithRelations } from './contentGenerationService';

export interface ReviewResult {
  readabilityScore: number;
  seoScore: number;
  coherenceScore: number;
  keywordDensity: number;
  hasProperHeadingHierarchy: boolean;
  hasInternalLinks: boolean;
  hasExternalLinks: boolean;
  metaTitle: string;
  metaDescription: string;
  hasFirstPersonUsage: boolean;
  hasCallToAction: boolean;
  suggestions: string[];
}

export class ContentReviewService {
  /**
   * Analyze article for SEO and readability
   * @param id The generated content ID
   * @returns Review results with scores and suggestions
   */
  async reviewContent(id: string): Promise<ReviewResult> {
    try {
      // Get the generated content
      const content = await contentGenerationService.getGeneratedContentById(id) as GeneratedContentWithRelations;
      
      // Perform various checks
      const readabilityScore = this.checkReadability(content.articleText);
      const seoAnalysis = this.analyzeSEO(content);
      const coherenceScore = this.checkCoherence(content.articleText);
      const keywordDensity = this.calculateKeywordDensity(content);
      const headingHierarchy = this.checkHeadingHierarchy(content.articleText);
      const linkAnalysis = this.analyzeLinks(content.articleText, content.externalLink);
      const metaTags = this.generateMetaTags(content);
      const firstPersonUsage = this.checkFirstPersonUsage(content.articleText);
      const callToAction = this.checkCallToAction(content.articleText);
      
      // Generate suggestions based on analysis
      const suggestions = this.generateSuggestions({
        readabilityScore,
        seoAnalysis,
        coherenceScore,
        keywordDensity,
        headingHierarchy,
        linkAnalysis,
        firstPersonUsage,
        callToAction
      });
      
      return {
        readabilityScore,
        seoScore: seoAnalysis.score,
        coherenceScore,
        keywordDensity,
        hasProperHeadingHierarchy: headingHierarchy.valid,
        hasInternalLinks: linkAnalysis.hasInternalLinks,
        hasExternalLinks: linkAnalysis.hasExternalLinks,
        metaTitle: metaTags.title,
        metaDescription: metaTags.description,
        hasFirstPersonUsage: firstPersonUsage,
        hasCallToAction: callToAction,
        suggestions
      };
    } catch (error) {
      console.error('Error reviewing content:', error);
      throw new Error(`Failed to review content: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Check readability of the content (simplified version)
   */
  private checkReadability(articleText: string): number {
    // Simple readability check - in a real implementation, you might use 
    // algorithms like Flesch-Kincaid or Gunning Fog
    
    // Count sentences (basic approximation)
    const sentences = articleText.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    // Count words
    const words = articleText.split(/\s+/).filter(w => w.trim().length > 0);
    
    // Average sentence length
    const avgSentenceLength = words.length / sentences.length;
    
    // Score based on sentence length (simplistic)
    // Ideal average sentence length is around 15-20 words
    let score = 100;
    if (avgSentenceLength > 25) {
      score -= 20;
    } else if (avgSentenceLength > 20) {
      score -= 10;
    } else if (avgSentenceLength < 10) {
      score -= 10;
    }
    
    // Check for overly complex vocabulary (simplified)
    const complexWords = words.filter(word => word.length > 10).length;
    const complexWordRatio = complexWords / words.length;
    
    if (complexWordRatio > 0.1) {
      score -= 15;
    }
    
    return Math.max(0, Math.min(100, score));
  }
  
  /**
   * Analyze SEO aspects of the content
   */
  private analyzeSEO(content: any): { score: number; issues: string[] } {
    let score = 100;
    const issues: string[] = [];
    
    // Check for keyword presence in title (H1)
    const h1Match = content.articleText.match(/<h1[^>]*>(.*?)<\/h1>/i);
    if (!h1Match) {
      score -= 15;
      issues.push('Missing H1 heading');
    }
    
    // Check for at least one H2 heading
    const h2Match = content.articleText.match(/<h2[^>]*>.*?<\/h2>/i);
    if (!h2Match) {
      score -= 10;
      issues.push('Missing H2 headings');
    }
    
    // Check content length
    const textContent = content.articleText.replace(/<[^>]*>/g, '').trim();
    const wordCount = textContent.split(/\s+/).filter((w: string) => w.length > 0).length;
    
    if (wordCount < 300) {
      score -= 20;
      issues.push('Content is too short (less than 300 words)');
    } else if (wordCount > 2000) {
      // Content is good length
      score += 5;
    }
    
    return {
      score: Math.max(0, Math.min(100, score)),
      issues
    };
  }
  
  /**
   * Check coherence and flow of the content
   */
  private checkCoherence(articleText: string): number {
    // Simplified coherence check
    // In a real implementation, this could use NLP techniques
    
    // Check transition words ratio
    const transitionWords = ['moreover', 'furthermore', 'however', 'nevertheless', 'therefore', 'consequently', 'meanwhile'];
    const textLower = articleText.toLowerCase();
    let transitionCount = 0;
    
    for (const word of transitionWords) {
      const regex = new RegExp(`\\b${word}\\b`, 'g');
      const matches = textLower.match(regex);
      transitionCount += matches ? matches.length : 0;
    }
    
    // Calculate transition word density (aim for 1-2%)
    const words = articleText.split(/\s+/).filter(w => w.trim().length > 0);
    const transitionDensity = transitionCount / words.length;
    
    // Score based on transition word density
    let score = 50; // Base score
    if (transitionDensity > 0.005) score += 20; // Good transition word usage
    if (transitionDensity > 0.01) score += 15;  // Excellent transition word usage
    if (transitionDensity > 0.02) score += 10;  // Very good transition word usage
    
    // Check paragraph structure
    const paragraphs = articleText.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    if (paragraphs.length >= 3) {
      score += 15; // Good paragraph structure
    }
    
    return Math.max(0, Math.min(100, score));
  }
  
  /**
   * Calculate keyword density
   */
  private calculateKeywordDensity(content: any): number {
    try {
      // Get the keyword from the content plan
      const contentPlan = content.contentPlan;
      if (!contentPlan || !contentPlan.keywordAnalysis) {
        return 0;
      }
      
      const keyword = contentPlan.keywordAnalysis.keyword.toLowerCase();
      const articleText = content.articleText.toLowerCase();
      
      // Count keyword occurrences
      const keywordMatches = (articleText.match(new RegExp(`\\b${keyword}\\b`, 'g')) || []).length;
      
      // Count total words
      const words = articleText.split(/\s+/).filter((w: string) => w.trim().length > 0).length;
      
      // Calculate density percentage
      return words > 0 ? (keywordMatches / words) * 100 : 0;
    } catch (error) {
      console.error('Error calculating keyword density:', error);
      return 0;
    }
  }
  
  /**
   * Check heading hierarchy compliance
   */
  private checkHeadingHierarchy(articleText: string): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    
    // Extract all headings
    const headings = [...articleText.matchAll(/<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi)];
    
    if (headings.length === 0) {
      return { valid: false, issues: ['No headings found'] };
    }
    
    // Check if H1 exists and is only one
    const h1Headings = headings.filter(h => h[1] === '1');
    if (h1Headings.length === 0) {
      issues.push('Missing H1 heading');
    } else if (h1Headings.length > 1) {
      issues.push('Multiple H1 headings found');
    }
    
    // Check heading order (H1 should be followed by H2, not H3, etc.)
    let lastLevel = 0;
    for (const heading of headings) {
      const level = parseInt(heading[1]);
      
      // Heading levels should increase gradually
      if (level > lastLevel + 1 && lastLevel !== 0) {
        issues.push(`Improper heading hierarchy: H${lastLevel} followed by H${level}`);
      }
      
      lastLevel = level;
    }
    
    return {
      valid: issues.length === 0,
      issues
    };
  }
  
  /**
   * Analyze internal and external links
   */
  private analyzeLinks(articleText: string, externalLink: string | null): { 
    hasInternalLinks: boolean; 
    hasExternalLinks: boolean; 
    internalLinkCount: number; 
    externalLinkCount: number 
  } {
    // Find all links
    const links = [...articleText.matchAll(/<a[^>]*href=["'](.*?)["'][^>]*>(.*?)<\/a>/gi)];
    
    let internalLinkCount = 0;
    let externalLinkCount = 0;
    
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    for (const link of links) {
      const href = link[1];
      
      // Check if it's an internal link (relative URL or same domain)
      if (href.startsWith('/') || href.startsWith(baseUrl) || href.includes('localhost')) {
        internalLinkCount++;
      } else {
        externalLinkCount++;
      }
    }
    
    // Add the explicit external link if provided
    if (externalLink) {
      externalLinkCount++;
    }
    
    return {
      hasInternalLinks: internalLinkCount > 0,
      hasExternalLinks: externalLinkCount > 0,
      internalLinkCount,
      externalLinkCount
    };
  }
  
  /**
   * Generate meta title and description
   */
  private generateMetaTags(content: any): { title: string; description: string } {
    // Extract H1 for meta title
    const h1Match = content.articleText.match(/<h1[^>]*>(.*?)<\/h1>/i);
    let title = h1Match ? h1Match[1].substring(0, 55) : 'Article';
    
    // Ensure title is within 60 characters
    if (title.length > 60) {
      title = title.substring(0, 57) + '...';
    }
    
    // Extract first paragraph for meta description
    const firstParagraphMatch = content.articleText.match(/<p[^>]*>(.*?)<\/p>/i);
    let description = firstParagraphMatch 
      ? firstParagraphMatch[1].replace(/<[^>]*>/g, '').substring(0, 150) 
      : 'Learn more in this comprehensive article.';
    
    // Ensure description is within 155 characters
    if (description.length > 155) {
      description = description.substring(0, 152) + '...';
    }
    
    return {
      title,
      description
    };
  }
  
  /**
   * Check for first-person usage ("we", "our", "site")
   */
  private checkFirstPersonUsage(articleText: string): boolean {
    const textLower = articleText.toLowerCase();
    return textLower.includes('we') || textLower.includes('our') || textLower.includes('site');
  }
  
  /**
   * Check for call to action at the end
   */
  private checkCallToAction(articleText: string): boolean {
    const textLower = articleText.toLowerCase();
    const ctas = ['read more', 'comment', 'share', 'purchase', 'buy now', 'subscribe', 'contact us'];
    
    for (const cta of ctas) {
      if (textLower.includes(cta)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Generate suggestions based on analysis results
   */
  private generateSuggestions(analysis: {
    readabilityScore: number;
    seoAnalysis: { score: number; issues: string[] };
    coherenceScore: number;
    keywordDensity: number;
    headingHierarchy: { valid: boolean; issues: string[] };
    linkAnalysis: { hasInternalLinks: boolean; hasExternalLinks: boolean };
    firstPersonUsage: boolean;
    callToAction: boolean;
  }): string[] {
    const suggestions: string[] = [];
    
    // Readability suggestions
    if (analysis.readabilityScore < 70) {
      suggestions.push('Improve readability by using shorter sentences and simpler vocabulary');
    }
    
    // SEO suggestions
    suggestions.push(...analysis.seoAnalysis.issues);
    
    if (analysis.keywordDensity < 1.5) {
      suggestions.push('Increase keyword density to at least 1.5%');
    } else if (analysis.keywordDensity > 3.0) {
      suggestions.push('Reduce keyword density to avoid keyword stuffing (currently over 3%)');
    }
    
    // Coherence suggestions
    if (analysis.coherenceScore < 70) {
      suggestions.push('Improve content flow by adding more transition words and connecting phrases');
    }
    
    // Heading hierarchy suggestions
    if (!analysis.headingHierarchy.valid) {
      suggestions.push(...analysis.headingHierarchy.issues);
      suggestions.push('Fix heading hierarchy to ensure proper structure (H1 → H2 → H3)');
    }
    
    // Link suggestions
    if (!analysis.linkAnalysis.hasInternalLinks) {
      suggestions.push('Add internal links to related content');
    }
    
    if (!analysis.linkAnalysis.hasExternalLinks) {
      suggestions.push('Add external links to authoritative sources');
    }
    
    // First person usage suggestion
    if (!analysis.firstPersonUsage) {
      suggestions.push('Include first-person usage ("we", "our", "site") to create connection with readers');
    }
    
    // Call to action suggestion
    if (!analysis.callToAction) {
      suggestions.push('Add a call to action at the end (e.g., encourage readers to read, comment, share, or purchase)');
    }
    
    return suggestions;
  }
}

// Export a singleton instance
export const contentReviewService = new ContentReviewService();