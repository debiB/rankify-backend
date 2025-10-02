import { router } from './context';
import { authRouter } from './routers/auth';
import { usersRouter } from './routers/users';
import { googleAccountsRouter } from './routers/googleAccounts';
import { campaignsRouter } from './routers/campaigns';
import { adminRouter } from './routers/admin';
import { brandRouter } from './routers/brand';
import { keywordAnalysisRouter } from './routers/keywordAnalysis';
import { contentPlanRouter } from './routers/contentPlan';
import { contentGenerationRouter } from './routers/contentGeneration';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { milestonesRouter } from './routers/milestones';
import { whatsappRouter } from './routers/whatsapp';
import { cannibalizationRouter } from './routers/cannibalization';
import { settingsRouter } from './routers/settings';

// Import the router type to avoid TypeScript inference issues
import type { AnyRouter } from '@trpc/server';

// Explicitly type the appRouter to avoid TypeScript inference issues
export const appRouter: AnyRouter = router({
  auth: authRouter,
  users: usersRouter,
  googleAccounts: googleAccountsRouter,
  campaigns: campaignsRouter,
  admin: adminRouter,
  brand: brandRouter,
  keywordAnalysis: keywordAnalysisRouter,
  contentPlan: contentPlanRouter,
  contentGeneration: contentGenerationRouter,
  milestones: milestonesRouter,
  whatsapp: whatsappRouter,
  cannibalization: cannibalizationRouter,
  settings: settingsRouter,
});


export type AppRouter = typeof appRouter;
