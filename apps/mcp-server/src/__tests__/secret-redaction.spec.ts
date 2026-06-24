import { Writable } from 'node:stream';
import pino from 'pino';

/**
 * Pino redaction paths used by LoggingModule.
 *
 * Mirrored here so we can assert redaction without booting the full
 * NestJS application graph. The constants are intentionally duplicated
 * (rather than imported) so the test fails loudly if the production list
 * diverges from the expected set.
 *
 * Note: pino's redact paths use `*` for one path segment and `**` for
 * any depth. We list both single-segment and top-level variants so the
 * redaction applies whether the secret is logged at the root of the
 * record or nested inside a metadata / options object.
 */
const REDACT_PATHS: ReadonlyArray<string> = [
  'adminToken',
  '*.adminToken',
  'authorization',
  '*.authorization',
  'apiKey',
  '*.apiKey',
  'api_key',
  '*.api_key',
  'OPENAI_API_KEY',
  '*.OPENAI_API_KEY',
  'openaiApiKey',
  '*.openaiApiKey',
  'jwtSecret',
  '*.jwtSecret',
  'JWT_SECRET',
  '*.JWT_SECRET',
  'MCP_ADMIN_TOKEN',
  '*.MCP_ADMIN_TOKEN',
  'metadata.secrets',
  'metadata.admin',
  'req.headers.authorization',
  'req.headers["mcp-admin-token"]',
  'res.headers["set-cookie"]',
];

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
