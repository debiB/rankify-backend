const fs = require('fs');

// Read the file
let content = fs.readFileSync('/Users/deborahb/Desktop/rank-ranger/backend/src/services/contentGenerationService.ts', 'utf8');

// Fix the malformed regex
content = content.replace(/return cleanedArticleText\.replace\(\/\\n\\s\*\\n\\s\*\\n\/g, '\n\n'\)\.trim\(\);/, "return cleanedArticleText.replace(/\n\\s*\n\\s*\n/g, '\n\n').trim();");

// Write the file back
fs.writeFileSync('/Users/deborahb/Desktop/rank-ranger/backend/src/services/contentGenerationService.ts', content);

console.log('Fixed the regex in contentGenerationService.ts');