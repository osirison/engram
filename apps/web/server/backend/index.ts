import { prisma } from '../db';
import { serverEnv } from '../env';
import { PrismaEngramBackend } from './prisma-backend';
import type { EngramBackend } from './types';

let cached: EngramBackend | null = null;

/** The process-wide backend singleton used by the tRPC context. */
export function getBackend(): EngramBackend {
  if (!cached) {
    cached = new PrismaEngramBackend({
      prisma,
      mcpUrl: serverEnv.mcpUrl,
      mcpApiKey: serverEnv.mcpApiKey,
    });
  }
  return cached;
}

export * from './types';
