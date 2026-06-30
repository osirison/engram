import { z } from 'zod';

import { protectedProcedure, router } from '../trpc';

const userId = z.string().min(1).max(256);

export const analyticsRouter = router({
  stats: protectedProcedure
    .input(z.object({ userId }))
    .query(({ ctx, input }) => ctx.backend.getMemoryStats(input.userId)),

  activity: protectedProcedure
    .input(z.object({ userId, days: z.number().int().min(1).max(365).default(30) }))
    .query(({ ctx, input }) => ctx.backend.getActivitySeries(input.userId, input.days)),
});
