import { protectedProcedure, router } from '../trpc';

export const healthRouter = router({
  status: protectedProcedure.query(({ ctx }) => ctx.backend.getHealth()),
  metrics: protectedProcedure.query(({ ctx }) => ctx.backend.getMetrics()),
});
