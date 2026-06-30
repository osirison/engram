import { describe, it, expect } from 'vitest';
import type { OAuthHttpClient, OAuthHttpResponse } from './http-client.js';
import { GitHubOAuthProvider } from './github.provider.js';
import { GoogleOAuthProvider } from './google.provider.js';
import { OAuthService } from './oauth.service.js';
import { OAuthExchangeError } from './oauth-provider.js';

type Route = { match: (url: string) => boolean; response: OAuthHttpResponse };

/** Fake HTTP client that matches requests to canned responses by URL substring. */
class FakeHttpClient implements OAuthHttpClient {
  public postCalls: Array<{ url: string; form: Record<string, string> }> = [];
  public getCalls: Array<{ url: string; headers?: Record<string, string> }> = [];

  constructor(
    private readonly posts: Route[],
    private readonly gets: Route[]
  ) {}

  async postForm(url: string, form: Record<string, string>): Promise<OAuthHttpResponse> {
    this.postCalls.push({ url, form });
    const route = this.posts.find((r) => r.match(url));
    return route ? route.response : notFound();
  }

  async getJson(url: string, headers?: Record<string, string>): Promise<OAuthHttpResponse> {
    this.getCalls.push({ url, headers });
    const route = this.gets.find((r) => r.match(url));
    return route ? route.response : notFound();
  }
}

function ok(body: unknown): OAuthHttpResponse {
  return { status: 200, ok: true, body };
}
function notFound(): OAuthHttpResponse {
  return { status: 404, ok: false, body: null };
}

const CREDS = { clientId: 'cid', clientSecret: 'secret' };

describe('GitHubOAuthProvider', () => {
  it('builds an authorization URL with state and scopes', () => {
    const provider = new GitHubOAuthProvider(CREDS, new FakeHttpClient([], []));
    const url = new URL(
      provider.getAuthorizationUrl({
        state: 'state-123',
        redirectUri: 'https://app/cb',
      })
    );
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app/cb');
    expect(url.searchParams.get('scope')).toContain('user:email');
  });

  it('exchanges a code and returns a normalised profile', async () => {
    const http = new FakeHttpClient(
      [
        {
          match: (u): boolean => u.includes('access_token'),
          response: ok({ access_token: 'tok' }),
        },
      ],
      [
        {
          match: (u): boolean => u.endsWith('/user'),
          response: ok({ id: 42, login: 'octocat', name: 'Octo', email: 'octo@gh.com' }),
        },
      ]
    );
    const provider = new GitHubOAuthProvider(CREDS, http);
    const profile = await provider.exchangeCodeForProfile({
      code: 'abc',
      redirectUri: 'https://app/cb',
    });
    expect(profile).toEqual({
      provider: 'github',
      providerAccountId: '42',
      email: 'octo@gh.com',
      name: 'Octo',
    });
    // Sent a User-Agent (GitHub rejects requests without one).
    expect(http.getCalls[0]?.headers?.['User-Agent']).toBeTruthy();
  });

  it('falls back to /user/emails when the profile email is private', async () => {
    const http = new FakeHttpClient(
      [
        {
          match: (u): boolean => u.includes('access_token'),
          response: ok({ access_token: 'tok' }),
        },
      ],
      [
        {
          match: (u): boolean => u.endsWith('/user'),
          response: ok({ id: 7, login: 'priv', name: null, email: null }),
        },
        {
          match: (u): boolean => u.endsWith('/user/emails'),
          response: ok([
            { email: 'secondary@gh.com', primary: false, verified: true },
            { email: 'primary@gh.com', primary: true, verified: true },
          ]),
        },
      ]
    );
    const provider = new GitHubOAuthProvider(CREDS, http);
    const profile = await provider.exchangeCodeForProfile({
      code: 'abc',
      redirectUri: 'https://app/cb',
    });
    expect(profile.email).toBe('primary@gh.com');
    expect(profile.name).toBe('priv'); // falls back to login when name is null
  });

  it('throws when no verified email can be resolved', async () => {
    const http = new FakeHttpClient(
      [
        {
          match: (u): boolean => u.includes('access_token'),
          response: ok({ access_token: 'tok' }),
        },
      ],
      [
        {
          match: (u): boolean => u.endsWith('/user'),
          response: ok({ id: 7, login: 'priv', name: null, email: null }),
        },
        {
          match: (u): boolean => u.endsWith('/user/emails'),
          response: ok([{ email: 'x@gh.com', primary: true, verified: false }]),
        },
      ]
    );
    const provider = new GitHubOAuthProvider(CREDS, http);
    await expect(
      provider.exchangeCodeForProfile({ code: 'abc', redirectUri: 'https://app/cb' })
    ).rejects.toBeInstanceOf(OAuthExchangeError);
  });

  it('throws when the token exchange fails', async () => {
    const http = new FakeHttpClient(
      [
        {
          match: (): boolean => true,
          response: { status: 401, ok: false, body: { error: 'bad_verification_code' } },
        },
      ],
      []
    );
    const provider = new GitHubOAuthProvider(CREDS, http);
    await expect(
      provider.exchangeCodeForProfile({ code: 'bad', redirectUri: 'https://app/cb' })
    ).rejects.toBeInstanceOf(OAuthExchangeError);
  });
});

describe('GoogleOAuthProvider', () => {
  it('builds an authorization URL', () => {
    const provider = new GoogleOAuthProvider(CREDS, new FakeHttpClient([], []));
    const url = new URL(
      provider.getAuthorizationUrl({ state: 's', redirectUri: 'https://app/cb' })
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toContain('email');
  });

  it('exchanges a code and returns a normalised profile', async () => {
    const http = new FakeHttpClient(
      [{ match: (u): boolean => u.includes('token'), response: ok({ access_token: 'tok' }) }],
      [
        {
          match: (u): boolean => u.includes('userinfo'),
          response: ok({ id: 'g-1', email: 'u@gmail.com', verified_email: true, name: 'Goo' }),
        },
      ]
    );
    const provider = new GoogleOAuthProvider(CREDS, http);
    const profile = await provider.exchangeCodeForProfile({
      code: 'abc',
      redirectUri: 'https://app/cb',
    });
    expect(profile).toEqual({
      provider: 'google',
      providerAccountId: 'g-1',
      email: 'u@gmail.com',
      name: 'Goo',
    });
  });

  it('rejects an unverified Google email', async () => {
    const http = new FakeHttpClient(
      [{ match: (u): boolean => u.includes('token'), response: ok({ access_token: 'tok' }) }],
      [
        {
          match: (u): boolean => u.includes('userinfo'),
          response: ok({ id: 'g-1', email: 'u@gmail.com', verified_email: false }),
        },
      ]
    );
    const provider = new GoogleOAuthProvider(CREDS, http);
    await expect(
      provider.exchangeCodeForProfile({ code: 'abc', redirectUri: 'https://app/cb' })
    ).rejects.toBeInstanceOf(OAuthExchangeError);
  });
});

describe('OAuthService', () => {
  it('reports which providers are enabled', () => {
    const http = new FakeHttpClient([], []);
    const svc = new OAuthService([new GitHubOAuthProvider(CREDS, http)]);
    expect(svc.isEnabled('github')).toBe(true);
    expect(svc.isEnabled('google')).toBe(false);
    expect(svc.listEnabled()).toEqual(['github']);
    expect(svc.getProvider('github').name).toBe('github');
    expect(() => svc.getProvider('google')).toThrow(/not configured/);
  });
});
