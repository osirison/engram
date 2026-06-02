import { IncomingMessage, ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js';
import { AppModule } from './app.module';
import { McpHandler } from '@engram/core';
import { MemoryController } from './memory/memory.controller';

type McpHandlerContract = {
  registerAdditionalTools: (
    tools: ReturnType<MemoryController['getMcpTools']>,
  ) => void;
  start: (
    options: {
      name: string;
      version: string;
      capabilities: { tools: Record<string, never> };
      instructions: string;
    },
    transport?: StreamableHTTPServerTransport,
  ) => Promise<void>;
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Use Pino logger
  app.useLogger(app.get(Logger));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  // Log startup message
  const logger = app.get(Logger);
  logger.log(
    `Application is running on: http://localhost:${port}`,
    'Bootstrap',
  );

  // Initialize MCP handler with memory tools
  const mcpHandler = app.get<McpHandlerContract>(McpHandler);
  const memoryController = app.get<MemoryController>(MemoryController);
  const mcpTransport = process.env.MCP_TRANSPORT ?? 'stdio';

  try {
    // Register memory tools before initializing MCP server
    const memoryTools = memoryController.getMcpTools();
    mcpHandler.registerAdditionalTools(memoryTools);
    logger.log(
      `Registered ${memoryTools.length} memory tools with MCP handler`,
      'Bootstrap',
    );

    const serverConfig = {
      name: 'engram',
      version: '0.1.0',
      capabilities: {
        tools: {},
      },
      instructions: 'ENGRAM - Extended Neural Graph for Recall and Memory',
    };

    if (mcpTransport === 'streamable-http') {
      const streamableHttpTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await mcpHandler.start(serverConfig, streamableHttpTransport);

      const expressApp = app.getHttpAdapter().getInstance();
      expressApp.post('/mcp', async (req, res) => {
        try {
          await streamableHttpTransport.handleRequest(
            req as IncomingMessage & { auth?: unknown },
            res as ServerResponse,
            req.body,
          );
        } catch (error) {
          logger.error('Failed to handle Streamable HTTP MCP request:', error);

          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: '2.0',
              error: {
                code: -32603,
                message: 'Internal server error',
              },
              id: null,
            });
          }
        }
      });
      expressApp.get('/mcp', (_req, res) => {
        res.status(405).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Method not allowed.',
          },
          id: null,
        });
      });
      expressApp.delete('/mcp', (_req, res) => {
        res.status(405).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Method not allowed.',
          },
          id: null,
        });
      });

      logger.log(
        'MCP protocol handler started in Streamable HTTP mode',
        'Bootstrap',
      );
    } else {
      await mcpHandler.start(serverConfig);
      logger.log('MCP protocol handler started in stdio mode', 'Bootstrap');
    }
  } catch (error) {
    logger.error('Failed to start MCP handler:', error);
  }
}
void bootstrap();
