<!--
Sync Impact Report
- Version change: template placeholders -> 1.0.0
- Modified principles:
	- Template Principle 1 -> I. Branch and Scope Discipline
	- Template Principle 2 -> II. Type Safety and Reuse
	- Template Principle 3 -> III. Framework-First Implementation
	- Template Principle 4 -> IV. Test and Quality Gates
	- Template Principle 5 -> V. Security and Secrets Hygiene
- Added sections:
	- Delivery Standards
	- Workflow and Review
- Removed sections:
	- None
- Templates requiring updates:
	- ✅ .specify/templates/plan-template.md
	- ✅ .specify/templates/spec-template.md
	- ✅ .specify/templates/tasks-template.md
	- ✅ .specify/templates/commands/*.md (directory not present; no updates needed)
- Runtime guidance reviewed:
	- ✅ README.md (aligned)
	- ✅ docs/SETUP.md (aligned)
	- ✅ AGENTS.md (aligned)
- Follow-up TODOs:
	- None
-->

# ENGRAM Constitution

## Core Principles

### I. Branch and Scope Discipline

All work MUST happen on a feature branch, never directly on main. Changes MUST
stay tightly scoped to the active request, and unrelated refactors MUST be
deferred unless they block delivery. Rationale: small, isolated changes reduce
review risk and speed up safe integration.

### II. Type Safety and Reuse

Code MUST preserve strict TypeScript behavior and MUST NOT introduce any unless
a clear, documented justification exists. Contributors MUST prefer existing
workspace packages, modules, and patterns over new abstractions. Rationale:
type safety and reuse reduce regression risk and maintenance burden.

### III. Framework-First Implementation

Runtime behavior in the server MUST follow NestJS architecture (modules,
controllers, services, providers, and dependency injection). Persistent data
access MUST use Prisma, and shared capabilities MUST remain within the existing
package boundaries under packages/\*. Rationale: consistent architecture keeps
the monorepo predictable and easier to evolve.

### IV. Test and Quality Gates

Any behavior change MUST include updated or new automated tests at the right
layer. Before merge, contributors MUST run quality checks relevant to changed
areas (build, lint, typecheck, and tests) and address failures. Rationale:
changes are only trustworthy when validated continuously.

### V. Security and Secrets Hygiene

Secrets, local env files, and credentials MUST NOT be committed. Logs and
telemetry MUST avoid secret disclosure, and security-sensitive behavior MUST use
existing vetted packages over bespoke alternatives where possible. Rationale:
ENGRAM is production-critical infrastructure and requires a secure default
posture.

## Delivery Standards

Contributors MUST keep documentation concise, current, and linked from the root
README when startup commands or entry points change.

Work products SHOULD prefer clarity over novelty and MUST remain compatible with
the monorepo toolchain and package boundaries already in use.

## Workflow and Review

Pull requests MUST target main from a feature branch and SHOULD use
conventional commit style for commit messages.

Reviewers MUST verify constitution compliance explicitly: scope control, strict
typing, framework alignment, test coverage for behavior changes, and secret
hygiene.

## Governance

This constitution supersedes conflicting local conventions for planning and
implementation artifacts under .specify.

Amendments MUST be proposed in writing, include rationale and downstream impact,
and update affected templates in the same change when practical.

Versioning policy is semantic:

- MAJOR for incompatible governance changes or principle removals/redefinitions.
- MINOR for new principles/sections or materially expanded requirements.
- PATCH for clarifications, wording improvements, or non-semantic refinements.

Compliance review is required at plan approval, task generation, and pull
request review.

**Version**: 1.0.0 | **Ratified**: 2026-05-25 | **Last Amended**: 2026-05-25
