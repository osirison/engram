import { Injectable, Logger } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import type { AuthIdentity } from '@engram/auth';
import { AuthResolver } from './auth-resolver.service';

/** Tools callable without authentication even when enforcement is on. */
const PUBLIC_TOOLS = new Set(['ping']);

/**
 * The auth info attached to the request. The MCP streamable-http transport
 * forwards `req.auth` to tool handlers as `extra.authInfo`; the dispatch layer
 * reads `extra.userId` to derive the acting tenant.
 */
export interface McpAuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  extra: {
    userId: string;
    organizationId: string | null;
    email: string | null;
    method: AuthIdentity['method'];
    apiKeyId: string | null;
  };
}

export type AuthedRequest = Request & { auth?: McpAuthInfo };

function toAuthInfo(identity: AuthIdentity): McpAuthInfo {
  return {
    // Never the raw credential — just a non-sensitive method marker.
    token: identity.method,
    clientId: identity.userId,
    scopes: identity.scopes,
    extra: {
      userId: identity.userId,
      organizationId: identity.organizationId,
      email: identity.email,
      method: identity.method,
      apiKeyId: identity.apiKeyId,
    },
  };
}

/** Extract the names of every `tools/call` in a JSON-RPC body (single or batch). */
export function toolCallNames(body: unknown): string[] {
  const entries = Array.isArray(body) ? body : [body];
  const names: string[] = [];
  for (const entry of entries) {
    if (
      entry &&
      typeof entry === 'object' &&
      (entry as { method?: unknown }).method === 'tools/call'
    ) {
      const name = (entry as { params?: { name?: unknown } }).params?.name;
      if (typeof name === 'string') names.push(name);
    }
  }
  return names;
}

function jsonRpcError(res: Response, status: number, message: string): void {
  res
    .status(status)
    .set('WWW-Authenticate', 'Bearer realm="engram"')
    .json({
      jsonrpc: '2.0',
      error: { code: -32001, message },
      id: null,
    });
}

/**
 * Express middleware for `/mcp`. Authenticates the request (JWT or API key) and
 * attaches `req.auth`; when `AUTH_REQUIRED` is on, rejects `tools/call`s to
 * protected tools that carry no valid identity with a 401. A credential that is
 * present but invalid is always rejected, regardless of enforcement.
 */
@Injectable()
export class McpAuthMiddleware {
  private readonly logger = new Logger(McpAuthMiddleware.name);

  constructor(
    private readonly resolver: AuthResolver,
    private readonly authRequired: boolean,
  ) {}

  handle = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const outcome = await this.resolver.authenticate(req.headers);

    if (outcome.status === 'invalid') {
      this.logger.warn(`auth_rejected reason=${outcome.reason}`);
      jsonRpcError(res, 401, `Unauthorized: ${outcome.reason}`);
      return;
    }

    if (outcome.status === 'authenticated') {
      (req as AuthedRequest).auth = toAuthInfo(outcome.identity);
    }

    if (this.authRequired && outcome.status !== 'authenticated') {
      const protectedCall = toolCallNames(req.body).some(
        (name) => !PUBLIC_TOOLS.has(name),
      );
      if (protectedCall) {
        jsonRpcError(res, 401, 'Unauthorized: authentication is required');
        return;
      }
    }

    next();
  };
}
