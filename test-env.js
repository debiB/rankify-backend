require('dotenv').config();

console.log('GOOGLE_SEARCH_API_KEY:', process.env.GOOGLE_SEARCH_API_KEY ? process.env.GOOGLE_SEARCH_API_KEY.substring(0, 10) + '...' : 'NOT SET');
console.log('GOOGLE_SEARCH_ENGINE_ID:', process.env.GOOGLE_SEARCH_ENGINE_ID ? process.env.GOOGLE_SEARCH_ENGINE_ID : 'NOT SET');