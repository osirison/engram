import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { McpHandler } from '@engram/core';

async function bootstrap() {
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

  // Initialize MCP handler
  const mcpHandler = app.get(McpHandler);
  try {
    await mcpHandler.start({
      name: 'engram',
      version: '0.1.0',
      capabilities: {
        tools: {},
      },
      instructions: 'ENGRAM - Extended Neural Graph for Recall and Memory',
    });
    logger.log('MCP protocol handler started successfully', 'Bootstrap');
  } catch (error) {
    logger.error('Failed to start MCP handler:', error);
  }
}
void bootstrap();
