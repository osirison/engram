import { z } from 'zod';

import { serverEnv } from '@/server/env';
import { protectedProcedure, router } from '../trpc';

export const metaRouter = router({
  /** Backend capability flags so the UI can disable write actions gracefully. */
  capabilities: protectedProcedure.query(({ ctx }) => ctx.backend.capabilities()),

  /** Distinct data owners (userIds) present in storage, for the scope switcher. */
  owners: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(100) }).optional())
    .query(({ ctx, input }) => ctx.backend.listMemoryOwners(input?.limit ?? 100)),

  /** The signed-in operator plus dashboard defaults. */
  session: protectedProcedure.query(({ ctx }) => ({
    user: {
      id: ctx.session.user.id,
      name: ctx.session.user.name ?? null,
      email: ctx.session.user.email ?? null,
      image: ctx.session.user.image ?? null,
      provider: ctx.session.user.provider ?? null,
    },
    defaultUserId: serverEnv.defaultUserId,
  })),
});
