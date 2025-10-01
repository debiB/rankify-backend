import { router } from './context';
import { authRouter } from './routers/auth';
import { usersRouter } from './routers/users';
import { googleAccountsRouter } from './routers/googleAccounts';
import { campaignsRouter } from './routers/campaigns';
import { adminRouter } from './routers/admin';
import { milestonesRouter } from './routers/milestones';
import { whatsappRouter } from './routers/whatsapp';
import { cannibalizationRouter } from './routers/cannibalization';
import { settingsRouter } from './routers/settings';

export const appRouter = router({
  auth: authRouter,
  users: usersRouter,
  googleAccounts: googleAccountsRouter,
  campaigns: campaignsRouter,
  admin: adminRouter,
  milestones: milestonesRouter,
  whatsapp: whatsappRouter,
  cannibalization: cannibalizationRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
