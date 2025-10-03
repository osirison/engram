/**
 * MCP Protocol Handler
 * Handles Model Context Protocol server initialization and lifecycle
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServerConfig, McpServer } from './types.js';

/**
 * MCP Protocol Handler
 * Manages the MCP server instance and transport layer
 */
@Injectable()
export class McpHandler implements OnModuleDestroy {
  private readonly logger = new Logger(McpHandler.name);
  private server: McpServer | null = null;
  private transport: StdioServerTransport | null = null;
  private isConnected = false;

  /**
   * Initialize the MCP server with configuration
   */
  async initialize(config: McpServerConfig): Promise<void> {
    this.logger.log('Initializing MCP server...');

    try {
      // Create MCP server instance
      this.server = new Server(
        {
          name: config.name,
          version: config.version,
        },
        {
          capabilities: config.capabilities || {
            tools: {},
          },
          instructions: config.instructions,
        },
      );

      this.logger.log(
        `MCP server created: ${config.name} v${config.version}`,
      );

      // Set up error handler
      this.server.onerror = (error) => {
        this.logger.error('MCP server error:', error);
      };

      // Set up close handler
      this.server.onclose = () => {
        this.logger.log('MCP server connection closed');
        this.isConnected = false;
      };

      this.logger.log('MCP server initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize MCP server:', error);
      throw error;
    }
  }

  /**
   * Connect the MCP server to stdio transport
   */
  async connect(): Promise<void> {
    if (!this.server) {
      throw new Error('MCP server not initialized. Call initialize() first.');
    }

    if (this.isConnected) {
      this.logger.warn('MCP server already connected');
      return;
    }

    try {
      this.logger.log('Connecting MCP server to stdio transport...');

      // Create stdio transport
      this.transport = new StdioServerTransport();

      // Connect server to transport
      await this.server.connect(this.transport);

      this.isConnected = true;
      this.logger.log('MCP server connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect MCP server:', error);
      throw error;
    }
  }

  /**
   * Start the MCP server (initialize + connect)
   */
  async start(config: McpServerConfig): Promise<void> {
    await this.initialize(config);
    await this.connect();
  }

  /**
   * Get the MCP server instance
   */
  getServer(): McpServer | null {
    return this.server;
  }

  /**
   * Check if server is connected
   */
  isServerConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Cleanup on module destruction
   */
  async onModuleDestroy(): Promise<void> {
    if (this.server) {
      this.logger.log('Closing MCP server...');
      try {
        await this.server.close();
        this.isConnected = false;
      } catch (error) {
        this.logger.error('Error closing MCP server:', error);
      }
    }
  }
}
