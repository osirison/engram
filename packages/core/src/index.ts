/**
 * ENGRAM Core Package
 * Core utilities and types for the ENGRAM memory system
 */

export const VERSION = '0.1.0';

export function getVersion(): string {
  return VERSION;
}

// Logging
export { LoggingModule } from './logging/logging.module';

// MCP Protocol
export { McpModule } from './mcp/mcp.module';
export { McpHandler } from './mcp/mcp.handler';
export type { McpServerConfig, McpServer, ServerInfo } from './mcp/types';
export { registerTools, type Tool } from './mcp/tools/index';
export { pingTool } from './mcp/tools/ping.tool';
