<!-- markdownlint-disable-file -->

# Planning Log: ENGRAM Profile Ladder for Accessible Enterprise Scale

## Discrepancy Log

Gaps and differences identified between research findings and the implementation plan.

### Unaddressed Research Items

- DR-01: Exact durable-local storage backend choice (SQLite adapter vs file-backed store)
  - Source: engram-lightweight-scalable-architecture-research.md (Potential Next Research)
  - Reason: Deferred to architecture review phase to validate Prisma SQLite adapter feasibility
  - Impact: Medium — affects schema design and migration tooling; plan assumes SQLite but can adapt
  - Mitigation: Architecture spike recommended in Phase 0 or early Phase 3

- DR-02: Detailed encryption implementation (key source priority, key rotation, backup/restore)
  - Source: local-persistence-threat-model-research.md (Clarifying questions)
  - Reason: Deferred to security review phase for KMS/keychain integration strategy
  - Impact: Medium — affects local persistence security posture
  - Mitigation: Default to environment-based key source first, OS keychain second; rotation deferred to v1.1

- DR-03: Per-tenant auth binding for MCP tools
  - Source: local-persistence-threat-model-research.md (Clarifying questions)
  - Reason: Plan assumes single-tenant local mode; multi-tenant binding deferred to enterprise phase
  - Impact: Low for v0.3; medium for multi-tenant roadmap
  - Mitigation: Profile-lite ships with warnings about single-tenant assumption; multi-tenant auth is v1.0+

- DR-04: GA scale envelope (tenant count, corpus size, query rate targets)
  - Source: accessibility-scale-path-research.md (Potential Next Research)
  - Reason: Not yet defined; affects performance testing matrix and release gates
  - Impact: Medium — drives test infrastructure and load-test envelopes
  - Mitigation: Recommend sizing decision in sprint planning; start with conservative profile-lite limits

### Plan Deviations from Research

- DD-01: Profile naming convention
  - Research recommends: profile-memory, profile-lite, profile-enterprise
  - Plan implements: DEPLOYMENT_PROFILE enum values 'memory', 'lite', 'enterprise'
  - Rationale: Shorter env value names reduce verbosity and match existing pattern (VECTOR_BACKEND=qdrant)

- DD-02: Eager vs lazy Prisma/Redis startup for profile-lite
  - Research recommends: lazy connect when profile-lite is active
  - Plan implements: lazy connect with explicit error if DB operations attempted before first use
  - Rationale: Safer error handling; prevents subtle failures if migration is interrupted

- DD-03: Dual-write implementation timing
  - Research recommends: add during migration window only (Phase 4)
  - Plan implements: Phase 4 (no change to Phase 1-3)
  - Rationale: No deviation; dual-write is already Phase 4 per research

## Implementation Paths Considered

### Selected: Three-Profile Ladder with Mandatory Hybrid Retrieval

- Approach: Implement profile-memory (zero dependencies), profile-lite (secure local), profile-enterprise (unchanged) with intelligent hybrid retrieval in all non-enterprise profiles
- Rationale:
  - Solves immediate onboarding friction (profile-memory is instant)
  - Adds practical local durability rung (profile-lite)
  - Preserves operational continuity (profile-enterprise unchanged)
  - Guarantees retrieval quality in lightweight modes
- Evidence:
  - accessibility-scale-path-research.md (profile ladder strategy)
  - intelligent-retrieval-research.md (hybrid retrieval in memory/lite)
  - migration-slo-research.md (promotion design)
- Effort estimate: 5-7 sprints for MVP (Phase 1-3), +2 sprints for migration/release (Phase 4-5)

### IP-01: In-Memory Only Forever (Rejected as Primary)

- Approach: Single profile-only mode with no persistence, no upgrade path
- Trade-offs:
  - Pros: simplest implementation, lowest latency, zero infra overhead
  - Cons: no durability for real workloads, weak adoption path for teams
- Rejection rationale: Does not meet "accessible yet scalable" requirement; teams would abandon after data loss
- Evidence: architecture-alternatives-research.md

### IP-02: External Services Optional (Rejected as Primary)

- Approach: Keep current enterprise-first startup, add feature flags to skip dependencies if unused
- Trade-offs:
  - Pros: minimal code changes, no refactoring
  - Cons: setup friction remains (still requires env URLs even if unused)
- Rejection rationale: Does not solve the immediate problem (required env vars block lightweight startup)
- Evidence: runtime-dependencies-research.md

### IP-03: Blue-Green Replay Queue for Migration (Rejected for Phase 1)

- Approach: Build new enterprise environment in parallel, replay writes from profile-lite
- Trade-offs:
  - Pros: best isolation, low blast radius for rollback
  - Cons: high implementation complexity, requires event-replay infrastructure
- Rejection rationale: Overkill for first release; dual-write + staged backfill is simpler and good enough
- Evidence: migration-slo-research.md
- Status: Deferred to v1.1 for larger-scale operations

## Suggested Follow-On Work

### WI-01: Architecture Spike for Durable-Local Backend

Title: Validate SQLite adapter feasibility for profile-lite storage
Priority: High (must complete before Phase 3 implementation)
Scope: 1 sprint
Details:

