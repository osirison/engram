/**
 * MCP Module
 * NestJS module for Model Context Protocol integration
 */

import { Module } from '@nestjs/common';
import { McpHandler } from './mcp.handler.js';

/**
 * MCP Module
 * Provides MCP protocol handler for integration with MCP clients
 */
@Module({
  providers: [McpHandler],
  exports: [McpHandler],
})
export class McpModule {}
