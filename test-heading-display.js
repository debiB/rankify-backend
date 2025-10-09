// Test script to verify heading formatting in the backend

const { formatArticleText } = require('../frontend/.next/server/chunks/ssr/src_1b006199._.js');

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

console.log('Testing formatArticleText function:');
const formatted = formatArticleText(testContent);
console.log('Formatted HTML:');
console.log(formatted);