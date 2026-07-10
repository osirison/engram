import { Injectable } from '@nestjs/common';

const REDACTED = '[REDACTED]';

/**
 * Policy applied when a fact's content matches one or more secret / PII
 * patterns during import.
 *
 * - `redact` — replace every match with `[REDACTED]`; the (safe) content is
 *   still embedded and stored.
 * - `flag`   — redact the content (like `redact`) AND hold the row out of the
 *   external embedding provider, tagging it `has-secret` for later review.
 * - `skip`   — drop the fact entirely.
 * - `fail`   — abort the import with {@link ImportSecretPolicyError}.
 */
export type SecretPolicy = 'redact' | 'flag' | 'skip' | 'fail';

export interface SecretMatch {
  pattern: string;
  count: number;
}

export interface ScanResult {
  /** Content with every matched span replaced by `[REDACTED]`. */
  redacted: string;
  /** One entry per pattern that matched, with the number of occurrences. */
  matches: SecretMatch[];
  /** True when at least one pattern matched. */
  hasSecret: boolean;
}

/**
 * Thrown by {@link SecretScanner.apply} under the `fail` policy when a fact
 * contains one or more secrets.
 */
export class ImportSecretPolicyError extends Error {
  constructor(
    public readonly path: string,
    public readonly patterns: string[]
  ) {
    super(
      `Import blocked by secret policy: ${path} matched secret pattern(s): ${patterns.join(', ')}`
    );
    this.name = 'ImportSecretPolicyError';
  }
}

/**
 * Ordered secret / PII patterns.  Each entry is `[name, regex]` and every
 * regex carries the global flag so a single {@link String.prototype.replace}
 * catches all occurrences.  More specific patterns come first.
 *
 * The first nine patterns mirror
 * `@engram/memory-ltm`'s `PrivacyFilterStep`; the remainder are import-specific
 * extensions (JWTs, Slack tokens, `.env`-style secret assignments, private
 * IPv4 ranges and internal hostnames).
 */
const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  // --- shared with memory-ltm PrivacyFilterStep -------------------------
  ['private-tag', /<private>[\s\S]*?<\/private>/gi],
  ['pem-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi],
  ['aws-key', /\b(?:AKIA|ASIA|AROA|AIPA|ANPA|ANVA|APKA)[A-Z0-9]{16}\b/g],
  ['github-token', /\b(?:ghp|ghs|ghr|gho|github_pat)_[A-Za-z0-9_]{36,255}\b/g],
  ['bearer-token', /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/gi],
  [
    'api-key',
    /\b(?:api[_-]?key|api[_-]?secret|access[_-]?token|secret[_-]?key)\s*[=:]\s*['"]?[A-Za-z0-9\-._~+/]{16,}['"]?/gi,
  ],
  ['password', /\bpass(?:word|wd|phrase)?\s*[=:]\s*['"]?[^\s'"]{4,}['"]?/gi],
  ['ssn', /\b\d{3}-\d{2}-\d{4}\b/g],
  ['credit-card', /\b(?:\d[ -]?){12,15}\d\b/g],
  // --- import-specific extensions --------------------------------------
  // JWTs: three base64url segments, the first starting with the `eyJ`
  // ({"alg" / {"typ") base64url header prefix.
  ['jwt', /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g],
  // Slack tokens: xoxb- / xoxa- / xoxp- / xoxr- / xoxs- prefixes.
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{8,}/g],
  // `.env`-style secret assignments: an identifier KEY containing one of the
  // secret-ish words, assigned a non-empty value.
  ['env-secret', /\b[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|APIKEY)[A-Za-z0-9_]*\s*=\s*\S+/gi],
  // Private IPv4 ranges: 10/8, 192.168/16, 172.16.0.0–172.31.255.255.
  [
    'private-ipv4',
    /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/g,
  ],
  // Internal hostnames: *.internal / *.local / *.corp.
  ['internal-host', /\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:internal|local|corp)\b/gi],
];

/**
 * First-class scan stage for the import pipeline.  Runs before facts are
 * embedded so that no raw secret ever reaches an external embedding provider.
 */
@Injectable()
export class SecretScanner {
  /**
   * Scan `content`, replacing every matched span with `[REDACTED]` and
   * recording which patterns matched and how many times.
   */
  scan(content: string): ScanResult {
    let redacted = content;
    const matches: SecretMatch[] = [];

    for (const [name, pattern] of PATTERNS) {
      let count = 0;
      redacted = redacted.replace(pattern, () => {
        count += 1;
        return REDACTED;
      });
      if (count > 0) {
        matches.push({ pattern: name, count });
      }
    }

    return { redacted, matches, hasSecret: matches.length > 0 };
  }

  /**
   * Apply a {@link SecretPolicy} to one fact-like object, returning the
   * (possibly redacted) content plus the side-effects the caller must honour.
   */
  apply(
    input: { content: string; sourcePath: string },
    policy: SecretPolicy
  ): {
    action: 'kept' | 'redacted' | 'flagged' | 'skipped';
    content: string;
    matches: SecretMatch[];
    embeddingExcluded: boolean;
    extraTags: string[];
  } {
    const { redacted, matches, hasSecret } = this.scan(input.content);

    if (!hasSecret) {
      return {
        action: 'kept',
        content: input.content,
        matches,
        embeddingExcluded: false,
        extraTags: [],
      };
    }

    switch (policy) {
      case 'redact':
        return {
          action: 'redacted',
          content: redacted,
          matches,
          embeddingExcluded: false,
          extraTags: [],
        };
      case 'flag':
        // Redact the stored content AND exclude it from embedding (qp Decision 3,
        // 2026-07-10): no raw secret ever lands in Postgres. `flag` differs from
        // `redact` only by holding the row out of the vector index + a review tag.
        return {
          action: 'flagged',
          content: redacted,
          matches,
          embeddingExcluded: true,
          extraTags: ['has-secret'],
        };
      case 'skip':
        return {
          action: 'skipped',
          content: input.content,
          matches,
          embeddingExcluded: false,
          extraTags: [],
        };
      case 'fail':
        throw new ImportSecretPolicyError(
          input.sourcePath,
          matches.map((m) => m.pattern)
        );
    }
  }
}
