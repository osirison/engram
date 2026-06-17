import { describe, it, expect } from 'vitest';
import { PrivacyFilterStep } from './privacy-filter.step.js';
import { buildIngestContext } from './types.js';

function ctx(content: string): ReturnType<typeof buildIngestContext> {
  return buildIngestContext({ userId: 'u1', content });
}

describe('PrivacyFilterStep', () => {
  const step = new PrivacyFilterStep();

  it('strips <private> blocks', async () => {
    const result = await step.execute(ctx('before <private>secret stuff</private> after'));
    expect(result.content).toBe('before [REDACTED] after');
    expect(result.redactions).toContain('private-tag');
  });

  it('strips multi-line <private> blocks', async () => {
    const result = await step.execute(ctx('start\n<private>\nline1\nline2\n</private>\nend'));
    expect(result.content).toBe('start\n[REDACTED]\nend');
  });

  it('redacts PEM private keys', async () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nABCDEFGH\n-----END RSA PRIVATE KEY-----';
    const result = await step.execute(ctx(`key: ${pem}`));
    expect(result.content).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(result.redactions).toContain('pem-key');
  });

  it('redacts AWS access keys', async () => {
    const result = await step.execute(ctx('key is AKIAIOSFODNN7EXAMPLE here'));
    expect(result.content).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result.redactions).toContain('aws-key');
  });

  it('redacts GitHub tokens', async () => {
    const result = await step.execute(ctx('token: ghp_16C7e42F292c6912E7710c838347Ae178B4a'));
    expect(result.content).not.toContain('ghp_16C7e42F292c6912E7710c838347Ae178B4a');
    expect(result.redactions).toContain('github-token');
  });

  it('redacts Bearer tokens', async () => {
    const result = await step.execute(
      ctx('Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9')
    );
    expect(result.content).not.toContain('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(result.redactions).toContain('bearer-token');
  });

  it('redacts password assignments', async () => {
    const result = await step.execute(ctx('config: password = s3cr3tP@ss'));
    expect(result.content).not.toContain('s3cr3tP@ss');
    expect(result.redactions).toContain('password');
  });

  it('redacts SSNs', async () => {
    const result = await step.execute(ctx('SSN: 123-45-6789'));
    expect(result.content).not.toContain('123-45-6789');
    expect(result.redactions).toContain('ssn');
  });

  it('leaves clean content unchanged', async () => {
    const clean = 'This is a normal memory about TypeScript architecture.';
    const result = await step.execute(ctx(clean));
    expect(result.content).toBe(clean);
    expect(result.redactions).toHaveLength(0);
  });

  it('accumulates redactions across multiple patterns', async () => {
    const content = 'AKIAIOSFODNN7EXAMPLE password = hunter2 SSN: 123-45-6789';
    const result = await step.execute(ctx(content));
    expect(result.redactions.length).toBeGreaterThanOrEqual(3);
  });

  it('preserves existing redactions in context', async () => {
    const existing = buildIngestContext({ userId: 'u1', content: 'x' });
    const seeded = { ...existing, redactions: ['prior-step'] };
    const result = await step.execute(seeded);
    expect(result.redactions).toContain('prior-step');
  });
});
