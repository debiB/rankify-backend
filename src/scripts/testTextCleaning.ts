import { ContentGenerationService } from '../services/contentGenerationService';

// Create an instance of the service
const service = new ContentGenerationService();

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
console.log(service['cleanTextFormatting'](testText));

// Test parsing headings (we need to access the private method through a workaround)
const parseHeadingsAndContent = (text: string) => {
  const lines = text.split('\n');
  const headings: string[] = [];
  const subheadings: string[] = [];
  const contentLines: string[] = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    // Check if line is a heading
    if (trimmedLine.startsWith('# ')) {
      // Extract the heading text (remove # and whitespace)
      const headingText = trimmedLine.substring(2).trim();
      if (headingText) {
        headings.push(headingText);
      }
    } else if (trimmedLine.startsWith('## ') || trimmedLine.startsWith('### ')) {
      // Extract the subheading text (remove ## or ### and whitespace)
      const prefixLength = trimmedLine.startsWith('## ') ? 3 : 4;
      const subheadingText = trimmedLine.substring(prefixLength).trim();
      if (subheadingText) {
        subheadings.push(subheadingText);
      }
    } else {
      contentLines.push(line);
    }
  }
  
  return {
    headings,
    subheadings,
    content: contentLines.join('\n')
  };
};

const { headings, subheadings, content } = parseHeadingsAndContent(testText);
console.log('\nHeadings:', headings);
console.log('Subheadings:', subheadings);
console.log('Content:', content);