import './telemetry';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { AppModule } from './app.module';
import { McpHandler } from '@engram/core';
import type { McpServerConfig } from '@engram/core';
import { coerceDeploymentProfile, resolveCapabilities } from '@engram/config';
import { ApiKeysController } from './api-keys/api-keys.controller';
import { MemoryController } from './memory/memory.controller';
import { MetricsService } from './metrics/metrics.service';
import {
  McpAuthMiddleware,
  type AuthedRequest,
} from './auth/mcp-auth.middleware';
import { McpRateLimitMiddleware } from './auth/mcp-rate-limit.middleware';
import { isAuthRequired } from './auth/auth.config';
import { unauthenticatedHttpRefusal } from './http-auth-posture';
import { helmetOptions } from './security/security-headers.util';

type ExpressMiddleware = (
  req: Request,
  res: Response,
  next: (err?: unknown) => void,
) => void;

type McpHandlerContract = {
  registerAdditionalTools: (
    tools: ReturnType<MemoryController['getMcpTools']>,
  ) => void;
  setAuthPolicy: (policy: { required: boolean }) => void;
  start: (options: McpServerConfig) => Promise<void>;
  createConfiguredServer: (options: McpServerConfig) => {
    connect: (t: StreamableHTTPServerTransport) => Promise<void>;
    close: () => Promise<void>;
  };
};

