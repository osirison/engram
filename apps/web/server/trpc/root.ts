import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';

import { createCallerFactory, router } from './trpc';
import { analyticsRouter } from './routers/analytics';
import { healthRouter } from './routers/health';
import { memoryRouter } from './routers/memory';
import { metaRouter } from './routers/meta';

export const appRouter = router({
  memory: memoryRouter,
  health: healthRouter,
  analytics: analyticsRouter,
  meta: metaRouter,
});

export type AppRouter = typeof appRouter;
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export const createCaller = createCallerFactory(appRouter);
