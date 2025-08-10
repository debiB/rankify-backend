import express from 'express';
import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const router = express.Router();
const prisma = new PrismaClient();

// Validate required environment variables
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error(
    'Missing Google OAuth credentials. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file'
  );
}

// Google OAuth configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI ||
    'http://localhost:3001/auth/google/callback'
);

// Scopes needed for Google Search Console API
const SCOPES = [
  'https://www.googleapis.com/auth/webmasters',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

// Middleware to verify admin token
const verifyAdminToken = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    (req as any).user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Generate OAuth URL
router.get('/google/url', verifyAdminToken, (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({
        error:
          'Google OAuth not configured. Please set up GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      });
    }

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent', // Force consent to get refresh token
    });

    res.json({ authUrl });
  } catch (error) {
    console.error('Error generating OAuth URL:', error);
    res.status(500).json({ error: 'Failed to generate OAuth URL' });
  }
});

// OAuth callback
router.get('/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    // State is optional for security, but we can use it if provided
    // For now, we'll proceed without requiring state validation

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code as string);

    if (!tokens.access_token || !tokens.refresh_token) {
      return res
        .status(400)
        .json({ error: 'Failed to get access and refresh tokens' });
    }

    // Get user info from Google
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    // Check if account already exists
    const existingAccount = await prisma.googleAccount.findUnique({
      where: { email: userInfo.data.email! },
    });

    if (existingAccount) {
      // Update existing account with new tokens
      await prisma.googleAccount.update({
        where: { id: existingAccount.id },
        data: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: new Date(tokens.expiry_date!),
          isActive: true,
        },
      });
    } else {
      // Create new account
      await prisma.googleAccount.create({
        data: {
          email: userInfo.data.email!,
          accountName: userInfo.data.name || userInfo.data.email!,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: new Date(tokens.expiry_date!),
          isActive: true,
        },
      });
    }

    // Redirect to frontend with success
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(
      `${frontendUrl}/google-accounts?success=true&email=${userInfo.data.email}`
    );
  } catch (error) {
    console.error('OAuth callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/google-accounts?error=oauth_failed`);
  }
});

// Refresh token endpoint
router.post('/google/refresh', verifyAdminToken, async (req, res) => {
  try {
    const { accountId } = req.body;

    const account = await prisma.googleAccount.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Set credentials with refresh token
    oauth2Client.setCredentials({
      refresh_token: account.refreshToken,
    });

    // Refresh the token
    const { credentials } = await oauth2Client.refreshAccessToken();

    // Update account with new tokens
    await prisma.googleAccount.update({
      where: { id: accountId },
      data: {
        accessToken: credentials.access_token!,
        refreshToken: credentials.refresh_token || account.refreshToken,
        expiresAt: new Date(credentials.expiry_date!),
        isActive: true,
      },
    });

    res.json({ success: true, message: 'Token refreshed successfully' });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

export default router;
