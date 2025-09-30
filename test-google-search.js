require('dotenv').config();
const { google } = require('googleapis');

async function testGoogleSearch() {
  try {
    console.log('Testing Google Search API...');
    console.log('API Key:', process.env.GOOGLE_SEARCH_API_KEY ? 'SET' : 'NOT SET');
    console.log('Search Engine ID:', process.env.GOOGLE_SEARCH_ENGINE_ID ? 'SET' : 'NOT SET');
    
    if (!process.env.GOOGLE_SEARCH_API_KEY || !process.env.GOOGLE_SEARCH_ENGINE_ID) {
      console.log('Missing required environment variables');
      return;
    }
    
    const customsearch = google.customsearch('v1');
    
    console.log('Making search request...');
    const response = await customsearch.cse.list({
      q: 'rankify',
      cx: process.env.GOOGLE_SEARCH_ENGINE_ID,
      auth: process.env.GOOGLE_SEARCH_API_KEY,
      num: 5
    });
    
    console.log('Response received:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Error testing Google Search API:', error);
  }
}

testGoogleSearch();