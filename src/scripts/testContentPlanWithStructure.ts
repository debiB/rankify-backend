import { contentPlanService } from '../services/contentPlanService';
import { prisma } from '../utils/prisma';

async function testContentPlanWithStructure() {
  try {
    // First, let's create a sample keyword analysis if one doesn't exist
    const sampleKeyword = 'content marketing';
    
    // Check if we have any keyword analysis
    const keywordAnalysisModel = (prisma as any).keywordAnalysis;
    let keywordAnalysis = await keywordAnalysisModel.findFirst({
      where: {
        keyword: sampleKeyword
      }
    });
    
    // If not, create one
    if (!keywordAnalysis) {
      console.log('Creating sample keyword analysis...');
      keywordAnalysis = await keywordAnalysisModel.create({
        data: {
          keyword: sampleKeyword,
          pageGoals: JSON.stringify([
            'Educate users about content marketing strategies',
            'Provide practical content marketing tips',
            'Demonstrate ROI of content marketing'
          ]),
          h1Headlines: JSON.stringify([
            'Ultimate Guide to Content Marketing',
            'Content Marketing Strategies That Work'
          ]),
          h2Headlines: JSON.stringify([
            'What is Content Marketing?',
            'Benefits of Content Marketing',
            'Content Marketing Best Practices',
            'Measuring Content Marketing Success'
          ]),
          h3Headlines: JSON.stringify([
            'Understanding Your Audience',
            'Creating Valuable Content',
            'Distribution Channels',
            'Content Performance Metrics'
          ]),
          avgWordCount: 1800,
          keywordDensity: 1.8,
          suggestedQA: JSON.stringify([
            'How often should you publish content?',
            'What types of content perform best?'
          ]),
          recommendedExternalLink: 'https://contentmarketinginstitute.com',
          analysisDate: new Date()
        }
      });
    }
    
    console.log('Using keyword analysis:', keywordAnalysis.id);
    
    // Generate content plan with article structure
    console.log('Generating content plan with article structure...');
    const contentPlanId = await contentPlanService.generateContentPlan(
      keywordAnalysis.id
    );
    
    console.log('Generated content plan ID:', contentPlanId);
    
    // Retrieve the content plan
    const contentPlan = await contentPlanService.getContentPlanById(contentPlanId);
    
    console.log('Generated content plan:');
    console.log('Article Goal:', contentPlan.articleGoal);
    console.log('Headlines:', contentPlan.headlines);
    console.log('Subheadings:', contentPlan.subheadings);
    console.log('Recommended Word Count:', contentPlan.recommendedWordCount);
    
    // Test with brand profile if available
    const brandProfile = await prisma.brandProfile.findFirst();
    if (brandProfile) {
      console.log('\nGenerating content plan with brand profile...');
      const contentPlanWithBrandId = await contentPlanService.generateContentPlan(
        keywordAnalysis.id,
        brandProfile.id
      );
      
      console.log('Generated content plan with brand ID:', contentPlanWithBrandId);
      
      const contentPlanWithBrand = await contentPlanService.getContentPlanById(contentPlanWithBrandId);
      
      console.log('Generated content plan with brand:');
      console.log('Article Goal:', contentPlanWithBrand.articleGoal);
      console.log('Headlines:', contentPlanWithBrand.headlines);
      console.log('Subheadings:', contentPlanWithBrand.subheadings);
    } else {
      console.log('\nNo brand profile found. Skipping brand-based generation.');
    }
  } catch (error) {
    console.error('Error in test:', error);
  }
}

// Run the test
testContentPlanWithStructure();