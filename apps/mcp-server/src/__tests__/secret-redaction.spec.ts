import { Writable } from 'node:stream';
import pino from 'pino';
import { REDACT_PATHS } from '@engram/core';

interface PinoPayload {
  adminToken?: string;
  body?: { adminToken?: string };
  msg?: string;
  OPENAI_API_KEY?: string;
  openaiApiKey?: string;
  jwtSecret?: string;
  userId?: string;
  count?: number;
}

/**
 * Build an in-memory logger.
 *
 * pino emits JSON lines via a `Writable` stream, so we wrap a custom
 * `Writable` around our capture buffer. Each `write()` is split on `\n`
 * so a multi-line JSON chunk still produces a parseable line per record.
 */
function makeCapturingLogger(): {
  logger: pino.Logger;
  lines: PinoPayload[];
} {
  const lines: PinoPayload[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _enc, callback): void {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      for (const raw of text.split('\n')) {
        if (raw.length === 0) continue;
        try {
          lines.push(JSON.parse(raw) as PinoPayload);
        } catch {
          lines.push({});
        }
      }
      callback();
    },
  });
  const logger = pino(
    {
      level: 'info',
      redact: {
        paths: [...REDACT_PATHS],
        censor: '[Redacted]',
      },
    },
    stream,
  );
  return { logger, lines };
}

describe('pino redaction (logging.module.ts)', () => {
  it('redacts adminToken at every depth', () => {
    const { logger, lines } = makeCapturingLogger();

    logger.info(
      {
        adminToken: 'super-secret-token',
        body: { adminToken: 'nested-secret' },
      },
      'maintenance event',
    );

    expect(lines).toHaveLength(1);
    const payload = lines[0] as PinoPayload;
    expect(payload.adminToken).toBe('[Redacted]');
    expect(payload.body?.adminToken).toBe('[Redacted]');
    expect(payload.msg).toBe('maintenance event');
  });

  it('redacts OpenAI key variants', () => {
    const { logger, lines } = makeCapturingLogger();

    logger.info(
      {
        OPENAI_API_KEY: 'sk-1234',
        openaiApiKey: 'sk-5678',
        jwtSecret: 'shh',
      },
      'boot',
    );

    const payload = lines[0] as PinoPayload;
    expect(payload.OPENAI_API_KEY).toBe('[Redacted]');
    expect(payload.openaiApiKey).toBe('[Redacted]');
    expect(payload.jwtSecret).toBe('[Redacted]');
  });

  it('does not redact benign fields', () => {
    const { logger, lines } = makeCapturingLogger();

    logger.info({ userId: 'user-1', count: 42 }, 'recall');
    const payload = lines[0] as PinoPayload;
    expect(payload.userId).toBe('user-1');
    expect(payload.count).toBe(42);
  });
});
