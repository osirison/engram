/**
 * Ping Tool Tests
 */

import { describe, expect, it } from 'vitest';
import { pingTool, pingHandler, pingInputSchema } from './ping.tool';

describe('Ping Tool', () => {
  describe('pingInputSchema', () => {
    it('should accept empty object', () => {
      const result = pingInputSchema.parse({});
      expect(result).toEqual({});
    });

    it('should reject non-object input', () => {
      expect(() => pingInputSchema.parse('invalid')).toThrow();
      expect(() => pingInputSchema.parse(123)).toThrow();
      expect(() => pingInputSchema.parse(null)).toThrow();
    });
  });

  describe('pingHandler', () => {
    it('should return pong status', async () => {
      const result = await pingHandler();

      expect(result).toHaveProperty('status', 'pong');
      expect(result).toHaveProperty('timestamp');
    });

    it('should return valid ISO timestamp', async () => {
      const result = await pingHandler();

      // Check if timestamp is a valid ISO date string
      const date = new Date(result.timestamp);
      expect(date.toISOString()).toBe(result.timestamp);
    });

    it('should return current timestamp', async () => {
      const before = Date.now();
      const result = await pingHandler();
      const after = Date.now();

      const resultTime = new Date(result.timestamp).getTime();
      expect(resultTime).toBeGreaterThanOrEqual(before);
      expect(resultTime).toBeLessThanOrEqual(after);
    });
  });

  describe('pingTool definition', () => {
    it('should have correct tool name', () => {
      expect(pingTool.name).toBe('ping');
    });

    it('should have description', () => {
      expect(pingTool.description).toBeTruthy();
      expect(typeof pingTool.description).toBe('string');
    });

    it('should have inputSchema', () => {
      expect(pingTool.inputSchema).toBe(pingInputSchema);
    });

    it('should have handler function', () => {
      expect(pingTool.handler).toBe(pingHandler);
      expect(typeof pingTool.handler).toBe('function');
    });
  });
});
