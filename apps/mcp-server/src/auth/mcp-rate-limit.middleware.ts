import { Injectable } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import {
  RateLimitService,
  type RateLimitResult,
  type RateLimitStore,
} from '@engram/auth';
import type { RateLimitConfig } from './auth.config';
import { toolCallNames, type AuthedRequest } from './mcp-auth.middleware';

function clientIp(req: Request): string {
  // req.ip is the direct TCP peer unless Express `trust proxy` is configured.
  // Behind a reverse proxy, configure trust proxy at the edge so per-IP limits
  // apply per client; the authenticated per-user/key buckets are the primary
  // control and are unaffected.
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

function jsonRpcId(body: unknown): unknown {
  if (
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    'id' in body
  ) {
    return (body as { id?: unknown }).id ?? null;
  }
  return null;
}

/**
 * Express middleware for `/mcp` applying Redis-backed fixed-window rate limits.
 * Authenticated requests are metered per-user (and per-org when applicable);
 * unauthenticated requests are metered per client IP. Per-tool overrides apply
 * to the user/IP bucket. Exceeding any applicable bucket yields a 429 with
 * `Retry-After`; every response carries `X-RateLimit-*` headers.
 */
@Injectable()
export class McpRateLimitMiddleware {
  private readonly userLimiter: RateLimitService;
  private readonly ipLimiter: RateLimitService;
  private readonly orgLimiter: RateLimitService;

  constructor(store: RateLimitStore, config: RateLimitConfig) {
    const windowSeconds = config.windowSeconds;
    this.userLimiter = new RateLimitService(store, {
      defaultRule: { limit: config.userRpm, windowSeconds },
      toolOverrides: config.toolOverrides,
    });
    this.ipLimiter = new RateLimitService(store, {
      defaultRule: { limit: config.ipRpm, windowSeconds },
      toolOverrides: config.toolOverrides,
    });
    this.orgLimiter = new RateLimitService(store, {
      defaultRule: { limit: config.orgRpm, windowSeconds },
    });
  }

  handle = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const auth = (req as AuthedRequest).auth;
    // Meter EVERY tool call in the request — a JSON-RPC batch executes all of
    // its tools/call entries, so charging only the first would let a single
    // batched request bypass the limit. Requests with no tools/call (e.g.
    // initialize) are charged once against the default bucket.
    const names = toolCallNames(req.body);
    const calls: Array<string | undefined> =
      names.length > 0 ? names : [undefined];

    // Meter per-key for API keys (independent budget per key) and per-user for
    // interactive JWT sessions — satisfying #132's "per tenant/key".
    const principalKey = auth?.extra.apiKeyId
      ? `key:${auth.extra.apiKeyId}`
      : `user:${auth?.extra.userId}`;

    const results: RateLimitResult[] = [];
    for (const tool of calls) {
      if (auth) {
        results.push(
          await this.userLimiter.consume({ key: principalKey, tool }),
        );
        if (auth.extra.organizationId) {
          results.push(
            await this.orgLimiter.consume({
              key: `org:${auth.extra.organizationId}`,
            }),
          );
        }
      } else {
        results.push(
          await this.ipLimiter.consume({ key: `ip:${clientIp(req)}`, tool }),
        );
      }
    }

    // Report headers from the tightest applicable bucket.
    const tightest = results.reduce((a, b) =>
      b.remaining < a.remaining ? b : a,
    );
    res.set('X-RateLimit-Limit', String(tightest.limit));
    res.set('X-RateLimit-Remaining', String(tightest.remaining));
    res.set('X-RateLimit-Reset', String(tightest.resetSeconds));

    const blocked = results.find((r) => !r.allowed);
    if (blocked) {
      res
        .set('Retry-After', String(blocked.retryAfterSeconds))
        .status(429)
        .json({
          jsonrpc: '2.0',
          error: {
            code: -32002,
            message: 'Rate limit exceeded',
            data: { retryAfterSeconds: blocked.retryAfterSeconds },
          },
          id: jsonRpcId(req.body),
        });
      return;
    }

    next();
  };
}
