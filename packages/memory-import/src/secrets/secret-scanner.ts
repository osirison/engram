import { Injectable } from '@nestjs/common';

const REDACTED = '[REDACTED]';

/**
 * Policy applied when any of a fact's scannable surfaces — content, title, or
 * frontmatter string values — matches one or more secret / PII patterns during
 * import (G2-T2: all surfaces are scanned under the same policy).
 *
 * - `redact` — replace every match with `[REDACTED]`; the (safe) content is
 *   still embedded and stored.
 * - `flag`   — redact the content (like `redact`) AND hold the row out of the
 *   external embedding provider, tagging it `has-secret` for later review.
 * - `skip`   — drop the fact entirely.
 * - `fail`   — abort the import with {@link ImportSecretPolicyError}.
 */
export type SecretPolicy = 'redact' | 'flag' | 'skip' | 'fail';

/** Fact surface a secret was found in (reported by the `fail` policy error). */
export type SecretField = 'content' | 'title' | 'frontmatter';

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

export interface FrontmatterScanResult {
  /** Structure-preserving copy with every matched string span `[REDACTED]`. */
  redacted: Record<string, unknown>;
  matches: SecretMatch[];
  hasSecret: boolean;
}

/** One fact's scannable surfaces, handed to {@link SecretScanner.apply}. */
export interface SecretScanTarget {
  content: string;
  sourcePath: string;
  title?: string;
  frontmatter?: Record<string, unknown>;
}

export interface SecretPolicyResult {
  action: 'kept' | 'redacted' | 'flagged' | 'skipped';
  content: string;
  /** Sanitized title — present iff the input carried one. */
  title?: string;
  /** Sanitized frontmatter — present iff the input carried one. */
  frontmatter?: Record<string, unknown>;
  matches: SecretMatch[];
  embeddingExcluded: boolean;
  extraTags: string[];
}

/**
 * Thrown by {@link SecretScanner.apply} under the `fail` policy when a fact
 * contains one or more secrets. `fields` names the surface(s) that matched.
 */
export class ImportSecretPolicyError extends Error {
  constructor(
    public readonly path: string,
    public readonly patterns: string[],
    public readonly fields: SecretField[] = ['content']
  ) {
    super(
      `Import blocked by secret policy: ${path} matched secret pattern(s): ` +
        `${patterns.join(', ')} (in ${fields.join(', ')})`
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

/** Plain data map (not a Date/Map/class instance) — the only object kind the frontmatter scan recurses into. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Merge per-surface match lists, summing counts per pattern (first-seen order). */
function mergeMatches(...lists: Array<SecretMatch[] | undefined>): SecretMatch[] {
  const tally = new Map<string, number>();
  for (const list of lists) {
    for (const m of list ?? []) tally.set(m.pattern, (tally.get(m.pattern) ?? 0) + m.count);
  }
  return [...tally].map(([pattern, count]) => ({ pattern, count }));
}

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
   * Scan every string leaf of a frontmatter map, recursing into nested plain
   * objects and arrays. Keys and non-string leaves (numbers, booleans, dates…)
   * pass through untouched, so the redacted map keeps the exact shape the WP3
   * export round-trip depends on.
   */
  scanFrontmatter(frontmatter: Record<string, unknown>): FrontmatterScanResult {
    const tally = new Map<string, number>();
    const redacted = this.redactLeaves(frontmatter, tally) as Record<string, unknown>;
    const matches = [...tally].map(([pattern, count]) => ({ pattern, count }));
    return { redacted, matches, hasSecret: matches.length > 0 };
  }

  private redactLeaves(value: unknown, tally: Map<string, number>): unknown {
    if (typeof value === 'string') {
      const { redacted, matches } = this.scan(value);
      for (const m of matches) tally.set(m.pattern, (tally.get(m.pattern) ?? 0) + m.count);
      return redacted;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.redactLeaves(item, tally));
    }
    if (isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) out[key] = this.redactLeaves(item, tally);
      return out;
    }
    return value;
  }

  /**
   * Apply a {@link SecretPolicy} to one fact's surfaces (content + optional
   * title/frontmatter), returning the (possibly redacted) surfaces plus the
   * side-effects the caller must honour. A hit on ANY surface triggers the
   * policy; redaction is always in place so shapes are preserved.
   */
  apply(input: SecretScanTarget, policy: SecretPolicy): SecretPolicyResult {
    const content = this.scan(input.content);
    const title = input.title !== undefined ? this.scan(input.title) : undefined;
    const frontmatter =
      input.frontmatter !== undefined ? this.scanFrontmatter(input.frontmatter) : undefined;
    const matches = mergeMatches(content.matches, title?.matches, frontmatter?.matches);

    if (matches.length === 0) {
      return {
        action: 'kept',
        content: input.content,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.frontmatter !== undefined ? { frontmatter: input.frontmatter } : {}),
        matches,
        embeddingExcluded: false,
        extraTags: [],
      };
    }

    const sanitized = {
      content: content.redacted,
      ...(title !== undefined ? { title: title.redacted } : {}),
      ...(frontmatter !== undefined ? { frontmatter: frontmatter.redacted } : {}),
    };

    switch (policy) {
      case 'redact':
        return {
          action: 'redacted',
          ...sanitized,
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
          ...sanitized,
          matches,
          embeddingExcluded: true,
          extraTags: ['has-secret'],
        };
      case 'skip':
        // Dropped by the caller — still return redacted surfaces, never raw.
        return {
          action: 'skipped',
          ...sanitized,
          matches,
          embeddingExcluded: false,
          extraTags: [],
        };
      case 'fail': {
        const fields: SecretField[] = [];
        if (content.hasSecret) fields.push('content');
        if (title?.hasSecret) fields.push('title');
        if (frontmatter?.hasSecret) fields.push('frontmatter');
        throw new ImportSecretPolicyError(
          input.sourcePath,
          matches.map((m) => m.pattern),
          fields
        );
      }
    }
  }
}