- Test Prisma SQLite adapter with existing Memory schema
- Benchmark SQLite read/write performance at 50k records
- Evaluate schema adaptation needed for SQLite constraints
- Document fallback: file-backed JSON store if SQLite proves unsuitable
  Reference: Potential Next Research item DR-01

### WI-02: Security Audit and Key Management Design

Title: Define encryption implementation and key source strategy for profile-lite
Priority: Medium (Phase 3 blocker)
Scope: 1-2 sprints
Details:

- Select encryption library (libsodium, TweetNaCl, node-crypto + NIST curve)
- Define key source priority (env > OS keychain > interactive prompt)
- Design key rotation/versioning for future compliance
- Document break-glass plaintext mode security model
  Reference: Potential Next Research item DR-02, local-persistence-threat-model-research.md

### WI-03: GA Scale Envelope Definition

Title: Define performance and reliability targets per profile
Priority: Medium (Phase 5 blocker for release gates)
Scope: 1 sprint
Details:

- Set tenant count, corpus size, retrieval QPS targets by profile
- Size test infrastructure and load-gen workloads
- Define SLO thresholds for latency/availability per profile
- Document scale-out and degradation behavior
  Reference: Potential Next Research item DR-04, accessibility-scale-path-research.md

### WI-04: Multi-Tenant Auth Design (Deferred to v1.0)

Title: Add proper auth principal binding for multi-tenant enterprise deployments
Priority: Low (v1.0+)
Scope: 2-3 sprints
Details:

- Design auth principal extraction from MCP transport
- Implement tenant-scoped tool execution
- Add role-based access control (RBAC) for admin tools
- Test cross-tenant isolation
  Reference: Potential Next Research item DR-03, local-persistence-threat-model-research.md

### WI-05: Lexical-Semantic Ranking Tuning

Title: Benchmark and tune hybrid rank fusion scoring for recall quality
Priority: Medium (post-MVP, Phase 3 validation)
Scope: 1-2 sprints
Details:

- Run eval harness on profile-memory and profile-lite with standard corpus
- Compare ranking quality vs profile-enterprise
- Tune RRF weights and fallback heuristics
- Document quality trade-offs per profile
  Reference: intelligent-retrieval-research.md, packages/eval/src/retrievers/fusion-retriever.ts

### WI-06: Blue-Green Migration for Enterprise Scale (v1.1+)

Title: Implement replay-queue migration for large-scale profile-lite → enterprise promotions
Priority: Low (post-MVP, optional for v1.1)
Scope: 3-4 sprints
Details:

- Design event capture and replay from profile-lite
- Implement blue-green environment bootstrap
- Add shadow-read validation and cutover automation
- Test with 1M+ record corpus
  Reference: migration-slo-research.md (Alternative C)

## Clarifying Questions Answered

### Q: Should durable-local encryption-at-rest be mandatory in launch scope, or acceptable as gated follow-up?

**Answer**: Mandatory in launch scope with explicit LOCAL_INSECURE_MODE break-glass for local dev.

- Strict-by-default aligns with banking-grade security posture (user preference from memory)
- Break-glass allows dev velocity without permanently weakening default behavior
- Deferred KMS/keychain integration to v1.1 (see WI-02)

### Q: Should zero profile default to lexical-only recall first, or semantic recall with local embeddings enabled by default?

**Answer**: Hybrid semantic + lexical by default in all profiles, including profile-memory.

- User requirement: "AGE OF THE IMPOSSIBLE" — intelligent retrieval mandatory
- Local embeddings provider is deterministic (no API key required), so default is safe
- Lexical-only is fallback when embeddings unavailable, not the product default

### Q: For v1.0 onboarding, should default profile remain enterprise, or shift to durable-local for developer-first experience?

**Answer**: Keep profile-enterprise as default; shift to profile-memory in README as recommended first choice.

- Backward compatibility: existing users and CI/CD benefit from enterprise default
- Discoverability: README "Choose Your Profile" section makes profile-memory immediately visible
- Backward breaking change risk is mitigated by opt-in profile env var

### Q: What is the expected enterprise GA scale tier for definition?

**Answer**: Deferred to WI-03 (GA Scale Envelope Definition).

- Recommendation: start conservatively (1k tenant, 1M memory corpus, 100 QPS)
- Scale up empirically after MVP GA release
- Prevents over-engineering before user feedback

## Status and Readiness

**Overall Status**: Ready for implementation planning → task-implement handoff

**Readiness Assessment**:

- Research: Complete and consolidated
- Plan: Comprehensive with staged phases and success criteria
- Risks: Low architectural risk; standard integration of existing patterns
- Dependencies: All external (team capacity, architecture approvals on WI-01, WI-02)

**Recommended Next Steps**:

1. Conduct architecture spike for SQLite backend (WI-01) in parallel with planning
2. Conduct security design review and key management design (WI-02) in parallel
3. Approve release gates and GA scale envelope (WI-03)
4. Begin Phase 1 implementation after approvals

**Blockers**: None identified; all architectural decisions resolved in research phase.

**Handoff Readiness**: Ready to transition to `/task-implement` prompt for code execution.
