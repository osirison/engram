import { describe, expect, it, vi } from 'vitest';

// `auth()` is next-auth's wrapper: it resolves the session, assigns it to
// `req.auth`, and calls our handler. Here it just hands the handler back so the
// guard can be exercised directly with a synthetic request.
vi.mock('@/auth', () => ({
  auth: (handler: (req: unknown) => unknown) => handler,
}));

const { default: proxy } = await import('./proxy');

// The real `auth()` wrapper types its handler as (req, ctx); the mock above
// passes ours straight through, so call it with just the request we synthesise.
const invoke = (auth: unknown, pathname = '/memories', search = ''): Response =>
  (proxy as unknown as (req: unknown) => Response)({
    auth,
    nextUrl: { origin: 'https://engram.test', pathname, search },
  });

const locationOf = (res: Response) => new URL(res.headers.get('location') as string);

/**
 * Regression guard for GHSA-8fpg-xm3f-6cx3 (critical, "auth fails open").
 *
 * On a server-side Auth.js configuration error the session endpoint returned a
 * non-OK response whose JSON *error body* was assigned to `req.auth`. Being a
 * truthy object, a bare `if (req.auth)` admitted every visitor. next-auth
 * 5.0.0-beta.32 fixes it at source; this proxy checks `.user` so the repo does
 * not depend on that alone.
 */
describe('proxy route guard', () => {
  it('admits a request that carries a real session user', () => {
    expect(invoke({ user: { id: 'u1', email: 'op@example.com' } }).status).toBe(200);
  });

  it('redirects to sign-in when there is no session', () => {
    const res = invoke(null);
    expect(res.status).toBe(307);
    expect(locationOf(res).pathname).toBe('/signin');
    expect(locationOf(res).searchParams.get('callbackUrl')).toBe('/memories');
  });

  it('fails CLOSED on a truthy session object that has no user', () => {
    // The exact advisory payload: an error body, not a session.
    const res = invoke({ message: 'There was a problem with the server configuration.' });
    expect(res.status).toBe(307);
    expect(locationOf(res).pathname).toBe('/signin');
  });

  it('fails CLOSED when user is present but empty-ish', () => {
    for (const auth of [{}, { user: null }, { user: undefined }]) {
      expect(invoke(auth).status).toBe(307);
    }
  });

  it('preserves the query string in callbackUrl and omits it for root', () => {
    expect(locationOf(invoke(null, '/memories', '?q=hello')).searchParams.get('callbackUrl')).toBe(
      '/memories?q=hello'
    );
    expect(locationOf(invoke(null, '/', '')).searchParams.has('callbackUrl')).toBe(false);
  });
});
