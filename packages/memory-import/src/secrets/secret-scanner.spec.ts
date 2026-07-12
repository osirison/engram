import { describe, expect, it } from 'vitest';

import { ImportSecretPolicyError, SecretScanner, type SecretMatch } from './secret-scanner.js';

const scanner = new SecretScanner();

function patternNames(matches: SecretMatch[]): string[] {
  return matches.map((m) => m.pattern);
}

/**
 * Slack-token prefix kept out of the literal below so the assembled `xox*-`
 * token is never a contiguous string in source. GitHub push protection blocks
 * such tokens even in test fixtures; reassembled at runtime the scanner still
 * sees a real-shaped token.
 */
const SLACK_PREFIX = 'xox';

/**
 * For every pattern: a `positive` string that MUST match and a `benign`
 * near-miss that MUST NOT match.  Each positive contains only that one secret
 * so we can assert on a single pattern name.
 */
const CASES: Array<{ pattern: string; positive: string; benign: string }> = [
  {
    pattern: 'private-tag',
    positive: 'notes <private>my mother maiden name</private> end',
    benign: 'this is a private matter, keep it between us',
  },
  {
    pattern: 'pem-key',
    positive: '-----BEGIN RSA PRIVATE KEY-----\nMIIByz2h\n-----END RSA PRIVATE KEY-----',
    benign: 'the public key is shared with everyone',
  },
  {
    pattern: 'aws-key',
    positive: 'creds AKIAIOSFODNN7EXAMPLE were rotated',
    benign: 'AKIA is a prefix but AKIASHORT is not a full key',
  },
  {
    pattern: 'github-token',
    positive: 'token ghp_1234567890abcdefghijklmnopqrstuvwxyzAB set',
    benign: 'ghp_ is the prefix but ghp_tooshort is not valid',
  },
  {
    pattern: 'bearer-token',
    positive: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
    benign: 'the bearer of bad news arrived at noon',
  },
  {
    pattern: 'api-key',
    positive: 'api_key = "abcdef0123456789ABCDEF"',
    benign: 'the api documentation lives in the wiki',
  },
  {
    pattern: 'password',
    positive: 'password: hunter2secret',
    benign: 'please choose a strong password when you sign up',
  },
  {
    pattern: 'ssn',
    positive: 'SSN 123-45-6789 on file',
    benign: 'call extension 12-345 for support',
  },
  {
    pattern: 'credit-card',
    positive: 'card 4111 1111 1111 1111 charged',
    benign: 'order number 42 shipped yesterday',
  },
  {
    pattern: 'jwt',
    positive: 'header eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N',
    benign: 'the value eyJhbGciOiJIUzI1NiJ9 has no second segment',
  },
  {
    pattern: 'slack-token',
    positive: `slack ${SLACK_PREFIX}b-2401234567-2410987654321-AbCdEfGhIjKlMnOpQr`,
    benign: 'we said xoxo-hugs in the channel',
  },
  {
    pattern: 'env-secret',
    positive: 'DB_PASSWORD=s3cr3tvalue',
    benign: 'the secret to good coffee is fresh beans',
  },
  {
    pattern: 'private-ipv4',
    positive: 'server at 10.0.0.5 responded',
    benign: 'public dns is 8.8.8.8 and 172.15.0.1 is not private',
  },
  {
    pattern: 'internal-host',
    positive: 'deploy to build.internal today',
    benign: 'the site lives at example.com over https',
  },
];

describe('SecretScanner.scan — per-pattern positives and near-misses', () => {
  for (const { pattern, positive, benign } of CASES) {
    it(`matches ${pattern} and redacts it`, () => {
      const result = scanner.scan(positive);
      expect(result.hasSecret).toBe(true);
      expect(patternNames(result.matches)).toContain(pattern);
      expect(result.redacted).toContain('[REDACTED]');
      expect(result.redacted).not.toBe(positive);
    });

    it(`does not match benign near-miss for ${pattern}`, () => {
      const result = scanner.scan(benign);
      expect(patternNames(result.matches)).not.toContain(pattern);
    });
  }
});

