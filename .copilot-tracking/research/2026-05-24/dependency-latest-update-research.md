<!-- markdownlint-disable-file -->

# Dependency Latest Update Research

## Scope

Update workspace dependencies to the latest registry versions across the root monorepo, apps, and packages.

## Evidence

- `pnpm outdated -r` shows many runtime, dev, and tooling packages behind the latest registry versions.
- Shared dependency families include NestJS 11.x, Next.js 16.x, Prisma 7.x, ESLint 10.x, TypeScript 6.x, Vitest 4.1.x, and OpenAI 6.x.
- Several packages are pinned across multiple workspace manifests, so a single lockfile update must keep workspace dependency ranges consistent.

## Initial Hypothesis

A workspace-wide dependency update is the correct first step. The most likely follow-up work is resolving any breakage introduced by major-version bumps in linting, Prisma, or Next.js tooling.

## Cheap Check

Run a recursive workspace update and then verify install/build/test health at the package boundaries most likely to break first.

## Notes

- The repo already has unrelated lint failures in `apps/mcp-server` and related tests, so validation should focus on dependency-install health and the specific packages changed by the update.
- Avoid changing unrelated source files unless the updated dependency set forces a compatibility fix.
