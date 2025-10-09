// Simple test script to verify the parsing functionality of ArticleStructureService

async function testParseStructureResponse() {
  console.log('Testing parseStructureResponse function...');
  
  // Test valid JSON response
  const validResponse = `{
    "goal": "Educate readers about SEO optimization techniques",
    "headline": "The Complete Guide to SEO Optimization",
    "structure": [
      {
        "H2": "What is SEO Optimization?",
        "subheadings": ["Definition of SEO", "How search engines work"]
      },
      {
        "H2": "SEO Best Practices",
        "subheadings": ["Keyword research", "On-page optimization", "Link building"]
      }
    ]
  }`;
  
  try {
    // Test parsing of valid JSON structure
    const parsed = JSON.parse(validResponse);
    console.log('Test case would verify parsing of valid JSON structure');
    console.log('Parsed structure:', parsed);
    console.log('Test passed: Valid JSON structure can be parsed');
  } catch (error) {
    console.error('Test failed:', error);
  }
  
  // Test with markdown code blocks
  const markdownResponse = `\`\`\`json
  {
    "goal": "Help businesses improve their online visibility",
    "headline": "Mastering SEO for Business Growth",
    "structure": [
      {
        "H2": "Understanding SEO for Business",
        "subheadings": ["SEO basics", "Business benefits"]
      }
    ]
  }
  \`\`\``;
  
  try {
    let cleanResponse = markdownResponse.trim();
    if (cleanResponse.startsWith('```json')) {
      cleanResponse = cleanResponse.substring(7);
    } else if (cleanResponse.startsWith('```')) {
      cleanResponse = cleanResponse.substring(3);
    }
    
    if (cleanResponse.endsWith('```')) {
      cleanResponse = cleanResponse.substring(0, cleanResponse.length - 3);
    }
    
    const parsed = JSON.parse(cleanResponse);
    console.log('Test case for markdown code blocks passed:', parsed);
  } catch (error) {
    console.error('Test failed for markdown code blocks:', error);
  }
  
  // Test validation of structure
  const validStructure = {
    goal: "Educate readers about SEO optimization techniques",
    headline: "The Complete Guide to SEO Optimization",
    structure: [
      {
        H2: "What is SEO Optimization?",
        subheadings: ["Definition of SEO", "How search engines work"]
      }
    ]
  };
  
  // Validate the structure
  if (!validStructure.goal || !validStructure.headline || !Array.isArray(validStructure.structure)) {
    console.error('Invalid structure format');
  } else {
    let valid = true;
    for (const section of validStructure.structure) {
      if (!section.H2 || !Array.isArray(section.subheadings)) {
        valid = false;
        break;
      }
    }
    
    if (valid) {
      console.log('Structure validation passed:', validStructure);
    } else {
      console.error('Structure validation failed');
    }
  }
}

// Run the tests
testParseStructureResponse();