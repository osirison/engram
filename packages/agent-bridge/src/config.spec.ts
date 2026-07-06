import { describe, expect, it } from 'vitest';
import { resolveConfig } from './config.js';

describe('resolveConfig', () => {
  it('applies safe defaults with an empty environment', () => {
    const cfg = resolveConfig({});
    expect(cfg.mcpUrl).toBe('http://127.0.0.1:3000/mcp');
    expect(cfg.baseUrl).toBe('http://127.0.0.1:3000');
    expect(cfg.userId).toBe('qp');
    expect(cfg.agent).toBe('cli-bridge');
    expect(cfg.deadlineMs).toBe(2000);
    expect(cfg.apiKey).toBeUndefined();
    expect(cfg.distill.model).toBe('gpt-4o-mini');
    expect(cfg.distill.apiKey).toBeUndefined();
  });

  it('derives baseUrl origin from a full MCP URL', () => {
    const cfg = resolveConfig({ ENGRAM_URL: 'https://memory.example.com:8443/mcp' });
    expect(cfg.baseUrl).toBe('https://memory.example.com:8443');
  });

  it('reads overrides and falls back to OPENAI_API_KEY for distillation', () => {
    const cfg = resolveConfig({
      ENGRAM_API_KEY: 'eng_key',
      ENGRAM_USER_ID: 'qp',
      ENGRAM_AGENT: 'claude-code',
      ENGRAM_TIMEOUT_MS: '5000',
      OPENAI_API_KEY: 'sk-openai',
    });
    expect(cfg.apiKey).toBe('eng_key');
    expect(cfg.agent).toBe('claude-code');
    expect(cfg.deadlineMs).toBe(5000);
    expect(cfg.distill.apiKey).toBe('sk-openai');
  });

  it('ignores an invalid timeout and keeps the default', () => {
    expect(resolveConfig({ ENGRAM_TIMEOUT_MS: 'abc' }).deadlineMs).toBe(2000);
    expect(resolveConfig({ ENGRAM_TIMEOUT_MS: '-4' }).deadlineMs).toBe(2000);
  });

  it('falls back to the default origin for an unparseable URL', () => {
    expect(resolveConfig({ ENGRAM_URL: 'not a url' }).baseUrl).toBe('http://127.0.0.1:3000');
  });
});
