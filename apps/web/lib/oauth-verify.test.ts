import { describe, expect, it } from 'vitest';

import { isProviderEmailVerified } from './oauth-verify';

describe('isProviderEmailVerified', () => {
  it('accepts Google profiles only when email_verified is exactly true', () => {
    expect(isProviderEmailVerified('google', { email_verified: true })).toBe(true);
    expect(isProviderEmailVerified('google', { email_verified: false })).toBe(false);
    // Some providers send the claim as a string; only a real boolean true counts.
    expect(isProviderEmailVerified('google', { email_verified: 'true' })).toBe(false);
    expect(isProviderEmailVerified('google', {})).toBe(false);
  });

  it('accepts GitHub profiles only when a primary (verified) email is present', () => {
    expect(isProviderEmailVerified('github', { email: 'op@example.com' })).toBe(true);
    expect(isProviderEmailVerified('github', { email: null })).toBe(false);
    expect(isProviderEmailVerified('github', { email: '' })).toBe(false);
    expect(isProviderEmailVerified('github', {})).toBe(false);
  });

  it('fails closed for unknown providers and nullish profiles', () => {
    expect(isProviderEmailVerified('gitlab', { email_verified: true })).toBe(false);
    expect(isProviderEmailVerified(undefined, { email: 'x@y.z' })).toBe(false);
    expect(isProviderEmailVerified('google', null)).toBe(false);
    expect(isProviderEmailVerified('google', undefined)).toBe(false);
  });
});
