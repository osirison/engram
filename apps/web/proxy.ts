import { NextResponse } from 'next/server';

import { auth } from '@/auth';

/**
 * Route protection (Next.js 16 "proxy" convention, formerly middleware).
 *
 * Unauthenticated requests are redirected to the sign-in page with a
 * `callbackUrl` so users land back where they intended. The matcher excludes
 * Next internals, the auth/tRPC APIs, and static assets so they stay reachable
 * without a session; tRPC enforces auth in its own context.
 */
export default auth((req) => {
  if (req.auth) return NextResponse.next();

  const signInUrl = new URL('/signin', req.nextUrl.origin);
  const target = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  if (target && target !== '/') {
    signInUrl.searchParams.set('callbackUrl', target);
  }
  return NextResponse.redirect(signInUrl);
});

export const config = {
  // Anchor the excluded prefixes to whole path segments so only the intended
  // routes bypass auth (e.g. `/apinote` is still protected). tRPC under /api
  // enforces auth in its own context; /signin is excluded to avoid a loop.
  matcher: ['/((?!api/|signin$|signin/|_next/static|_next/image|favicon.ico).*)'],
};
