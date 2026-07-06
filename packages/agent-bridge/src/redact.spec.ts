import { describe, expect, it } from 'vitest';
import { looksLikeSecret, redactSecrets } from './redact.js';

describe('redactSecrets', () => {
  it('redacts an OpenAI-style key embedded in prose', () => {
    const { text, redactionCount } = redactSecrets('the key is sk-abcdefghij0123456789ABCDEF here');
    expect(text).not.toContain('sk-abcdefghij');
    expect(text).toContain('[REDACTED]');
    expect(redactionCount).toBeGreaterThan(0);
  });

  it('redacts a key=value assignment', () => {
    const { text, redactionCount } = redactSecrets('OPENAI_API_KEY=sk-proj-verysecretvalue123456');
    expect(text).toContain('[REDACTED]');
    expect(text).not.toContain('verysecretvalue');
    expect(redactionCount).toBeGreaterThan(0);
  });

  it('redacts an AWS access key id and a github token', () => {
    const { text } = redactSecrets(
      'use AKIAIOSFODNN7EXAMPLE and ghp_0123456789abcdefghijABCDEFGHIJ0123'
    );
    expect(text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(text).not.toContain('ghp_0123456789');
  });

  it('leaves benign content untouched', () => {
    const input = 'We chose pgvector over Qdrant because it removes a service.';
    const { text, redactionCount } = redactSecrets(input);
    expect(text).toBe(input);
    expect(redactionCount).toBe(0);
  });
});

describe('looksLikeSecret', () => {
  it('flags a bare credential', () => {
    expect(looksLikeSecret('sk-abcdefghij0123456789ABCDEF')).toBe(true);
  });

  it('flags a private key block', () => {
    expect(looksLikeSecret('-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END-----')).toBe(true);
  });

  it('does not flag a normal decision fact that merely mentions tokens', () => {
    expect(looksLikeSecret('Rotate the API token via revoke_api_key then re-mint.')).toBe(false);
  });

  it('returns false on empty input', () => {
    expect(looksLikeSecret('   ')).toBe(false);
  });
});
