import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/utils/auth';

const prisma = new PrismaClient();

async function createAdminUser() {
  try {
    const email = 'admin@rankify.com';
    const password = 'admin123';
    const name = 'System Administrator';

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      console.log(`⚠️  User with email ${email} already exists`);
      if (existingUser.role === 'ADMIN') {
        console.log('✅ User is already an admin');
        return;
      }
      
      // Update existing user to admin
      const updatedUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          role: 'ADMIN',
          hasChangedPassword: true,
        },
      });
      
      console.log(`✅ Updated user ${updatedUser.email} to admin role`);
      return;
    }

    // Hash the password
    const hashedPassword = await hashPassword(password);

    // Create the admin user
    const adminUser = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: 'ADMIN',
        status: 'ACTIVE',
        hasChangedPassword: true, // Admin doesn't need to change password on first login
      },
    });

    console.log('✅ Admin user created successfully');
    console.log(`   Email: ${adminUser.email}`);
    console.log(`   Name: ${adminUser.name}`);
    console.log('   Role: ADMIN');
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
createAdminUser();