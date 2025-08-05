import { initTRPC, TRPCError } from '@trpc/server';
import { getUserFromToken } from '../utils/auth';

export interface Context {
  user?: {
    id: string;
    email: string;
    name?: string;
  } | null;
}

export const createContext = async (req: any): Promise<Context> => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return { user: null };
  }

  const user = await getUserFromToken(token);
  return { user };
};

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

// Protected procedure that requires authentication
export const protectedProcedure = t.procedure.use(
  t.middleware(({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);
