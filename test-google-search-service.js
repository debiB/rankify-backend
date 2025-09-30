require('dotenv').config();
const { googleSearchService } = require('./dist/services/googleSearch');

async function testGoogleSearchService() {
  try {
    console.log('Testing Google Search Service...');
    
    const result = await googleSearchService.searchKeyword('rankify');
    console.log('Service result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error testing Google Search Service:', error);
  }
}

testGoogleSearchService();