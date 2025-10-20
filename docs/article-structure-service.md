# Article Structure Service

The Article Structure Service is responsible for generating structured article outlines based on keyword analysis and brand tone/style data.

## Overview

This service creates compelling article structures that:
- Align with brand tone and style
- Incorporate keyword analysis for SEO relevance
- Have logical flow and readability
- Avoid repetition across sections
- Produce natural, engaging section titles

## API Endpoints

### Generate Article Structure
**Endpoint**: `POST /content/plan/structure`
**TRPC Method**: `contentPlan.generateStructure`

#### Request Body
```typescript
{
  keywordAnalysisId: string;        // Required: ID of the keyword analysis
  brandProfileId?: string;          // Optional: ID of the brand profile
}
```

#### Response
```typescript
{
  success: boolean;
  data: {
    goal: string;                 // 1-2 sentences describing purpose, audience, and outcome
    headline: string;             // Compelling H1 headline
    structure: Array<{            // Hierarchical structure with H2 and H3 levels
      H2: string;                 // Main section title
      subheadings: string[];      // Supporting subheadings (H3 level)
    }>
  };
  message: string;
}
```

## Service Methods

### `generateArticleStructure(keywordAnalysisId: string, brandProfileId?: string)`
Generates an article structure based on keyword analysis and optional brand profile.

**Parameters:**
- `keywordAnalysisId`: The ID of the keyword analysis to use
- `brandProfileId`: Optional ID of the brand profile to use for tone and style

**Returns:** Promise<ArticleStructure>

## Data Structure

The service returns a structured JSON object:

```json
{
  "goal": "string (1-2 sentences describing the purpose, audience, and intended outcome)",
  "headline": "string (compelling H1 headline reflecting the goal and target keyword)",
  "structure": [
    {
      "H2": "string (main section title)",
      "subheadings": ["string", "string"] 
    }
  ]
}
```

## Integration with Other Services

The Article Structure Service integrates with:
- **Keyword Analysis Service**: Uses keyword insights and relevance scores
- **Brand Service**: Uses stored brand tone, personality, and writing style
- **Gemini Service**: Generates content using AI based on inputs

## Usage Examples

### Backend Usage
```typescript
import { articleStructureService } from '../services/articleStructureService';

// Generate structure with keyword analysis only
const structure = await articleStructureService.generateArticleStructure(
  keywordAnalysisId
);

// Generate structure with brand personalization
const brandedStructure = await articleStructureService.generateArticleStructure(
  keywordAnalysisId,
  brandProfileId
);
```

### Frontend Usage
```typescript
import { trpc } from '@/lib/trpc';

// Generate article structure
const result = await trpc.contentPlan.generateStructure.mutate({
  keywordAnalysisId: 'keyword-analysis-id',
  brandProfileId: 'brand-profile-id' // Optional
});
```

## Testing

Run the test scripts to verify functionality:

```bash
# Test article structure generation
npm run test:article-structure

# Test content plan with structure integration
npm run test:content-plan-structure

# Test parsing functionality
npm run test:article-structure-unit
```