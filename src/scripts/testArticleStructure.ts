import { articleStructureService } from '../services/articleStructureService';
import { prisma } from '../utils/prisma';

async function testArticleStructure() {
  try {
    // First, let's create a sample keyword analysis if one doesn't exist
    const sampleKeyword = 'SEO optimization';
    
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
            'Help users understand SEO optimization techniques',
            'Provide actionable SEO strategies',
            'Improve website search rankings'
          ]),
          h1Headlines: JSON.stringify([
            'Complete Guide to SEO Optimization',
            'SEO Optimization Best Practices'
          ]),
          h2Headlines: JSON.stringify([
            'What is SEO Optimization?',
            'Why SEO Matters',
            'SEO Best Practices',
            'Common SEO Mistakes'
          ]),
          h3Headlines: JSON.stringify([
            'Understanding Search Engines',
            'Keyword Research Basics',
            'On-Page SEO Techniques',
            'Off-Page SEO Strategies'
          ]),
          avgWordCount: 1500,
          keywordDensity: 2.1,
          suggestedQA: JSON.stringify([
            'What are the most important SEO factors?',
            'How long does SEO take to show results?'
          ]),
          recommendedExternalLink: 'https://searchengineland.com',
          analysisDate: new Date()
        }
      });
    }
    
    console.log('Using keyword analysis:', keywordAnalysis.id);
    
    // Generate article structure
    console.log('Generating article structure...');
    const structure = await articleStructureService.generateArticleStructure(
      keywordAnalysis.id
    );
    
    console.log('Generated article structure:');
    console.log(JSON.stringify(structure, null, 2));
    
    // Test with brand profile if available
    const brandProfile = await prisma.brandProfile.findFirst();
    if (brandProfile) {
      console.log('\nGenerating article structure with brand profile...');
      const structureWithBrand = await articleStructureService.generateArticleStructure(
        keywordAnalysis.id,
        brandProfile.id
      );
      
      console.log('Generated article structure with brand:');
      console.log(JSON.stringify(structureWithBrand, null, 2));
    } else {
      console.log('\nNo brand profile found. Skipping brand-based generation.');
    }
  } catch (error) {
    console.error('Error in test:', error);
  }
}

// Run the test
testArticleStructure();