describe('SecretScanner.scan — counting and multiple matches', () => {
  it('records the number of occurrences per pattern', () => {
    const result = scanner.scan('a 10.0.0.1 and b 192.168.1.1 seen');
    const ip = result.matches.find((m) => m.pattern === 'private-ipv4');
    expect(ip?.count).toBe(2);
    // both occurrences replaced
    expect(result.redacted).toBe('a [REDACTED] and b [REDACTED] seen');
  });

  it('returns no matches and unchanged content for clean text', () => {
    const clean = 'This is an ordinary note about coffee and books.';
    const result = scanner.scan(clean);
    expect(result.hasSecret).toBe(false);
    expect(result.matches).toEqual([]);
    expect(result.redacted).toBe(clean);
  });

  it('is safe to call repeatedly (no leaked regex lastIndex state)', () => {
    const first = scanner.scan('ip 10.1.2.3 here');
    const second = scanner.scan('ip 10.1.2.3 here');
    expect(first).toEqual(second);
  });
});

describe('SecretScanner.apply — policy modes', () => {
  const withSecret = {
    content: 'token ghp_1234567890abcdefghijklmnopqrstuvwxyzAB',
    sourcePath: 'notes/a.md',
  };
  const clean = { content: 'just an ordinary note', sourcePath: 'notes/b.md' };

  it('redact: replaces matches, records them, embeds the safe content', () => {
    const out = scanner.apply(withSecret, 'redact');
    expect(out.action).toBe('redacted');
    expect(out.content).toContain('[REDACTED]');
    expect(out.content).not.toContain('ghp_');
    expect(out.embeddingExcluded).toBe(false);
    expect(out.extraTags).toEqual([]);
    expect(patternNames(out.matches)).toContain('github-token');
  });

  it('flag: redacts content, excludes embedding, adds has-secret tag', () => {
    const out = scanner.apply(withSecret, 'flag');
    expect(out.action).toBe('flagged');
    // Decision 3: flag now redacts (no raw secret stored) AND excludes embedding.
    expect(out.content).toContain('[REDACTED]');
    expect(out.content).not.toContain('ghp_');
    expect(out.embeddingExcluded).toBe(true);
    expect(out.extraTags).toEqual(['has-secret']);
  });

  it('skip: returns action skipped so the caller drops the fact', () => {
    const out = scanner.apply(withSecret, 'skip');
    expect(out.action).toBe('skipped');
    expect(out.matches.length).toBeGreaterThan(0);
  });

  it('fail: throws ImportSecretPolicyError with path and matched patterns', () => {
    let error: unknown;
    try {
      scanner.apply(withSecret, 'fail');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ImportSecretPolicyError);
    const typed = error as ImportSecretPolicyError;
    expect(typed.path).toBe('notes/a.md');
    expect(typed.patterns).toContain('github-token');
  });

  it('keeps clean content untouched under every policy', () => {
    for (const policy of ['redact', 'flag', 'skip', 'fail'] as const) {
      const out = scanner.apply(clean, policy);
      expect(out.action).toBe('kept');
      expect(out.content).toBe(clean.content);
      expect(out.embeddingExcluded).toBe(false);
      expect(out.extraTags).toEqual([]);
    }
  });
});

