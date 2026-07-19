---
title: STATE — Architecture Simplification
description: Work-package status index for the Redis/Qdrant removal and two-profile ladder
---

# STATE — Architecture Simplification

Read PLAN.md first. Update this file in every WP PR.

| WP  | Branch                    | Status      | PR  | Notes                                                       |
| --- | ------------------------- | ----------- | --- | ----------------------------------------------------------- |
| WP1 | feat/stm-postgres-adapter | in progress | —   | Postgres STM adapter + sweep + dead embedding-cache removal |
| WP2 | feat/postgres-auth-stores | pending     | —   | KvEntry + RateLimitCounter + ReindexJob models              |
| WP3 | feat/remove-qdrant        | pending     | —   | pgvector only                                               |
| WP4 | feat/two-profile-ladder   | pending     | —   | lite/standard; delete packages/redis                        |
| WP5 | (local deployment)        | pending     | —   | reindex reusing embeddings; verify recall                   |

## Landed decisions

- 2026-07-19: profile names `lite` + `standard` (default). Redis+Qdrant
  removed from all profiles. Embedding cache deleted (was inert — DI bug).
- 2026-07-19: Ollama context-length rejections degrade to a truncated-prefix
  embedding (provider retries at 1/2 then 1/4 of the text) — long memories
  were previously silently unindexable with nomic-embed-text's 2048-token
  GGUF context.
