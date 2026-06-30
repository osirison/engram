import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { AppShell } from '@/components/layout/app-shell';
import { getBackend } from '@/server/backend';
import { serverEnv } from '@/server/env';

/** Pick a sensible default data owner: configured > most-active > operator email. */
async function resolveInitialUserId(fallbackEmail: string | null): Promise<string> {
  if (serverEnv.defaultUserId) return serverEnv.defaultUserId;
  try {
    const owners = await getBackend().listMemoryOwners(1);
    if (owners[0]) return owners[0].userId;
  } catch {
    // Postgres unreachable — fall back to the operator identity.
  }
  return fallbackEmail ?? '';
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect('/signin');
  }

  const initialUserId = await resolveInitialUserId(session.user.email ?? null);

  return (
    <AppShell
      user={{
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
      }}
      initialUserId={initialUserId}
    >
      {children}
    </AppShell>
  );
}
