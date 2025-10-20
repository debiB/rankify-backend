import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function splitUserNames() {
  console.log('Starting user name split process...');

  try {
    // Fetch all users who have a name but no firstName or lastName
    const users = await prisma.user.findMany({
      where: {
        name: {
          not: null,
        },
        OR: [
          { firstName: null },
          { lastName: null },
        ],
      },
    });

    console.log(`Found ${users.length} users to process`);

    let successCount = 0;
    let errorCount = 0;

    for (const user of users) {
      try {
        if (!user.name) continue;

        // Split name by space delimiter
        const nameParts = user.name.trim().split(/\s+/);
        
        let firstName: string;
        let lastName: string;

        if (nameParts.length === 1) {
          // Single name - use as firstName
          firstName = nameParts[0];
          lastName = '';
        } else if (nameParts.length === 2) {
          // Two parts - first and last name
          firstName = nameParts[0];
          lastName = nameParts[1];
        } else {
          // More than two parts - first part as firstName, rest as lastName
          firstName = nameParts[0];
          lastName = nameParts.slice(1).join(' ');
        }

        // Update user with split names
        await prisma.user.update({
          where: { id: user.id },
          data: {
            firstName: firstName || null,
            lastName: lastName || null,
          },
        });

        console.log(`✓ Updated user ${user.email}: "${user.name}" → firstName: "${firstName}", lastName: "${lastName}"`);
        successCount++;
      } catch (error) {
        console.error(`✗ Error updating user ${user.email}:`, error);
        errorCount++;
      }
    }

    console.log('\n=== Summary ===');
    console.log(`Total users processed: ${users.length}`);
    console.log(`Successfully updated: ${successCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log('User name split process completed!');
  } catch (error) {
    console.error('Fatal error during user name split:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
splitUserNames();
