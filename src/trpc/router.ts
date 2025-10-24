import { router } from './trpc-context';
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
import { keywordCannibalizationRouter } from './routers/keywordCannibalization';
import { settingsRouter } from './routers/settings';
import { leadsRouter } from './routers/leads';

export const appRouter = router({
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
  keywordCannibalization: keywordCannibalizationRouter,
  settings: settingsRouter,
  leads: leadsRouter,
});

export type AppRouter = typeof appRouter;
