<!-- markdownlint-disable-file -->

# Dependency Latest Update Plan

## User Requests

- Update all libraries in the project to the latest versions.

## Overview

Use a workspace-wide pnpm update to refresh dependency manifests and the lockfile, then validate the result with install and targeted checks. If major-version bumps introduce compile or tooling regressions, fix only the minimum compatibility surface required by the update.

## Context Summary

- Repository guidance from [AGENTS.md](../../../AGENTS.md).
- Repository documentation guidance from [README.md](../../../README.md) and [docs/SETUP.md](../../../docs/SETUP.md).
- Existing repo note in `/memories/repo/engram-docs.md` about avoiding `npx pnpm docs:check` because it can introduce unrelated `license` fields and an untracked `LICENSE`.

## Implementation Checklist

- [x] Run a workspace-wide dependency update to latest versions.
- [x] Review the generated manifest and lockfile changes for unintended package drift.
- [x] Validate installation and the most relevant build/test boundary for the updated dependency set.
- [x] Fix compatibility issues only if they are caused by the dependency refresh.

## Validation Notes

- `pnpm up -r --latest` updated the workspace dependency graph and refreshed `pnpm-lock.yaml`.
- `pnpm install` completed successfully after the update.
- `apps/web` and `apps/docs` both built successfully on Next.js 16.2.6.
- `packages/core` needed a Zod 4 schema-shape compatibility fix in `src/mcp/tools/index.spec.ts`.

## Dependencies

- pnpm via `npm exec --yes pnpm@11.4.0 --`
- Existing workspace scripts and package manifests

## Success Criteria

- Package manifests and lockfile reflect the latest available dependency versions.
- The update does not introduce avoidable unrelated source changes.
- Validation completes with no new dependency-related failures beyond pre-existing repository issues.
