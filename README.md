# Rank Ranger Backend

Express.js server with TypeScript, tRPC, Prisma, and JWT authentication.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MySQL database
- npm

### Installation

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up environment variables**
   ```bash
   cp env.example .env
   ```
   Edit `.env` with your database credentials and JWT secret.

3. **Set up database**
   ```bash
   # Generate Prisma client
   npm run db:generate
   
   # Push schema to database
   npm run db:push
   ```

4. **Start development server**
   ```bash
   npm run dev
   ```

## 📁 Project Structure

```
backend/
├── src/
│   ├── controllers/     # Route controllers
│   ├── middleware/      # Custom middleware
│   ├── routes/          # Express routes
│   ├── services/        # Business logic
│   ├── utils/           # Utility functions
│   │   └── auth.ts      # Authentication utilities
│   ├── trpc/            # tRPC configuration
│   │   ├── context.ts   # tRPC context
│   │   └── router.ts    # tRPC router
│   └── app.ts           # Main application
├── prisma/
│   └── schema.prisma    # Database schema
├── tests/               # Test files
└── dist/                # Compiled JavaScript
```

## 🔧 Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm run start` - Start production server
- `npm run db:generate` - Generate Prisma client
- `npm run db:push` - Push schema changes to database
- `npm run db:migrate` - Create and apply migrations
- `npm run db:studio` - Open Prisma Studio

## 🔐 Authentication

The server uses JWT authentication with the following endpoints:

- `POST /trpc/register` - Register new user
- `POST /trpc/login` - Login user
- `GET /trpc/getProfile` - Get user profile (protected)
- `GET /trpc/getUsers` - Get all users (protected)

## 🌐 API Endpoints

- `GET /health` - Health check endpoint

## 🔒 Environment Variables

Required environment variables in `.env`:

```env
DATABASE_URL="mysql://username:password@localhost:3306/rank_ranger"
JWT_SECRET="your-super-secret-jwt-key-at-least-32-characters-long"
JWT_EXPIRES_IN="7d"
PORT=3001
NODE_ENV=development
CORS_ORIGIN="http://localhost:3000"
```

## 🛠️ Development

The server runs on port 3001 by default. Make sure your MySQL database is running and the connection string in `.env` is correct.

For development, the server will automatically restart when you make changes to the source code. 