---
title: Dependency automation
description: How ENGRAM keeps its dependencies current and turns published advisories into pull requests — Renovate policy, the vulnerability watch, and the supply-chain quarantine.
---

ENGRAM upgrades its dependencies automatically. Three pieces do the work:

| Piece                                                                    | Runs                           | Job                                                          |
| ------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------ |
| [Renovate](../../renovate.json5)                                         | Monday 07:00; security anytime | Opens (and mostly merges) upgrade PRs                        |
| [`vulnerability-watch`](../../.github/workflows/vulnerability-watch.yml) | Daily 06:23 UTC                | Tracks advisories Renovate **cannot** fix                    |
| `Dependency audit` (in [`ci.yml`](../../.github/workflows/ci.yml))       | Every PR                       | Fails on high/critical advisories in production dependencies |

`renovate.json5` is itself validated by a `Renovate config` CI job, because a
config error does not degrade gracefully — it aborts the entire Renovate run,
so _no_ upgrade PRs and _no_ security PRs get opened, with only a
config-warning issue as the signal.

## What merges by itself, and what does not

| Update                               | Automerge | Notes                                                              |
| ------------------------------------ | --------- | ------------------------------------------------------------------ |
| Patch / minor (≥ 1.0.0)              | ✅ yes    | Grouped into one PR                                                |
| Lint + type tooling (dev)            | ✅ yes    | Separate group so tooling churn stays out of the way               |
| Security fix (patch / minor)         | ✅ yes    | Opens immediately, skips the queue and the quarantine              |
| **0.x minor** (e.g. `0.219 → 0.220`) | ❌ no     | Below 1.0.0 a "minor" is a breaking change — see below             |
| Major                                | ❌ no     | One PR per major, labelled `major-upgrade`                         |
| Security fix that is a major         | ❌ no     | Inherits the major rule — a breaking change is never merged unseen |
| GitHub Actions (`uses:` bumps)       | ❌ no     | Edits CI files that hold `GITHUB_TOKEN`                            |
| Lockfile maintenance (monthly)       | ❌ no     | Re-resolves the whole tree; quarantine does not apply              |
| Node / pnpm / `@types/node`          | ❌ no     | CI runner versions must move with it                               |

### Two rules in `renovate.json5` that are easy to break

1. **`packageRules` apply in order and later rules win.** Every "never
   automerge this" rule must sit _after_ the grouping and automerge rules, or
   it is silently overridden. (The majors rule is deliberately below the
   ecosystem groups for exactly this reason.)
2. **A grouped PR automerges only if every member is automergeable.** So a
   rule that sets `automerge: false` must also set `groupName: null` —
   otherwise one non-automergeable package (`@types/node` publishes most
   weeks) quietly freezes automerge for the whole batch it lands in.

### 0.x is not "minor"

Roughly 43 dependency ranges here sit below 1.0.0, including the
`@opentelemetry/*` `0.219.x` experimental line. Renovate types `0.219 → 0.220`
as a minor, but semver promises nothing below 1.0.0, and this family's breaks
are runtime-only — they typecheck and then fail in production (see the note in
`pnpm-workspace.yaml` about a lone propagator bump silently breaking context
propagation). 0.x minors are therefore treated as breaking and reviewed.

## Automerge waits for _all_ checks, not just the required ones

Renovate performs its own merge (`platformAutomerge: false`) rather than
handing off to GitHub's native auto-merge. That is deliberate and stricter:
GitHub's auto-merge only waits for the **required** checks, and
`Dependency audit` is _not_ one of them — so a dependency PR could otherwise
land while introducing a fresh advisory. Renovate requires the whole branch
status to be green, so a red audit blocks the merge. Branch protection still
applies on top; Renovate merges through the API and GitHub rejects anything
that violates it.

**Consequence today:** there is a standing advisory backlog in `apps/web` and
`apps/docs`, so `Dependency audit` is red on every branch and nothing will
automerge until it is cleared. That is the gate working as intended, not a
misconfiguration — and once the backlog is fixed, automerge starts working with
no config change. Clearing it, then promoting `Dependency audit` to a required
status check, is the intended next step.

> Branch protection also requires **conversation resolution**, and the Copilot
> reviewer comments automatically. So "automerge" means _merges once nothing is
> outstanding_, not _merges unattended_.

## The supply-chain quarantine

Renovate will not propose a release younger than **3 days**, so a compromised
publish has time to be caught and yanked. Security fixes bypass it — once an
advisory is public the vulnerable version is already known, and waiting is
strictly worse.

Two real limits to understand:

- The gate filters **candidate releases during lookup**. It does not inspect
  transitively-resolved packages, and it does not apply to the monthly
  **lockfile maintenance** branch, which re-resolves the whole tree. That
  branch is never automerged for this reason.
- It is a _proposal-time_ gate, not an install-time one.

### On `minimumReleaseAge` in `pnpm-workspace.yaml`

pnpm supports the same idea at install time, and enabling it _would_ close the
transitive and lockfile-maintenance gaps above. It is currently **off**, and
turning it on is a deliberate trade-off rather than a free win:

pnpm enforces it by verifying **every lockfile entry** on
`pnpm install --frozen-lockfile`. Verified here: with a 3-day window,
`fast-uri@3.1.5` — pinned the previous day to close CVE-2026-16221 — failed
with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`, which fails that install step in
every CI job on every branch, not just the branch that introduced it. Recovering
means adding the package to `minimumReleaseAgeExclude` (the existing
`recharts@3.9.1` entry is the fossil of exactly this) or waiting out the window
with CI red.

Renovate does maintain `minimumReleaseAgeExclude` for its own vulnerability
PRs, so the two can be made to cooperate. If you enable it, budget for the
exclude list needing hand-maintenance whenever a fresh version is pinned
outside Renovate. The vestigial `minimumReleaseAgeExclude` key is inert while
`minimumReleaseAge` is unset.

## What Renovate does _not_ manage

**`overrides:` in `pnpm-workspace.yaml`.** Renovate's pnpm-workspace schema
reads only `packages`, the catalogs, and the `minimumReleaseAge*` keys — not
the overrides block. Those overrides are where this repo's CVE remediations
live (`undici <7`, `vite <8.1`, `fast-uri <4`, the `@opentelemetry/*` 2.x
family), each with a comment explaining what breaks without it.

So **raising an override floor for a new advisory is a human task.** Renovate
will not open that PR and will not list it on the dashboard. The
`vulnerability-watch` issue is where that work surfaces. The
`pinned-review-required` label still exists and fires for those packages when
they _also_ appear in a `package.json`, but do not rely on it as the only
signal.

`apps/marketing-site` is likewise ignored: it sits outside the pnpm workspace
and carries its own `package-lock.json`.

## Where to look

- **Dependency dashboard** — a permanent issue listing everything pending,
  rate-limited, or awaiting approval. The best single view of the queue.
- **`Security: unresolved dependency advisories`** — maintained by
  `vulnerability-watch`, holding what Renovate cannot fix. It is located by a
  hidden sentinel in the body, so retitling or relabelling it during triage is
  safe. It closes itself when the audit comes back clean, and is deliberately
  left untouched when the audit fails for infrastructure reasons.
- **GitHub Security tab** — vulnerability alerts are enabled; Dependabot's own
  PRs are intentionally off so they do not duplicate Renovate's.

## Rate limits

Renovate is capped at 5 open PRs and 2 new PRs per hour, so an advisory backlog
cannot arrive as dozens of simultaneous PRs. Raise the limits in
`renovate.json5` for a one-off catch-up, then put them back.
