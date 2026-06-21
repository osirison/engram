import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import express, { type Request, type Response } from 'express';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { AppModule } from './app.module';
import { McpHandler } from '@engram/core';
import type { McpServerConfig } from '@engram/core';
import { ApiKeysController } from './api-keys/api-keys.controller';
import { MemoryController } from './memory/memory.controller';

type McpHandlerContract = {
  registerAdditionalTools: (
    tools: ReturnType<MemoryController['getMcpTools']>,
  ) => void;
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
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));

  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'mcp-session-id'],
    exposedHeaders: ['mcp-session-id'],
  });

  const logger = app.get(Logger);
  const mcpHandler = app.get<McpHandlerContract>(McpHandler);
  const memoryController = app.get<MemoryController>(MemoryController);
  const apiKeysController =
    app.get<ApiKeysControllerContract>(ApiKeysController);
  const mcpTransport = process.env.MCP_TRANSPORT ?? 'stdio';

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

      const handleSessionRequest = async (
        req: Request,
        res: Response,
      ): Promise<void> => {
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
        async (req: Request, res: Response) => {
          try {
            const sessionId = req.headers['mcp-session-id'];
            let transport: StreamableHTTPServerTransport | undefined =
              typeof sessionId === 'string'
                ? transports.get(sessionId)
                : undefined;

            if (!transport) {
              if (!isInitializeRequest(req.body)) {
                logger.warn(
                  `Rejecting POST /mcp without session: body=${JSON.stringify(req.body)?.slice(0, 300)} headers=${JSON.stringify(
                    {
                      'content-type': req.headers['content-type'],
                      accept: req.headers.accept,
                      'mcp-session-id': req.headers['mcp-session-id'],
                    },
                  )}`,
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
                  logger.log(`MCP session initialized: ${sid}`, 'McpSession');
                },
              });

              transport.onclose = (): void => {
                const sid = transport!.sessionId;
                if (sid && transports.delete(sid)) {
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

      expressApp.get('/mcp', handleSessionRequest);
      expressApp.delete('/mcp', handleSessionRequest);
    } else {
      await mcpHandler.start(serverConfig);
    }
  } catch (error) {
    logger.error('Failed to start MCP handler:', error);
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  logger.log(
    `Application is running on: http://localhost:${port} [transport: ${mcpTransport}]`,
    'Bootstrap',
  );
}
void bootstrap();
