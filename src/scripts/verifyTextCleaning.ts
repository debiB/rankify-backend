// Simple test to verify text cleaning functionality
const testTextCleaning = (text: string): string => {
  return text
    .replace(/\*\*/g, '') // Remove double asterisks
    .replace(/\*/g, '') // Remove single asterisks
    .replace(/__/g, '') // Remove double underscores
    .replace(/_/g, '') // Remove single underscores
    .replace(/#/g, '') // Remove hashtags
    .replace(/~~/g, '') // Remove strikethrough
    .replace(/`/g, '') // Remove backticks
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove markdown links, keep text
    .replace(/\s+/g, ' ') // Replace multiple whitespace characters with single space
    .trim();
};

// Test text with various markdown formatting
const testText = `
# Main Heading
This is a **bold** text with *italic* formatting and __underline__.
## Subheading
Here we have some #hashtag and more **asterisks** to *clean* up.
### Another subheading
This text should be clean and readable without any markdown formatting.
[Link text](http://example.com) should be cleaned too.
~~Strikethrough~~ text should be clean.
`;

console.log('Original text:');
console.log(testText);

console.log('\nCleaned text:');
console.log(testTextCleaning(testText));