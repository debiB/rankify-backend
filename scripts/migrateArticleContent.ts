import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ContentBlock {
  headingType: 'h1' | 'h2' | 'h3' | null;
  headingText: string | null;
  bodyText: string;
}

function parseArticleTextToBlocks(articleText: string): ContentBlock[] {
  if (!articleText) return [];

  const blocks: ContentBlock[] = [];
  const lines = articleText.split('\n');
  
  let currentBlock: ContentBlock | null = null;
  let bodyLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Check if line is a heading
    if (line.startsWith('Heading1:') || line.startsWith('H2:') || line.startsWith('H3:')) {
      // Save previous block if exists
      if (currentBlock) {
        currentBlock.bodyText = bodyLines.join('\n').trim();
        blocks.push(currentBlock);
      }
      
      // Start new block based on heading type
      if (line.startsWith('Heading1:')) {
        currentBlock = {
          headingType: 'h1',
          headingText: line.substring(9).trim(),
          bodyText: ''
        };
      } else if (line.startsWith('H2:')) {
        currentBlock = {
          headingType: 'h2',
          headingText: line.substring(3).trim(),
          bodyText: ''
        };
      } else if (line.startsWith('H3:')) {
        currentBlock = {
          headingType: 'h3',
          headingText: line.substring(3).trim(),
          bodyText: ''
        };
      }
      bodyLines = [];
    } else if (line.length > 0) {
      // Add to body text
      bodyLines.push(line);
    } else if (bodyLines.length > 0) {
      // Empty line - preserve as paragraph break
      bodyLines.push('');
    }
  }

  // Save final block
  if (currentBlock) {
    currentBlock.bodyText = bodyLines.join('\n').trim();
    blocks.push(currentBlock);
  }

  // Handle case where there's body text before any heading
  if (blocks.length === 0 && bodyLines.length > 0) {
    blocks.push({
      headingType: null,
      headingText: null,
      bodyText: bodyLines.join('\n').trim()
    });
  }

  return blocks;
}

async function migrateArticleContent() {
  console.log('Starting migration of articleText to articleContent...');
  
  try {
    // Get all generated content with articleText
    const contents = await prisma.generatedContent.findMany({
      where: {
        articleText: {
          not: null
        },
        articleContent: null
      }
    });

    console.log(`Found ${contents.length} records to migrate`);

    let successCount = 0;
    let errorCount = 0;

    for (const content of contents) {
      try {
        if (!content.articleText) continue;

        // Parse the article text into blocks
        const articleContent = parseArticleTextToBlocks(content.articleText);

        // Update the record
        await prisma.generatedContent.update({
          where: { id: content.id },
          data: {
            articleContent: articleContent as any
          }
        });

        successCount++;
        console.log(`✓ Migrated content ${content.id} (${successCount}/${contents.length})`);
      } catch (error) {
        errorCount++;
        console.error(`✗ Failed to migrate content ${content.id}:`, error);
      }
    }

    console.log('\nMigration complete!');
    console.log(`Success: ${successCount}`);
    console.log(`Errors: ${errorCount}`);
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

migrateArticleContent();
