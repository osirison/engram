import helmet from 'helmet';
import { helmetOptions } from './security-headers.util';

/**
 * Run the configured helmet middleware against a minimal req/res pair and
 * capture the headers it emits, so we assert real behaviour (the actual CSP
 * string helmet produces) rather than just mirroring the config object.
 */
const emittedHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {};
  const req = { method: 'GET', url: '/mcp' } as unknown as Parameters<
    ReturnType<typeof helmet>
  >[0];
  const res = {
    setHeader: (name: string, value: string | number | string[]): void => {
      headers[name.toLowerCase()] = String(value);
    },
    getHeader: (): undefined => undefined,
    removeHeader: (): void => {},
  } as unknown as Parameters<ReturnType<typeof helmet>>[1];

  helmet(helmetOptions)(req, res, () => {});
  return headers;
};

describe('helmetOptions', () => {
  it('does not disable the Content-Security-Policy', () => {
    expect(helmetOptions.contentSecurityPolicy).not.toBe(false);
  });

  it('emits a restrictive CSP that denies all resource loading and framing', () => {
    const csp = emittedHeaders()['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('does not fall back to any permissive default-src (e.g. self or *)', () => {
    const csp = emittedHeaders()['content-security-policy'];
    expect(csp).not.toContain("default-src 'self'");
    expect(csp).not.toContain('*');
  });
});
