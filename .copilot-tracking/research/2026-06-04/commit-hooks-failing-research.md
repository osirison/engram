<!-- markdownlint-disable-file -->

# Task Research: Commit Hooks Failing

Investigate and resolve pre-commit failures from lint-staged where ESLint blocks commit due to a TypeScript rule violation in the MCP server app.

## Task Implementation Requests

- Diagnose why commit hooks fail during lint-staged execution.
- Identify minimal safe change to unblock hook without behavior changes.
- Provide validation commands to confirm hooks pass.

## Scope and Success Criteria

- Scope: Analyze current reported failure and repository lint/prettier configuration impact for staged files; exclude unrelated refactors.
- Assumptions:
  - User failure output is current for branch free-style.
  - Staged-file set is approximately the one shown in the hook output.
  - No additional hidden errors exist beyond current lint-staged run.
- Success Criteria:
  - Exact failing line and rule are identified with evidence.
  - One minimal patch is proposed that resolves the blocker.
  - Clear local validation sequence is provided.

## Outline

1. Confirm failing rule and source location.
2. Evaluate lint-staged config behavior on staged file classes.
3. Select minimal fix with lowest behavioral risk.
4. Provide verification and residual-risk notes.

## Potential Next Research

- Investigate Node ESM warning elimination (`MODULE_TYPELESS_PACKAGE_JSON`) if startup/tooling performance warnings should be removed.
  - Reasoning: Warning is non-blocking today but adds noise and minor parse overhead.
  - Reference: eslint invocation warning emitted for eslint.config.js under current package.json module type.

## Research Executed

### File Analysis

- apps/mcp-server/src/main.ts
  - Line 105 defines `sessionIdGenerator: () => randomUUID(),` without explicit return type.
- .lintstagedrc.js
  - `*.{ts,tsx}` runs `eslint --fix` then `prettier --write`.
  - `*.{json,md,yml,yaml}` runs `prettier --write`.
- eslint.config.js
  - Enforces `@typescript-eslint/explicit-function-return-type` as an error.

### Code Search Results

- `sessionIdGenerator`
  - Match in apps/mcp-server/src/main.ts around line 105.
- `explicit-function-return-type`
  - Match in eslint.config.js confirming rule severity `error`.

### External Research

- None required; issue is fully explained by repository-local configuration and file content.

### Project Conventions

- Standards referenced: TypeScript strict linting policy, lint-staged staged-file execution chain.
- Instructions followed: AGENTS.md repository constraints; task-research document conventions.

## Key Discoveries

### Project Structure

The failing file is in the main runtime app:

- apps/mcp-server/src/main.ts

Lint behavior is centralized at repository root and applies to staged TS files.

### Implementation Patterns

Inline callback functions in configuration objects are subject to explicit return type lint rules. Even for obvious return values (like `randomUUID()`), explicit annotations are required.

### Complete Examples

```ts
// before
sessionIdGenerator: () => randomUUID(),

// after
sessionIdGenerator: (): string => randomUUID(),
```

### API and Schema Documentation

No external API/schema changes are involved. This is a lint-style compliance update only.

### Configuration Examples

```js
// .lintstagedrc.js (relevant behavior)
'*.{ts,tsx}': ['eslint --fix', 'prettier --write']
```

## Technical Scenarios

### Scenario A: Minimal Type Annotation Fix (Selected)

Add explicit return type to the offending arrow function.

**Requirements:**

- Satisfy `@typescript-eslint/explicit-function-return-type`.
- Preserve runtime behavior.
- Keep patch scope minimal for safe commit unblocking.

**Preferred Approach:**

- Update one line in apps/mcp-server/src/main.ts:
  - `sessionIdGenerator: (): string => randomUUID(),`
- Rationale: Lowest complexity, no behavior impact, directly addresses the blocking ESLint error.

```text
apps/mcp-server/src/main.ts (single-line edit)
```

**Implementation Details:**

```diff
--- a/apps/mcp-server/src/main.ts
+++ b/apps/mcp-server/src/main.ts
@@
-              sessionIdGenerator: () => randomUUID(),
+              sessionIdGenerator: (): string => randomUUID(),
```

Validation:

```bash
npx eslint apps/mcp-server/src/main.ts
npx prettier --check apps/mcp-server/src/main.ts
npx lint-staged --debug
```

#### Considered Alternatives

- Relax or disable `@typescript-eslint/explicit-function-return-type` in eslint.config.js.
  - Rejected: broad policy downgrade for one local violation; increases long-term inconsistency and risk.
- Add `"type": "module"` to package.json to silence warning first.
  - Rejected for this incident: warning is non-blocking and unrelated to current hook failure.

## Selected Approach Summary

Selected Scenario A because it is the most direct, least risky remediation with immediate impact on the blocking hook path.

## Evidence Log

- Subagent report: .copilot-tracking/research/subagents/2026-06-04/lint-staged-mcp-main-return-type.md
- Direct command evidence captured by subagent:
  - `npx eslint apps/mcp-server/src/main.ts` -> error at 105:15 missing return type
  - line inspection of apps/mcp-server/src/main.ts confirms function expression at line 105
