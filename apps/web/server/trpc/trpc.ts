import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';

import type { Session } from 'next-auth';

import { BackendError } from '@/server/backend';
import { canOperatorManageUser, serverEnv } from '@/server/env';
import type { TRPCContext } from './context';

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const isInternal = shape.data.code === 'INTERNAL_SERVER_ERROR';
    return {
      ...shape,
      // Don't leak internal error text to clients in production.
      message: isInternal && serverEnv.isProduction ? 'Internal server error' : shape.message,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

/** Translate a `BackendError` into the matching tRPC error code. */
export function toTRPCError(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;
  if (error instanceof BackendError) {
    const code =
      error.code === 'NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'WRITES_DISABLED'
          ? 'PRECONDITION_FAILED'
          : error.code === 'BAD_REQUEST'
            ? 'BAD_REQUEST'
            : error.code === 'CONFLICT'
              ? 'CONFLICT'
              : error.code === 'UNAVAILABLE'
                ? 'SERVICE_UNAVAILABLE'
                : 'INTERNAL_SERVER_ERROR';
    return new TRPCError({ code, message: error.message, cause: error });
  }
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: error instanceof Error ? error.message : 'Unexpected error',
    cause: error,
  });
}

/**
 * Centralises `BackendError` → tRPC code translation for every procedure, so a
 * `WRITES_DISABLED` (etc.) surfaces with the right HTTP status without each
 * resolver needing its own try/catch.
 */
const translateBackendErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof BackendError) {
    throw toTRPCError(result.error.cause);
  }
  return result;
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure.use(translateBackendErrors);

/** Requires an authenticated operator; narrows `ctx.session` to non-null. */
export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You must be signed in.' });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

/**
 * Enforce the optional per-operator tenant binding (WP2 T9/D11). With no binding
 * configured this allows any userId (zero-config default); otherwise it throws
 * FORBIDDEN unless the operator is bound to that data owner. The enforcement
 * point is the SERVER — the UI switcher only filters for convenience. Call this
 * at the top of every userId-taking procedure.
 */
export function assertCanManageUser(session: Session | null, userId: string): void {
  const email = session?.user?.email ?? null;
  if (!canOperatorManageUser(email, userId)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `You are not permitted to manage data for "${userId}".`,
    });
  }
}
