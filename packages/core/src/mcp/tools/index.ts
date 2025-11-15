/**
 * MCP Tools Registry
 * Manages registration and execution of MCP tools
 */

import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '../types.js';
import { pingTool } from './ping.tool.js';

/**
 * Tool definition interface
 */
export interface Tool {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  handler: (input: unknown) => Promise<unknown>;
}

/**
 * Registry of built-in tools
 */
const builtInTools: Tool[] = [pingTool];

/**
 * Convert Zod schema to JSON Schema format for MCP
 */
function zodToJsonSchema(schema: z.ZodSchema): {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
} {
  // For now, handle simple object schemas
  // This is a basic implementation - can be extended later
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      if (value instanceof z.ZodString) {
        properties[key] = { type: 'string' };
      } else if (value instanceof z.ZodNumber) {
        properties[key] = { type: 'number' };
      } else if (value instanceof z.ZodBoolean) {
        properties[key] = { type: 'boolean' };
      }

      // Check if field is required (not optional)
      if (!(value instanceof z.ZodOptional)) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties: Object.keys(properties).length > 0 ? properties : undefined,
      required: required.length > 0 ? required : undefined,
    };
  }

  // Default for empty schemas
  return {
    type: 'object',
  };
}

/**
 * Register all MCP tools with the server
 * @param server - MCP server instance
 * @param additionalTools - Optional array of additional tools to register
 */
export function registerTools(server: McpServer, additionalTools: Tool[] = []): void {
  const logger = new Logger('McpTools');

  // Combine built-in and additional tools
  const allTools = [...builtInTools, ...additionalTools];

  // Register list_tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.log('Handling tools/list request');

    return {
      tools: allTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: zodToJsonSchema(tool.inputSchema),
      })),
    };
  });

  // Register call_tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    logger.log(`Handling tools/call request for tool: ${toolName}`);

    try {
      // Find the tool
      const tool = allTools.find((t) => t.name === toolName);
      if (!tool) {
        logger.error(`Unknown tool: ${toolName}`);
        throw new Error(`Unknown tool: ${toolName}`);
      }

      // Validate input with Zod
      const validatedInput = tool.inputSchema.parse(request.params.arguments || {});

      // Execute tool handler
      const result = await tool.handler(validatedInput);

      logger.log(`Tool ${toolName} executed successfully`);

      // Check if result is already in MCP format (has content array)
      if (
        result &&
        typeof result === 'object' &&
        'content' in result &&
        Array.isArray(result.content)
      ) {
        // Result is already in MCP format, return as-is
        return result as { content: Array<{ type: string; text: string }> };
      }

      // Wrap simple result in MCP format
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error(`Error executing tool ${toolName}:`, error);

      // Format error response
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: errorMessage }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  logger.log(`Registered ${allTools.length} MCP tools (${builtInTools.length} built-in, ${additionalTools.length} additional)`);
}