type ApiKeysControllerContract = {
  getMcpTools: () => ReturnType<ApiKeysController['getMcpTools']>;
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule.forRoot(), {
    bufferLogs: true,
    // Without this, Nest's exception zone calls process.exit(1) when a later
    // app.get() resolves a provider that the active profile didn't wire (e.g.
    // McpAuthMiddleware in profile-memory, McpRateLimitMiddleware when rate
    // limiting is off) — killing the process before tryGet's catch can run.
    abortOnError: false,
  });

  app.useLogger(app.get(Logger));

  app.use(helmet(helmetOptions));

  // CORS origin policy: an explicit allow-list from CORS_ALLOWED_ORIGINS
  // (comma-separated) when set; otherwise reflect any origin, preserving the
  // permissive local-dev default. Set the env var in any deployment that
  // publishes the port so a victim's browser cannot drive the server.
  const corsOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'mcp-session-id'],
    exposedHeaders: ['mcp-session-id'],
  });

  const logger = app.get(Logger);
  const mcpHandler = app.get<McpHandlerContract>(McpHandler);
  const memoryController = app.get<MemoryController>(MemoryController);
  const apiKeysController =
    app.get<ApiKeysControllerContract>(ApiKeysController);
  const metricsService = app.get<MetricsService>(MetricsService, {
    strict: false,
  });
  const mcpTransport = process.env.MCP_TRANSPORT ?? 'stdio';

  // Auth enforcement only applies over the HTTP transport (stdio is trusted
  // local). When enabled, non-public tools require an authenticated identity
  // and the acting userId is derived from the credential, not tool input.
  const authRequired = isAuthRequired() && mcpTransport === 'streamable-http';
  mcpHandler.setAuthPolicy({ required: authRequired });

  // Fail-safe against the most dangerous misconfiguration: an HTTP transport
  // serving every tenant unauthenticated. Applies in EVERY NODE_ENV (G1-T1) —
  // see unauthenticatedHttpRefusal for the rationale and conditions.
  const capabilities = resolveCapabilities(
    coerceDeploymentProfile(process.env.DEPLOYMENT_PROFILE),
  );
  const refusal = unauthenticatedHttpRefusal({
    multiTenant: capabilities.multiTenant,
    transport: mcpTransport,
    authRequired,
    allowUnauthenticatedHttp: process.env.ALLOW_UNAUTHENTICATED_HTTP,
  });
  if (refusal) {
    logger.error(refusal, 'Bootstrap');
    throw new Error(
      'Unauthenticated multi-tenant streamable-http requires explicit ALLOW_UNAUTHENTICATED_HTTP=true',
    );
  }

  // Resolve auth/rate-limit middleware if the active profile wired them.
  const tryGet = <T>(token: unknown): T | undefined => {
    try {
      return app.get<T>(token as never, { strict: false });
    } catch {
      return undefined;
    }
  };
  const authMiddleware = tryGet<McpAuthMiddleware>(McpAuthMiddleware);
  const rateLimitMiddleware = tryGet<McpRateLimitMiddleware>(
    McpRateLimitMiddleware,
  );
  if (authRequired && !authMiddleware) {
    logger.error(
      'AUTH_REQUIRED is set but no auth middleware is available for this profile — refusing to start unprotected.',
    );
    throw new Error('AUTH_REQUIRED but auth is not wired for this profile');
  }
  logger.log(
    `MCP auth: required=${authRequired} rateLimiting=${Boolean(rateLimitMiddleware)}`,
    'Bootstrap',
  );

  try {
    const memoryTools = memoryController.getMcpTools();
    const apiKeyTools = apiKeysController.getMcpTools();
    mcpHandler.registerAdditionalTools([...memoryTools, ...apiKeyTools]);

    const serverConfig: McpServerConfig = {
      name: 'engram',
      version: '0.1.0',
      capabilities: { tools: {} },
      instructions: 'ENGRAM - Extended Neural Graph for Recall and Memory',
    };

    if (mcpTransport === 'streamable-http') {
      const transports = new Map<string, StreamableHTTPServerTransport>();
      const expressApp = app
        .getHttpAdapter()
        .getInstance() as express.Application;
      const mcpJsonParser = express.json({ limit: '4mb' });

      // Auth + rate-limit run after JSON parsing (they inspect the body) and
      // before the MCP handler. Async rejections are converted to a 500 so they
      // never hang the request.
      const wrapAsync =
        (
          fn: (
            req: Request,
            res: Response,
            next: (err?: unknown) => void,
          ) => void | Promise<void>,
        ): ExpressMiddleware =>
        (req, res, next): void => {
          void Promise.resolve(fn(req, res, next)).catch((err: unknown) => {
            logger.error('Error in /mcp middleware:', err);
            if (!res.headersSent) {
              res.status(500).json({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal server error' },
                id: null,
              });
            }
          });
        };
      const mcpPreHandlers: ExpressMiddleware[] = [];
      if (authMiddleware) {
        mcpPreHandlers.push(wrapAsync(authMiddleware.handle));
      }
      if (rateLimitMiddleware) {
        mcpPreHandlers.push(wrapAsync(rateLimitMiddleware.handle));
      }

      const handleSessionRequest = async (
        req: Request,
        res: Response,
      ): Promise<void> => {
        // The auth middleware rejects invalid credentials and attaches
        // `req.auth` for valid ones, but it only rejects a *missing* credential
        // when it sees a protected tools/call in the parsed body. GET (stream)
        // and DELETE (teardown) have no body, so enforce identity explicitly
        // here: under AUTH_REQUIRED, an unauthenticated session request must be
        // rejected even though it carries a valid session id.
        if (authRequired && !(req as AuthedRequest).auth) {
          res
            .status(401)
            .set('WWW-Authenticate', 'Bearer realm="engram"')
            .json({
              jsonrpc: '2.0',
              error: {
                code: -32001,
                message: 'Unauthorized: authentication is required',
              },
              id: null,
            });
          return;
        }
        const sessionId = req.headers['mcp-session-id'];
        const transport =
          typeof sessionId === 'string' ? transports.get(sessionId) : undefined;
        if (!transport) {
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Invalid or missing session ID' },
            id: null,
          });
          return;
        }
        await transport.handleRequest(
          req as IncomingMessage & { auth?: unknown },
          res as ServerResponse,
        );
      };

      expressApp.post(
        '/mcp',
        mcpJsonParser,
        ...mcpPreHandlers,
        async (req: Request, res: Response) => {
          try {
            const sessionId = req.headers['mcp-session-id'];
            let transport: StreamableHTTPServerTransport | undefined =
              typeof sessionId === 'string'
                ? transports.get(sessionId)
                : undefined;

            if (!transport) {
              if (!isInitializeRequest(req.body)) {
                // Never interpolate the raw body: it carries memory content
                // (PII) and any token/apiKey a client placed in params, and
                // pino's field-path redaction cannot reach a string already
                // built here. Log only the non-sensitive JSON-RPC envelope.
                const body = req.body as { method?: unknown; id?: unknown };
                logger.warn(
                  `Rejecting POST /mcp without session: method=${typeof body?.method === 'string' ? body.method : 'unknown'} content-type=${req.headers['content-type'] ?? 'none'} has-session-header=${Boolean(req.headers['mcp-session-id'])}`,
                );
                res.status(400).json({
                  jsonrpc: '2.0',
                  error: {
                    code: -32000,
                    message:
                      'Bad Request: No valid session ID provided for non-initialize request',
                  },
                  id: null,
                });
                return;
              }

              transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: (): string => randomUUID(),
                enableJsonResponse: true,
                onsessioninitialized: (sid: string): void => {
                  transports.set(sid, transport!);
                  metricsService?.activeMcpSessions.inc();
                  logger.log(`MCP session initialized: ${sid}`, 'McpSession');
                },
              });

              transport.onclose = (): void => {
                const sid = transport!.sessionId;
                if (sid && transports.delete(sid)) {
                  metricsService?.activeMcpSessions.dec();
                  logger.log(`MCP session closed: ${sid}`, 'McpSession');
                }
              };

              const server = mcpHandler.createConfiguredServer(serverConfig);
              await server.connect(transport);
            }

            await transport.handleRequest(
              req as IncomingMessage & { auth?: unknown },
              res as ServerResponse,
              req.body,
            );
          } catch (error) {
            logger.error(
              'Failed to handle Streamable HTTP MCP request:',
              error,
            );
            if (!res.headersSent) {
              res.status(500).json({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal server error' },
                id: null,
              });
            }
          }
        },
      );

      // Meter session GET (stream)/DELETE (teardown) too, so a holder of a
      // valid session id cannot churn sessions without rate limiting.
      expressApp.get('/mcp', ...mcpPreHandlers, handleSessionRequest);
      expressApp.delete('/mcp', ...mcpPreHandlers, handleSessionRequest);
    } else {
      await mcpHandler.start(serverConfig);
    }
  } catch (error) {
    logger.error('Failed to start MCP handler:', error);
  }

  // Run NestJS lifecycle hooks (Redis/Prisma disconnect, metrics registry
  // clear, MCP transport close, scheduler interval cleanup) on SIGTERM/SIGINT
  // and drain in-flight requests instead of dropping them. enableShutdownHooks
  // wires the signal handling itself; we deliberately avoid a manual handler
  // with process.exit() so it does not race the OTel SDK's async flush
  // (registered in telemetry.ts) or mask a non-zero close failure.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  // Honor HOST so the documented loopback bind (HOST=127.0.0.1, WP5 D1/D6) is
  // actually enforced; default to all-interfaces to keep the container path unchanged.
  await app.listen(port, process.env.HOST ?? '0.0.0.0');

  logger.log(
    `Application is running on: http://localhost:${port} [transport: ${mcpTransport}]`,
    'Bootstrap',
  );
}
void bootstrap();
