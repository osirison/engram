---
title: ENGRAM Auth Package
description: Authentication & authorization primitives (HS256 JWT, OAuth, sessions, rate limiting) for ENGRAM
---

# @engram/auth

Authentication & authorization primitives for ENGRAM. Framework-agnostic plain
classes — the NestJS wiring, Redis adapters, and HTTP controller live in the
host app (`apps/mcp-server/src/auth`).

## What's here

| Building block                                | Responsibility                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| `JwtService`                                  | Issue/verify HS256 JWTs (`node:crypto`, no external deps).                    |
| `OAuthService`                                | Registry of configured OAuth providers.                                       |
| `GitHubOAuthProvider` / `GoogleOAuthProvider` | Authorization-URL build + code→profile exchange.                              |
| `SessionService`                              | Redis-backed sessions + one-time OAuth `state` (CSRF), over a `SessionStore`. |
| `RateLimitService`                            | Fixed-window per-identity / per-tool limiter, over a `RateLimitStore`.        |

## Design notes

- **JWT is hand-rolled HS256 on `node:crypto`** rather than `jose` (ESM-only,
  incompatible with this package's CommonJS emit) or `jsonwebtoken` (extra dep).
  Verification never reads the algorithm from the token to choose a strategy —
  it always computes an HMAC-SHA256 and compares in constant time — so it is
  structurally immune to algorithm-confusion (`none`/`RS256`) attacks.
- **Stores are interfaces.** `SessionStore` and `RateLimitStore` are implemented
  by the host (Redis in enterprise); the package ships only the logic, so unit
  tests run with in-memory fakes and no external services.
- **OAuth HTTP is injected** (`OAuthHttpClient`) so token exchange and profile
  fetches are mockable without network access. `FetchOAuthHttpClient` is the
  default platform-`fetch` implementation.

## Testing

```bash
pnpm --filter @engram/auth test
```
