import { router } from './context';
import { authRouter } from './routers/auth';
import { usersRouter } from './routers/users';
import { googleAccountsRouter } from './routers/googleAccounts';
import { campaignsRouter } from './routers/campaigns';

export const appRouter = router({
  auth: authRouter,
  users: usersRouter,
  googleAccounts: googleAccountsRouter,
  campaigns: campaignsRouter,
});

export type AppRouter = typeof appRouter;
