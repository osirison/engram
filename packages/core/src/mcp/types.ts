/**
 * MCP Protocol Types
 * Type definitions for Model Context Protocol integration
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  Request,
  Notification,
  Result,
  Implementation,
  ServerCapabilities,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP Server configuration options
 */
export interface McpServerConfig {
  name: string;
  version: string;
  capabilities?: ServerCapabilities;
  instructions?: string;
}

/**
 * Type alias for the MCP Server instance
 */
export type McpServer = Server<Request, Notification, Result>;

/**
 * Server information type
 */
export type ServerInfo = Implementation;
