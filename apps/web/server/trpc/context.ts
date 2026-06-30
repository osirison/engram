import type { Session } from 'next-auth';

import { auth } from '@/auth';
import { getBackend, type EngramBackend } from '@/server/backend';

export interface TRPCContext {
  session: Session | null;
  backend: EngramBackend;
}

/**
 * Build the per-request tRPC context. The NextAuth session is resolved from the
 * request cookies; the backend is the process-wide singleton.
 */
export async function createContext(): Promise<TRPCContext> {
  const session = await auth();
  return {
    session,
    backend: getBackend(),
  };
}
