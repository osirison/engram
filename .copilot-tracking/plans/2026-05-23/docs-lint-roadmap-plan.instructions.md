<!-- markdownlint-disable-file -->

# Docs, Lint, and Roadmap Plan

## User Requests

- Continue all prior suggested work items from Phase 5.
- Document remaining packages.
- Fix MCP server lint debt.
- Expand docs validation.
- Refresh roadmap accuracy.

## Objectives

- Keep onboarding documentation simple and linked from the root README.
- Ensure each workspace package has enough documentation for developers to identify purpose and commands.
- Make docs validation catch common regression classes before review.
- Reduce mcp-server lint failures by fixing package type resolution first.
- Keep unrelated package metadata/license churn out of the final diff.

## Context Summary

- Current branch: `docs/simplify-onboarding-docs`.
- Root docs and initial app/package docs have already been simplified.
- The current dirty worktree includes unrelated package license churn from local `npx pnpm` usage; cleanup is required before final review.
- Researcher Subagent found mcp-server lint debt is caused primarily by workspace package type declarations resolving to missing or stale `dist` files.

## Implementation Checklist

### Phase 1: Package Documentation <!-- parallelizable: true -->

- [x] Add READMEs for `packages/config`, `packages/core`, `packages/memory-ltm`, `packages/memory-stm`, `packages/vector-store`, `packages/ui`, and `packages/typescript-config`.
- [x] Link new READMEs from the root README where useful without making the root page noisy.

### Phase 2: MCP Server Lint <!-- parallelizable: false -->

- [x] Inspect mcp-server tsconfig/eslint package resolution.
- [x] Add or update config so local lint/typecheck resolves workspace package source instead of stale `dist` declarations.
- [x] Remove obsolete broad lint disables and fix true residual diagnostics.
- [x] Validate mcp-server lint with the least mutation-prone command available.

### Phase 3: Docs Validation <!-- parallelizable: true -->

- [x] Extend `.github/check-docs.mjs` to enforce frontmatter on tracked Markdown docs.
- [x] Detect duplicate headings in a single Markdown file.
- [x] Preserve existing local link and Copilot filename checks.

### Phase 4: Roadmap Refresh <!-- parallelizable: true -->

- [x] Rewrite `docs/roadmap.md` to describe current near-term tracks.
- [x] Remove stale Windows worktree and issue-wave instructions.
- [x] Keep roadmap concise and aligned with root setup docs.

### Phase 5: Review and Validation <!-- parallelizable: false -->

- [x] Run docs checker.
- [x] Run targeted diagnostics.
- [x] Run mcp-server lint/type validation or document blocker.
- [x] Run `git diff --check`.
- [x] Compile final review and suggested next work.

## Dependencies

- Existing Node.js runtime for `.github/check-docs.mjs`.
- Existing workspace TypeScript and ESLint configuration.
- No new package dependencies planned.

## Success Criteria

- All selected follow-up items are addressed or explicitly documented as blocked.
- Documentation checks pass.
- Markdown diagnostics for edited docs pass.
- MCP lint debt is reduced at the root cause or blockers are documented with exact evidence.
- Final diff excludes unrelated license metadata and generated files.
