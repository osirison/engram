/**
 * Ping Tool
 * Test connectivity to ENGRAM server
 */

import { z } from 'zod';

/**
 * Ping tool input schema (empty object, strict mode to reject extra properties)
 */
export const pingInputSchema = z.object({}).strict();

/**
 * Ping tool output type
 */
export interface PingOutput {
  status: string;
  timestamp: string;
}

/**
 * Ping tool handler
 * Returns a simple pong response with timestamp
 */
export async function pingHandler(): Promise<PingOutput> {
  return {
    status: 'pong',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Ping tool definition
 */
export const pingTool = {
  name: 'ping',
  description: 'Test connectivity to ENGRAM server',
  inputSchema: pingInputSchema,
  handler: pingHandler,
};
