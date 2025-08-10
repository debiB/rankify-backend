import { router } from './context';
import { authRouter } from './routers/auth';
import { usersRouter } from './routers/users';
import { googleAccountsRouter } from './routers/googleAccounts';

export const appRouter = router({
  auth: authRouter,
  users: usersRouter,
  googleAccounts: googleAccountsRouter,
});

export type AppRouter = typeof appRouter;
