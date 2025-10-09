// Test script to verify the new heading format parsing

// Since textFormatting is a frontend utility, we'll create a simple test here
// Test content with the new format
const testContent = `Heading1: Introduction to AI Content Generation
This is the introduction paragraph that explains what AI content generation is and why it's important.

H2: Benefits of Using AI
Here we discuss the various benefits of using AI for content creation.

H3: Cost Efficiency
AI can significantly reduce content creation costs.

H2: Key Considerations
Important factors to keep in mind when implementing AI content solutions.

Heading1: Implementation Guide
A comprehensive guide to implementing AI content generation in your workflow.

H2: Getting Started
Steps to begin your AI content generation journey.

H3: Best Practices
Recommended practices for optimal results.

This is a regular paragraph that doesn't have any special heading format.
It should be displayed as normal text.

Another regular paragraph.`;

console.log('Testing parseHeadingsAndContent function:');
// Manual implementation of parseHeadingsAndContent for testing
const parseHeadingsAndContent = (text) => {
  if (!text) return { headings: [], subheadings: [], content: "" };
  
  const lines = text.split('\n');
  const headings = [];
  const subheadings = [];
  const contentLines = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    // Check if line is a heading in the new format
    if (trimmedLine.startsWith('Heading1:')) {
      // Extract the heading text (remove "Heading1:" prefix)
      const headingText = trimmedLine.substring(9).trim();
      if (headingText) {
        headings.push(headingText);
      }
    } else if (trimmedLine.startsWith('H2:') || trimmedLine.startsWith('H3:')) {
      // Extract the subheading text (remove "H2:" or "H3:" prefix)
      const prefixLength = trimmedLine.startsWith('H2:') ? 3 : 3;
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

const parsed = parseHeadingsAndContent(testContent);
console.log('Headings:', parsed.headings);
console.log('Subheadings:', parsed.subheadings);
console.log('Content (first 200 chars):', parsed.content.substring(0, 200));

console.log('\nTesting formatArticleText function:');
// Manual implementation of formatArticleText for testing
const formatArticleText = (text) => {
  if (!text) return "";
  
  // Split text into lines
  const lines = text.split('\n');
  const formattedLines = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Check for headings in the new format
    if (trimmedLine.startsWith('Heading1:')) {
      // H1 heading
      const headingText = trimmedLine.substring(9).trim(); // Remove "Heading1:" prefix
      formattedLines.push(`<h1>${headingText}</h1>`);
    } else if (trimmedLine.startsWith('H2:')) {
      // H2 subheading
      const subheadingText = trimmedLine.substring(3).trim(); // Remove "H2:" prefix
      formattedLines.push(`<h2>${subheadingText}</h2>`);
    } else if (trimmedLine.startsWith('H3:')) {
      // H3 subheading
      const subheadingText = trimmedLine.substring(3).trim(); // Remove "H3:" prefix
      formattedLines.push(`<h3>${subheadingText}</h3>`);
    } else {
      // Regular paragraph
      if (trimmedLine) {
        formattedLines.push(`<p>${trimmedLine}</p>`);
      } else {
        formattedLines.push('<br />');
      }
    }
  }
  
  return formattedLines.join('');
};

const formatted = formatArticleText(testContent);
console.log('Formatted HTML (first 500 chars):', formatted.substring(0, 500));