import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';

import { isAllowedOperator, serverEnv } from '@/server/env';

/**
 * NextAuth.js v5 (Auth.js) configuration for the dashboard.
 *
 * - Google + GitHub OAuth, each enabled only when its credentials are present.
 * - An email/password development provider, hard-gated on
 *   `ENGRAM_DASHBOARD_DEV_AUTH` so it can never ship enabled.
 * - JWT sessions (no database adapter) — this keeps the whole config edge-safe
 *   so it can run in middleware, and avoids a second source of truth for users.
 * - Sign-in is gated by the `ENGRAM_ADMIN_EMAILS` allow-list.
 */

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      provider?: string;
    } & DefaultSession['user'];
  }
}

const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
const githubEnabled = Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);

export interface EnabledProvider {
  id: string;
  name: string;
}

/** Providers wired up given the current environment — drives the sign-in page. */
export const enabledProviders: EnabledProvider[] = [
  ...(googleEnabled ? [{ id: 'google', name: 'Google' }] : []),
  ...(githubEnabled ? [{ id: 'github', name: 'GitHub' }] : []),
  ...(serverEnv.devAuthEnabled ? [{ id: 'credentials', name: 'Development sign-in' }] : []),
];

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: '/signin' },
  providers: [
    ...(googleEnabled ? [Google] : []),
    ...(githubEnabled ? [GitHub] : []),
    ...(serverEnv.devAuthEnabled
      ? [
          Credentials({
            id: 'credentials',
            name: 'Development sign-in',
            credentials: {
              email: { label: 'Email', type: 'email' },
              name: { label: 'Name', type: 'text' },
            },
            authorize(raw) {
              const email = typeof raw?.email === 'string' ? raw.email.trim() : '';
              if (!email) return null;
              const name =
                typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : email;
              return { id: `dev:${email}`, email, name };
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    signIn({ user, account }) {
      // The dev provider is its own gate; OAuth logins must pass the allow-list.
      if (account?.provider === 'credentials') return true;
      return isAllowedOperator(user.email);
    },
    jwt({ token, account }) {
      if (account?.provider) {
        token.provider = account.provider;
      }
      // Re-validate the allow-list on every request so removing an operator from
      // ENGRAM_ADMIN_EMAILS revokes access without waiting for the token to
      // expire. The dev credentials provider is its own gate and is exempt.
      if (token.provider !== 'credentials' && !isAllowedOperator(token.email)) {
        return null;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? session.user.id;
        if (typeof token.provider === 'string') {
          session.user.provider = token.provider;
        }
      }
      return session;
    },
  },
});
