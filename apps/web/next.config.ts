import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Prisma and its driver adapter ship native/CommonJS bits that must not be
  // bundled by the server compiler — keep them external so they load at runtime.
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', '.prisma/client'],
  // Pin the workspace root: the worktree has its own pnpm-workspace.yaml and
  // would otherwise be confused with the parent checkout's lockfile.
  turbopack: {
    root: path.resolve(here, '../..'),
  },
};

export default nextConfig;
