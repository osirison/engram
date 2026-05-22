<!-- markdownlint-disable-file -->

# Docs, Lint, and Roadmap Planning Log

## Discrepancy Log

- Previous local `npx pnpm` usage introduced unrelated package `license` changes and an untracked `LICENSE`; those must be excluded from final changes.
- MCP lint debt is broader than expected but appears root-caused by package type resolution to missing or stale `dist` declarations.
- Existing docs checker does not yet enforce frontmatter or duplicate headings.
- Implementation confirmed that source path mappings resolve the package import failures in mcp-server type-checks without relying on generated `dist` declarations. The mappings live in `apps/mcp-server/tsconfig.check.json` so build emit layout stays unchanged.
- Removing broad lint disables surfaced several `JSON.parse` test assertions that needed typed helpers rather than blanket suppression.

## Implementation Paths Considered

### Selected

- Add missing package docs directly.
- Use source-based package resolution for mcp-server local lint/typecheck where feasible.
- Extend existing dependency-free docs checker.
- Rewrite roadmap rather than patch old issue-wave text.

### Alternatives

- Build all packages before lint. This may still be useful in CI, but is less deterministic for local lint because `dist` is generated and ignored.
- Introduce markdownlint or a link-check dependency. Deferred to keep this pass focused.

## Suggested Follow-On Work

- Consider a repo-wide workspace type resolution strategy so all apps can lint against source packages consistently.
- Add docs checker coverage for orphaned package docs after the initial checker is stable.

## Validation Log

- `node .github/check-docs.mjs`: passed.
- `apps/mcp-server`: `../../node_modules/.bin/tsc -p tsconfig.check.json --noEmit --pretty false`: passed.
- `apps/mcp-server`: `../../node_modules/.bin/eslint "{src,apps,libs,test}/**/*.ts" --format stylish`: passed.
- `apps/mcp-server`: focused Jest run for changed memory and health tests: passed, 5 suites and 86 tests.
- `git diff --check`: passed.
