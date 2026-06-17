import { Injectable } from '@nestjs/common';
import type { PipelineStep, IngestContext } from './types.js';

const REDACTED = '[REDACTED]';

/**
 * 9 redaction patterns covering the most common credential and PII types.
 * Each entry: [name, regex].  Order matters — more specific patterns first.
 */
const PATTERNS: Array<[string, RegExp]> = [
  // 1. Explicit <private>…</private> blocks
  ['private-tag', /<private>[\s\S]*?<\/private>/gi],
  // 2. PEM private keys
  ['pem-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi],
  // 3. AWS access keys (AKIA… / ASIA…)
  ['aws-key', /\b(?:AKIA|ASIA|AROA|AIPA|ANPA|ANVA|APKA)[A-Z0-9]{16}\b/g],
  // 4. GitHub tokens (ghp_, ghs_, ghr_, gho_, github_pat_)
  ['github-token', /\b(?:ghp|ghs|ghr|gho|github_pat)_[A-Za-z0-9_]{36,255}\b/g],
  // 5. Bearer tokens in HTTP headers or code
  ['bearer-token', /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/g],
  // 6. Generic API keys / secrets (key=value style with long opaque values)
  [
    'api-key',
    /\b(?:api[_-]?key|api[_-]?secret|access[_-]?token|secret[_-]?key)\s*[=:]\s*['"]?[A-Za-z0-9\-._~+/]{16,}['"]?/gi,
  ],
  // 7. Passwords in assignment context (password = "…" or password: …)
  ['password', /\bpass(?:word|wd|phrase)?\s*[=:]\s*['"]?[^\s'"]{4,}['"]?/gi],
  // 8. Social Security Numbers (US format)
  ['ssn', /\b\d{3}-\d{2}-\d{4}\b/g],
  // 9. Credit card numbers (rough 13-16 digit Luhn candidates, hyphen/space separated)
  ['credit-card', /\b(?:\d[ -]?){12,15}\d\b/g],
];

/**
 * Step 1 of the ingest pipeline.
 *
 * Strips explicit `<private>` blocks and redacts 8 common credential / PII
 * patterns from memory content before it reaches storage. Non-blocking and
 * always produces a result — never aborts the pipeline.
 */
@Injectable()
export class PrivacyFilterStep implements PipelineStep<IngestContext> {
  readonly name = 'PrivacyFilter';

  execute(ctx: IngestContext): Promise<IngestContext> {
    let text = ctx.content;
    const redactions: string[] = [];

    for (const [label, pattern] of PATTERNS) {
      const before = text;
      text = text.replace(pattern, REDACTED);
      if (text !== before) {
        redactions.push(label);
      }
    }

    return Promise.resolve({
      ...ctx,
      content: text,
      redactions: [...ctx.redactions, ...redactions],
    });
  }
}
