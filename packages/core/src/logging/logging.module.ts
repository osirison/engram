import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

/**
 * Pino redaction paths for secret material that must never appear in logs.
 *
 * Each secret is listed twice: once at the record root and once with a
 * single-segment wildcard (`*`). pino's `*` matches a single path segment
 * (so `*.adminToken` redacts `obj.adminToken` but not the root
 * `adminToken`), and we want the redaction to fire regardless of where
 * the caller attaches the field.
 *
 * The list intentionally covers both config-shaped keys (`adminToken`,
 * `authorization`, `apiKey`) and the common environment-variable casing
 * (`OPENAI_API_KEY`) because callers occasionally pass `process.env`
 * values through structured logging.
 *
 * Keeping this list here (instead of in a per-consumer config) ensures
 * the redaction applies to every NestJS logger in the application graph
 * and to the HTTP request logger attached by nestjs-pino.
 */
export const REDACT_PATHS: ReadonlyArray<string> = [
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

const REDACT_REMOVAL_KEY = '[Redacted]';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV === 'development'
            ? {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  singleLine: true,
                  translateTime: 'HH:MM:ss Z',
                  ignore: 'pid,hostname',
                },
              }
            : undefined,
        level: process.env.LOG_LEVEL || 'info',
        autoLogging: true,
        redact: {
          paths: [...REDACT_PATHS],
          censor: REDACT_REMOVAL_KEY,
        },
        serializers: {
          req: (req) => ({
            id: req.id,
            method: req.method,
            url: req.url,
          }),
          res: (res) => ({
            statusCode: res.statusCode,
          }),
        },
      },
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
