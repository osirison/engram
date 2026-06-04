# Research: lint-staged failure in apps/mcp-server/src/main.ts

## Status

Complete

## Research topics/questions

1. Locate ESLint error in apps/mcp-server/src/main.ts around line 105 (`@typescript-eslint/explicit-function-return-type`).
2. Identify exact function and minimal no-behavior-change fix.
3. Check for likely remaining staged-file issues based on `.lintstagedrc.js` and ESLint/Prettier setup.

## Findings

### 1) Exact error location

- File: apps/mcp-server/src/main.ts
- Confirmed by line-numbered read and direct lint run.
- Error line:
  - `sessionIdGenerator: () => randomUUID(),` at line 105.

Evidence:

- `nl -ba apps/mcp-server/src/main.ts | sed -n '90,140p'` shows line 105 as the `sessionIdGenerator` arrow function.
- `npx eslint apps/mcp-server/src/main.ts` output:
  - `105:15  error  Missing return type on function  @typescript-eslint/explicit-function-return-type`

### 2) Root cause and minimal fix

Root cause:

- Root ESLint config enables `@typescript-eslint/explicit-function-return-type: error`.
- The inline arrow function assigned to `sessionIdGenerator` has no explicit return type annotation.

Minimal fix (no behavior change):

- Add explicit `: string` return type to the arrow function.

Before:

```ts
sessionIdGenerator: () => randomUUID(),
```

After:

```ts
sessionIdGenerator: (): string => randomUUID(),
```

Why minimal and safe:

- `randomUUID()` already returns `string`; annotation only satisfies lint typing style.
- Runtime behavior is unchanged.

### 3) Likely remaining staged-file lint issues

Config review:

- `.lintstagedrc.js`
  - `*.{ts,tsx}` runs: `eslint --fix` then `prettier --write`
  - `*.{json,md,yml,yaml}` runs: `prettier --write`
- Root `eslint.config.js` includes `@typescript-eslint/explicit-function-return-type: 'error'`.
- Root Prettier config enforces stylistic formatting, including semicolons and print width.

Assessment for this specific file (`apps/mcp-server/src/main.ts`):

- Based on `npx eslint apps/mcp-server/src/main.ts`, only one lint error is currently reported (line 105 missing return type).
- After applying the minimal fix, no additional ESLint errors are expected for this file.
- Prettier is unlikely to introduce issues from this one-line annotation change.

Potential residual repo-level caveat:

- The lint command emits a Node warning (`MODULE_TYPELESS_PACKAGE_JSON`) because `eslint.config.js` is ESM syntax in a package without `"type": "module"`; this is a warning, not a lint-staged failure.

## Proposed patch snippet (not applied)

```diff
--- a/apps/mcp-server/src/main.ts
+++ b/apps/mcp-server/src/main.ts
@@
-              sessionIdGenerator: () => randomUUID(),
+              sessionIdGenerator: (): string => randomUUID(),
```

## Validation commands

From repo root:

1. `npx eslint apps/mcp-server/src/main.ts`
2. `npx prettier --check apps/mcp-server/src/main.ts`
3. `npx lint-staged --debug`

Optional (simulate staged check for only this file):

1. `git add apps/mcp-server/src/main.ts`
2. `npx lint-staged --debug`

## Clarifying questions (if needed)

- None required for the identified fix.
