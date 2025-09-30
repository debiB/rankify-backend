# RankifyTrack Backend

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
GEMINI_API_KEY="your-gemini-api-key-here"
```

## 🛠️ Development

The server runs on port 3001 by default. Make sure your MySQL database is running and the connection string in `.env` is correct.

For development, the server will automatically restart when you make changes to the source code. 

## 📊 Search Console Data Model & Aggregation (New)

### Monthly Keyword Metrics (Persistence)
- We persist per-month keyword metrics in `SearchConsoleKeywordMonthlyComputed` to avoid calling the Google Search Console (GSC) API on UI refresh.
- For each keyword and month:
  - Window: current month → all available days; past months → last 7 days of that month.
  - Determine a single top page across the window by total impressions.
  - Tie-breakers (in order): daysWithData → clicks → better (lower) avg position → prefer URL without hash → shorter URL → lexicographic.
  - Compute weighted average position using only that page’s rows: Σ(position × impressions) / Σ(impressions).
  - Upsert result into `SearchConsoleKeywordMonthlyComputed` with `{ topRankingPageUrl, averageRank, impressions, clicks, calcWindowDays }`.

### Read Path (Frontend/API)
- `campaigns.getCampaignAnalytics` reads monthly rank/top page/impressions directly from `SearchConsoleKeywordMonthlyComputed`.
- No GSC calls occur on tab refresh. Missing months remain zero until cron/data-fetch fills them.

### Initial Rank (Baseline)
- On campaign create/update (and re-fetch), we compute an initial rank per keyword from the 7 days before `startingDate`:
  - Select the top page across those 7 days using the same tie-breakers as above.
  - Compute weighted average position using only that page’s rows.
  - Store in `SearchConsoleKeyword.initialPosition`. Daily rows are kept for diagnostics/search volume.

### Cron & Data Flows
- Cron jobs (monthly/daily) call `fetchDailyKeywordData`, which now also computes/updates `SearchConsoleKeywordMonthlyComputed`.
- `createCampaign`, `updateCampaign` (when startingDate changes), and admin "Get All Data" flows trigger the same computation.

### Data Deletion
- Admin "Delete All Data" deletes in safe FK order:
  1) `SearchConsoleKeywordMonthlyComputed`
  2) `SearchConsoleKeywordMonthlyStat`
  3) `SearchConsoleKeyword`
  4) `SearchConsoleKeywordAnalytics`
  5) `SearchConsoleTrafficDaily`
  6) `SearchConsoleTrafficMonthly`
  7) `SearchConsoleTrafficAnalytics`
- After deletion, use "Get All Data" to repopulate, or wait for cron.

## 🎨 Brand Personalization Module

### Overview
The Brand Personalization module allows admins to upload brand resources (URLs, PDFs, and other documents) to create a brand profile. The system analyzes these resources using Google's Gemini API to extract brand tone, style, and structure preferences.

### Database Models
- `BrandProfile` - Main brand profile containing name and tone data
- `BrandProfileUrl` - URLs associated with a brand profile
- `BrandProfilePdf` - PDFs associated with a brand profile
- `BrandProfileOtherDoc` - Other documents associated with a brand profile

### API Endpoints (tRPC)
- `brand.uploadResources` - Upload URLs/docs; process with Gemini API to extract tone/style; store in BrandProfile
- `brand.getProfile` - Return stored brand tone/profile
- `brand.updateProfile` - Update/fine-tune tone memory

### Workflow
1. Admin uploads URLs, PDFs, or other reference docs
2. Backend analyzes resources via Gemini API:
   - Detect brand tone (formal, casual, persuasive)
   - Detect style (sentence length, readability, first-person usage "we/our/site")
   - Detect structure preferences (headline/subheading styles)
3. Store analysis in BrandProfile for reuse
4. Admin can update/fine-tune memory as needed

### Environment Setup
To use the Brand Personalization module, you need to set the `GEMINI_API_KEY` environment variable in your `.env` file with a valid Google Gemini API key.