// Test the complete parsing and cleaning functionality
const cleanTextFormatting = (text: string): string => {
  if (!text) return '';
  
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

const parseHeadingsAndContent = (text: string) => {
  if (!text) return { headings: [], subheadings: [], content: "" };
  
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

// Simulate a typical AI response with markdown formatting
const aiResponse = `
INTRO_START
Welcome to our **comprehensive** guide on *digital marketing strategies*. This __guide__ will help you understand the ~~basics~~ of online marketing.
INTRO_END

ARTICLE_TEXT_START
# Digital Marketing Fundamentals

In today's [digital world](http://example.com), marketing has evolved significantly. Here are the **key** strategies:

## SEO Optimization
Search Engine Optimization is *crucial* for online visibility. It involves:
- Keyword research
- Content creation
- Link building

### Technical SEO
Technical aspects include site speed, mobile optimization, and structured data.

## Content Marketing
Creating valuable content is essential for engagement and conversions.
ARTICLE_TEXT_END

QNA_SECTIONS_START
# Question 1
How do I get started with **SEO**?

It's important to *begin* with keyword research and __understand__ your audience.

---

# Question 2
What is the ~~best~~ approach to content marketing?

Focus on *providing* value to your readers.
QNA_SECTIONS_END

EXTERNAL_LINK_START
https://example.com/digital-marketing-guide
EXTERNAL_LINK_END
`;

console.log('=== AI Response Parsing Test ===\n');

// Extract sections using regex (similar to how the service does it)
const introMatch = aiResponse.match(/INTRO_START\s*([\s\S]*?)\s*INTRO_END/);
const articleMatch = aiResponse.match(/ARTICLE_TEXT_START\s*([\s\S]*?)\s*ARTICLE_TEXT_END/);
const qnaMatch = aiResponse.match(/QNA_SECTIONS_START\s*([\s\S]*?)\s*QNA_SECTIONS_END/);
const linkMatch = aiResponse.match(/EXTERNAL_LINK_START\s*([\s\S]*?)\s*EXTERNAL_LINK_END/);

const intro = introMatch ? introMatch[1].trim() : '';
const articleText = articleMatch ? articleMatch[1].trim() : '';
const qnaContent = qnaMatch ? qnaMatch[1].trim() : '';
const externalLink = linkMatch ? linkMatch[1].trim() : '';

console.log('1. Original Intro:');
console.log(intro);
console.log('\n1. Cleaned Intro:');
console.log(cleanTextFormatting(intro));

console.log('\n\n2. Original Article Text:');
console.log(articleText);
console.log('\n2. Cleaned Article Text:');
console.log(cleanTextFormatting(articleText));

console.log('\n\n3. Original Q&A Content:');
console.log(qnaContent);
console.log('\n3. Cleaned Q&A Content:');
console.log(cleanTextFormatting(qnaContent));

console.log('\n\n4. External Link:');
console.log(externalLink);

// Test parsing headings
console.log('\n\n5. Heading Analysis:');
const { headings, subheadings, content } = parseHeadingsAndContent(articleText);
console.log('Main Headings:', headings);
console.log('Subheadings:', subheadings);
console.log('Content without headings:');
console.log(content);