describe('SecretScanner.scanFrontmatter', () => {
  it('redacts string leaves in place, recursing into nested objects and arrays', () => {
    const result = scanner.scanFrontmatter({
      description: 'uses key AKIAIOSFODNN7EXAMPLE for deploys',
      nested: { hosts: ['10.0.0.5', 'example.com'], note: 'clean' },
    });
    expect(result.hasSecret).toBe(true);
    expect(patternNames(result.matches)).toEqual(
      expect.arrayContaining(['aws-key', 'private-ipv4'])
    );
    expect(result.redacted).toEqual({
      description: 'uses key [REDACTED] for deploys',
      nested: { hosts: ['[REDACTED]', 'example.com'], note: 'clean' },
    });
  });

  it('leaves non-string leaves (numbers, booleans, null) untouched', () => {
    const result = scanner.scanFrontmatter({
      password: 'password: hunter2secret',
      alwaysApply: true,
      retries: 3,
      globs: null,
    });
    expect(result.redacted['alwaysApply']).toBe(true);
    expect(result.redacted['retries']).toBe(3);
    expect(result.redacted['globs']).toBeNull();
    expect(result.redacted['password']).toContain('[REDACTED]');
  });

  it('aggregates match counts across leaves', () => {
    const result = scanner.scanFrontmatter({ a: 'ip 10.0.0.1', b: { c: 'ip 10.0.0.2' } });
    const ip = result.matches.find((m) => m.pattern === 'private-ipv4');
    expect(ip?.count).toBe(2);
  });

  it('returns hasSecret false and an equal map for clean frontmatter', () => {
    const clean = { description: 'ordinary rules', globs: ['src/**'], alwaysApply: false };
    const result = scanner.scanFrontmatter(clean);
    expect(result.hasSecret).toBe(false);
    expect(result.matches).toEqual([]);
    expect(result.redacted).toEqual(clean);
  });
});

describe('SecretScanner.apply — title + frontmatter surfaces (G2-T2)', () => {
  const dirty = {
    content: 'body with no secrets at all',
    sourcePath: 'rules/deploy.mdc',
    title: 'rotate AKIAIOSFODNN7EXAMPLE monthly',
    frontmatter: { description: 'server 10.0.0.5', nested: { port: 5432 } },
  };

  it('redact: sanitizes title and frontmatter in place, content untouched', () => {
    const out = scanner.apply(dirty, 'redact');
    expect(out.action).toBe('redacted');
    expect(out.content).toBe(dirty.content);
    expect(out.title).toBe('rotate [REDACTED] monthly');
    expect(out.frontmatter).toEqual({
      description: 'server [REDACTED]',
      nested: { port: 5432 },
    });
    expect(patternNames(out.matches)).toEqual(expect.arrayContaining(['aws-key', 'private-ipv4']));
  });

  it('flag: a frontmatter-only hit redacts AND excludes embedding + tags has-secret', () => {
    const out = scanner.apply(
      {
        content: 'clean body',
        sourcePath: 'rules/a.mdc',
        frontmatter: { description: 'DB_PASSWORD=s3cr3tvalue' },
      },
      'flag'
    );
    expect(out.action).toBe('flagged');
    expect(out.embeddingExcluded).toBe(true);
    expect(out.extraTags).toEqual(['has-secret']);
    expect(out.frontmatter?.['description']).toBe('[REDACTED]');
  });

  it('skip: a title-only hit marks the fact skipped', () => {
    const out = scanner.apply(
      { content: 'clean body', sourcePath: 'rules/a.mdc', title: 'ssn 123-45-6789' },
      'skip'
    );
    expect(out.action).toBe('skipped');
    expect(out.matches.length).toBeGreaterThan(0);
  });

  it('fail: names the matching surfaces in the error', () => {
    let error: unknown;
    try {
      scanner.apply(dirty, 'fail');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ImportSecretPolicyError);
    const typed = error as ImportSecretPolicyError;
    expect(typed.fields).toEqual(['title', 'frontmatter']);
    expect(typed.message).toMatch(/in title, frontmatter/);
  });

  it('kept: clean title + frontmatter pass through as the same values', () => {
    const frontmatter = { description: 'ordinary rules', alwaysApply: true };
    const out = scanner.apply(
      { content: 'clean body', sourcePath: 'rules/a.mdc', title: 'ordinary title', frontmatter },
      'redact'
    );
    expect(out.action).toBe('kept');
    expect(out.title).toBe('ordinary title');
    expect(out.frontmatter).toBe(frontmatter);
  });
});
