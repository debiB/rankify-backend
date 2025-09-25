import { router } from './context';
import { authRouter } from './routers/auth';
import { usersRouter } from './routers/users';
import { googleAccountsRouter } from './routers/googleAccounts';
import { campaignsRouter } from './routers/campaigns';
import { adminRouter } from './routers/admin';
import { settingsRouter } from './routers/settings';

export const appRouter = router({
  auth: authRouter,
  users: usersRouter,
  googleAccounts: googleAccountsRouter,
  campaigns: campaignsRouter,
  admin: adminRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
