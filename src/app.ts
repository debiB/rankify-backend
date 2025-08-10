import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './trpc/router';
import { createContext } from './trpc/context';
import { initializeAdmin } from './utils/adminInit';
import { verifySMTPConnection } from './utils/email';
import oauthRoutes from './routes/oauth';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  })
);
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// tRPC middleware
app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

// OAuth routes
app.use('/auth', oauthRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// Basic error handling middleware
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error(err.stack);
    res.status(500).json({
      error: 'Something went wrong!',
      message:
        process.env.NODE_ENV === 'development'
          ? err.message
          : 'Internal server error',
    });
  }
);

// 404 handler - catch all unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server with admin initialization
const startServer = async () => {
  try {
    // Initialize admin account
    await initializeAdmin();

    // Verify SMTP connection
    const smtpVerified = await verifySMTPConnection();
    if (!smtpVerified) {
      console.warn(
        '⚠️  SMTP connection failed. Email functionality may not work properly.'
      );
    } else {
      console.log('✅ SMTP connection verified');
    }

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
      console.log(`🔗 tRPC endpoint: http://localhost:${PORT}/trpc`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

export default app;
