import { initTRPC, TRPCError } from '@trpc/server';
import { getUserFromToken } from '../utils/auth';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface Context {
  user?: {
    id: string;
    email: string;
    name?: string | null;
    role: 'ADMIN' | 'USER';
    status: 'ACTIVE' | 'INACTIVE';
    hasChangedPassword: boolean;
    createdAt: Date;
  } | null;
  prisma: PrismaClient;
}

export const createContext = async ({
  req,
  res,
}: {
  req: any;
  res: any;
}): Promise<Context> => {
  // Handle case where req or req.headers might be undefined
  if (!req || !req.headers) {
    return { user: null, prisma };
  }

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return { user: null, prisma };
  }

  const user = await getUserFromToken(token);
  if (!user) {
    return { user: null, prisma };
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      hasChangedPassword: user.hasChangedPassword,
      createdAt: user.createdAt,
    },
    prisma,
  };
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

// Admin-only procedure that requires admin role
export const adminProcedure = t.procedure.use(
  t.middleware(({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    if (ctx.user.role !== 'ADMIN' || ctx.user.status !== 'ACTIVE') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Admin access required',
      });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);
