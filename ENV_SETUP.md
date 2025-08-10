# Environment Variables Setup

Create a `.env` file in the backend directory with the following variables:

## Required Variables

```env
# Database
DATABASE_URL="mysql://user:password@localhost:3306/rank_ranger"

# Server
PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
FRONTEND_URL=http://localhost:3000

# JWT Secret
JWT_SECRET=your-super-secret-jwt-key-here

# Google OAuth (Required for Google Search Console integration)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback
```

## Optional Variables

### Admin Account
These are used to create an admin account on first server startup if no admin exists:

```env
ADMIN_EMAIL=admin@rankify.com
ADMIN_PASSWORD=admin123
ADMIN_NAME=System Administrator
```

### Email Configuration
These are used for sending temporary passwords to new users:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=Rankify Team <noreply@rankify.com>
FRONTEND_URL=http://localhost:3000
```

## Google OAuth Setup

To set up Google OAuth for Search Console integration:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Search Console API
4. Go to "Credentials" and create an OAuth 2.0 Client ID
5. Set the authorized redirect URI to: `http://localhost:3001/auth/google/callback` (for development)
6. Copy the Client ID and Client Secret to your `.env` file

For production, update the `GOOGLE_REDIRECT_URI` to your production domain.

## Development vs Production

- Both development and production use the same SMTP configuration
- Set up real SMTP credentials for actual email delivery
- The admin account will only be created if `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set
- Google OAuth credentials must be configured for both environments
