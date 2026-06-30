import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import { createContext } from '@/server/trpc/context';
import { appRouter } from '@/server/trpc/root';

function handler(req: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext,
    onError({ error, path }) {
      if (error.code === 'INTERNAL_SERVER_ERROR') {
        console.error(`[trpc] ${path ?? '<no-path>'}:`, error.message);
      }
    },
  });
}

export { handler as GET, handler as POST };
