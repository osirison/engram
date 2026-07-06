/**
 * Minimal stderr logger. Diagnostics MUST go to stderr, never stdout — the
 * `recall-context` command's stdout is injected verbatim into an agent's
 * context (Claude Code SessionStart), so it must stay clean.
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export function createLogger(debugEnabled = false): Logger {
  const write = (level: string, message: string): void => {
    process.stderr.write(`engram ${level}: ${message}\n`);
  };
  return {
    info: (m) => write('info', m),
    warn: (m) => write('warn', m),
    error: (m) => write('error', m),
    debug: (m): void => {
      if (debugEnabled) write('debug', m);
    },
  };
}

/** A logger that discards everything — for tests. */
export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};
