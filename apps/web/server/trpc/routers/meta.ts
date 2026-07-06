import { z } from 'zod';

import { allowedTenantsFor, canOperatorManageUser, serverEnv } from '@/server/env';
import { protectedProcedure, router } from '../trpc';

export const metaRouter = router({
  /** Backend capability flags so the UI can disable write actions gracefully. */
  capabilities: protectedProcedure.query(({ ctx }) => ctx.backend.capabilities()),

  /**
   * Distinct data owners (userIds) for the scope switcher. Filtered to the
   * operator's tenant binding (WP2 T9) so a bound operator only sees owners it may
   * manage — the server is still the enforcement point (data procedures re-check),
   * this just keeps the switcher honest. Unset binding ⇒ every owner is shown.
   */
  owners: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(100) }).optional())
    .query(async ({ ctx, input }) => {
      const owners = await ctx.backend.listMemoryOwners(input?.limit ?? 100);
      const email = ctx.session.user.email ?? null;
      return owners.filter((o) => canOperatorManageUser(email, o.userId));
    }),

  /**
   * The data owners this operator may manage (WP2 T9): `'*'` when unbound, else
   * the explicit list. The switcher uses it to gate free-text entry.
   */
  allowedTenants: protectedProcedure.query(({ ctx }) =>
    allowedTenantsFor(ctx.session.user.email ?? null)
  ),

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
