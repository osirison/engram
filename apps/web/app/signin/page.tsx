import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AlertCircle } from 'lucide-react';

import { auth, enabledProviders, signIn } from '@/auth';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { EngramMark, GitHubMark, GoogleMark } from '@/components/provider-icons';
import { serverEnv } from '@/server/env';

export const metadata: Metadata = { title: 'Sign in' };

function safeCallback(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  // Only same-origin relative paths; reject protocol-relative ("//") and any
  // backslash (browsers treat "/\" as a scheme-relative redirect).
  if (value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) {
    return value;
  }
  return '/';
}

const errorMessages: Record<string, string> = {
  AccessDenied: 'Your account is not on the operator allow-list for this console.',
  Configuration: 'Authentication is not configured correctly. Check the server logs.',
  Verification: 'The sign-in link is no longer valid.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (session?.user) redirect('/');

  const params = await searchParams;
  const callbackUrl = safeCallback(params.callbackUrl);
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;
  const oauthProviders = enabledProviders.filter((p) => p.id !== 'credentials');
  const hasAnyProvider = enabledProviders.length > 0;

  return (
    <main className="relative flex min-h-svh items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl border bg-card shadow-sm">
            <EngramMark />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">ENGRAM Console</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in to inspect memories and monitor system health.
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          {errorCode && (
            <Alert variant="destructive" className="mb-5">
              <AlertCircle />
              <AlertTitle>Couldn&apos;t sign you in</AlertTitle>
              <AlertDescription>
                {errorMessages[errorCode] ?? 'Something went wrong. Please try again.'}
              </AlertDescription>
            </Alert>
          )}

          {!hasAnyProvider && (
            <Alert>
              <AlertCircle />
              <AlertTitle>No sign-in providers configured</AlertTitle>
              <AlertDescription>
                Set <code className="font-mono text-xs">AUTH_GOOGLE_ID</code>/
                <code className="font-mono text-xs">AUTH_GITHUB_ID</code> (with secrets), or enable{' '}
                <code className="font-mono text-xs">ENGRAM_DASHBOARD_DEV_AUTH=true</code> for local
                development.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-3">
            {oauthProviders.map((provider) => (
              <form
                key={provider.id}
                action={async () => {
                  'use server';
                  await signIn(provider.id, { redirectTo: callbackUrl });
                }}
              >
                <Button type="submit" variant="outline" className="w-full">
                  {provider.id === 'google' ? <GoogleMark /> : <GitHubMark />}
                  Continue with {provider.name}
                </Button>
              </form>
            ))}
          </div>

          {serverEnv.devAuthEnabled && (
            <>
              {oauthProviders.length > 0 && (
                <div className="my-5 flex items-center gap-3">
                  <Separator className="flex-1" />
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
                  <Separator className="flex-1" />
                </div>
              )}
              <form
                action={async (formData: FormData) => {
                  'use server';
                  await signIn('credentials', {
                    email: String(formData.get('email') ?? ''),
                    name: String(formData.get('name') ?? ''),
                    redirectTo: callbackUrl,
                  });
                }}
                className="flex flex-col gap-3"
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="you@example.com"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="name">Display name (optional)</Label>
                  <Input id="name" name="name" type="text" placeholder="Operator" />
                </div>
                <Button type="submit" className="w-full">
                  Continue
                </Button>
                <p className="text-xs text-muted-foreground">
                  Development sign-in is enabled. Disable it in production.
                </p>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          ENGRAM — Extended Neural Graph for Recall and Memory
        </p>
      </div>
    </main>
  );
}
