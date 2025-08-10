import { PrismaClient } from '@prisma/client';
import { hashPassword } from './auth';

const prisma = new PrismaClient();

export const initializeAdmin = async () => {
  try {
    // Check if any admin user exists
    const existingAdmin = await prisma.user.findFirst({
      where: {
        role: 'ADMIN',
      },
    });

    if (existingAdmin) {
      console.log('✅ Admin account already exists');
      return;
    }

    // Get admin credentials from environment variables
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminName = process.env.ADMIN_NAME || 'System Administrator';

    if (!adminEmail || !adminPassword) {
      console.log('⚠️  ADMIN_EMAIL and ADMIN_PASSWORD not set in environment variables');
      console.log('   Skipping admin account creation');
      return;
    }

    // Check if the email is already taken
    const existingUser = await prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (existingUser) {
      console.log('⚠️  Admin email already exists but user is not an admin');
      return;
    }

    // Create admin account
    const hashedPassword = await hashPassword(adminPassword);

    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        password: hashedPassword,
        name: adminName,
        role: 'ADMIN',
        status: 'ACTIVE',
        hasChangedPassword: true, // Admin doesn't need to change password on first login
      },
    });

    console.log('✅ Admin account created successfully');
    console.log(`   Email: ${admin.email}`);
    console.log(`   Name: ${admin.name}`);
    console.log('   Password: (from environment variables)');
  } catch (error) {
    console.error('❌ Failed to initialize admin account:', error);
  }
};
