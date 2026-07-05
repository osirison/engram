import { describe, expect, it, vi } from 'vitest';

import { isGithubEmailVerified, isProviderEmailVerified } from './oauth-verify';

describe('isProviderEmailVerified', () => {
  it('accepts Google profiles only when email_verified is exactly true', () => {
    expect(isProviderEmailVerified('google', { email_verified: true })).toBe(true);
    expect(isProviderEmailVerified('google', { email_verified: false })).toBe(false);
    // Some providers send the claim as a string; only a real boolean true counts.
    expect(isProviderEmailVerified('google', { email_verified: 'true' })).toBe(false);
    expect(isProviderEmailVerified('google', {})).toBe(false);
  });

  it('fails closed for GitHub (verification is done out-of-band via /user/emails)', () => {
    // The synchronous profile check no longer trusts GitHub's public email;
    // isGithubEmailVerified owns that path.
    expect(isProviderEmailVerified('github', { email: 'op@example.com' })).toBe(false);
  });

  it('fails closed for unknown providers and nullish profiles', () => {
    expect(isProviderEmailVerified('gitlab', { email_verified: true })).toBe(false);
    expect(isProviderEmailVerified(undefined, { email: 'x@y.z' })).toBe(false);
    expect(isProviderEmailVerified('google', null)).toBe(false);
    expect(isProviderEmailVerified('google', undefined)).toBe(false);
  });
});

describe('isGithubEmailVerified', () => {
  const okResponse = (body: unknown): Response =>
    ({ ok: true, json: () => Promise.resolve(body) }) as unknown as Response;

  it('accepts when the email is present with verified: true', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse([
        { email: 'other@example.com', primary: false, verified: false },
        { email: 'op@example.com', primary: true, verified: true },
      ])
    );
    await expect(isGithubEmailVerified('op@example.com', 'tok', fetchImpl)).resolves.toBe(true);

    // Sends a bearer-authenticated request to the GitHub emails endpoint.
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/user/emails',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      })
    );
  });

  it('matches the email case-insensitively', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okResponse([{ email: 'Op@Example.com', verified: true }]));
    await expect(isGithubEmailVerified('op@example.com', 'tok', fetchImpl)).resolves.toBe(true);
  });

  it('denies when the matching entry is not verified', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okResponse([{ email: 'op@example.com', verified: false }]));
    await expect(isGithubEmailVerified('op@example.com', 'tok', fetchImpl)).resolves.toBe(false);
  });

  it('denies when the email is not in the returned list', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okResponse([{ email: 'someone@else.com', verified: true }]));
    await expect(isGithubEmailVerified('op@example.com', 'tok', fetchImpl)).resolves.toBe(false);
  });

  it('denies without an email or access token (never calls the API)', async () => {
    const fetchImpl = vi.fn();
    await expect(isGithubEmailVerified(null, 'tok', fetchImpl)).resolves.toBe(false);
    await expect(isGithubEmailVerified('op@example.com', undefined, fetchImpl)).resolves.toBe(
      false
    );
    await expect(isGithubEmailVerified('', 'tok', fetchImpl)).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('denies on a non-2xx response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, json: () => Promise.resolve([]) } as unknown as Response);
    await expect(isGithubEmailVerified('op@example.com', 'tok', fetchImpl)).resolves.toBe(false);
  });

  it('denies on a malformed (non-array) body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ email: 'op@example.com' }));
    await expect(isGithubEmailVerified('op@example.com', 'tok', fetchImpl)).resolves.toBe(false);
  });

  it('denies (fails closed) when the network call throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(isGithubEmailVerified('op@example.com', 'tok', fetchImpl)).resolves.toBe(false);
  });
});
