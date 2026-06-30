import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { serverEnv } from './env';

/**
 * A single Prisma client for the dashboard's read/analytics path.
 *
 * The dashboard reads Postgres directly (the source of truth) for listing,
 * fetching, and aggregating memories — operations no MCP tool exposes. Writes
 * and semantic recall are routed through the MCP server instead so the derived
 * vector index stays in sync (see `server/backend`).
 *
 * The client is cached on `globalThis` so Next.js dev hot-reloads reuse one
 * connection pool instead of opening a new one on every module reload.
 */

function createPrisma(): PrismaClient {
  // A placeholder connection string keeps construction non-throwing when
  // DATABASE_URL is absent; the failure then surfaces lazily on first query
  // with a clear Postgres connection error rather than at import time.
  const connectionString =
    serverEnv.databaseUrl ?? 'postgresql://invalid:invalid@127.0.0.1:65535/invalid';
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

const globalForPrisma = globalThis as typeof globalThis & {
  __engramPrisma__?: PrismaClient;
};

export const prisma: PrismaClient = globalForPrisma.__engramPrisma__ ?? createPrisma();

if (!serverEnv.isProduction) {
  globalForPrisma.__engramPrisma__ = prisma;
}
