// Test script to verify the heading hierarchy checking with new format

// Mock the contentReviewService functions we need
const checkHeadingHierarchy = (articleText) => {
  const issues = [];
  
  // First, try to extract headings from the new format (Heading1:, H2:, H3:)
  let headings = [];
  
  const lines = articleText.split('\n');
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('Heading1:')) {
      headings.push({ level: 1, text: trimmedLine.substring(9).trim() });
    } else if (trimmedLine.startsWith('H2:')) {
      headings.push({ level: 2, text: trimmedLine.substring(3).trim() });
    } else if (trimmedLine.startsWith('H3:')) {
      headings.push({ level: 3, text: trimmedLine.substring(3).trim() });
    }
  }
  
  if (headings.length === 0) {
    return { valid: false, issues: ['No headings found in content'] };
  }
  
  // Check if H1 exists and is only one
  const h1Headings = headings.filter(h => h.level === 1);
  if (h1Headings.length === 0) {
    issues.push('Missing H1 heading');
  } else if (h1Headings.length > 1) {
    issues.push('Multiple H1 headings found');
  }
  
  // Check heading order (H1 should be followed by H2, not H3, etc.)
  let lastLevel = 0;
  for (const heading of headings) {
    const level = heading.level;
    
    // Heading levels should increase gradually (skipping one level is acceptable)
    if (level > lastLevel + 2 && lastLevel !== 0) {
      issues.push(`Improper heading hierarchy: H${lastLevel} followed by H${level}`);
    }
    
    lastLevel = level;
  }
  
  // Check if there are both H2 and H3 headings
  const hasH2 = headings.some(h => h.level === 2);
  const hasH3 = headings.some(h => h.level === 3);
  
  if (hasH2 && hasH3) {
    // Check if H3 headings are properly nested under H2 headings
    let lastH2Index = -1;
    let lastH3Index = -1;
    
    for (let i = 0; i < headings.length; i++) {
      if (headings[i].level === 2) {
        lastH2Index = i;
      } else if (headings[i].level === 3) {
        lastH3Index = i;
        // H3 should come after an H2
        if (lastH2Index === -1) {
          issues.push('H3 heading found without preceding H2 heading');
        }
      }
    }
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
};

// Test cases
const testCases = [
  {
    name: "Valid hierarchy with H1, H2, H3",
    content: `Heading1: Introduction
This is the introduction.

H2: Main Section
This is the main section.

H3: Subsection
This is a subsection.

H2: Another Section
This is another section.`,
    expectedValid: true
  },
  {
    name: "Missing H1",
    content: `H2: Main Section
This is the main section.

H3: Subsection
This is a subsection.`,
    expectedValid: false
  },
  {
    name: "Multiple H1s",
    content: `Heading1: First Title
This is the first section.

Heading1: Second Title
This is the second section.`,
    expectedValid: false
  },
  {
    name: "Improper hierarchy (H1 -> H3)",
    content: `Heading1: Introduction
This is the introduction.

H3: Subsection
This is a subsection.`,
    expectedValid: true // Skipping one level is acceptable
  }
];

console.log("Testing heading hierarchy checking with new format:\n");

testCases.forEach((testCase, index) => {
  console.log(`Test ${index + 1}: ${testCase.name}`);
  const result = checkHeadingHierarchy(testCase.content);
  console.log(`Valid: ${result.valid} (expected: ${testCase.expectedValid})`);
  if (result.issues.length > 0) {
    console.log(`Issues: ${result.issues.join(', ')}`);
  }
  console.log("---");
});