'use client';

import { Check, LogOut, Minus, Plug, ShieldCheck, UserRound } from 'lucide-react';
import { signOut } from 'next-auth/react';

import { PageContainer, PageHeader } from '@/components/page-header';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserScope } from '@/components/user-scope';
import { formatNumber, initials, relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { trpc } from '@/trpc/react';

function Capability({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          'flex items-center gap-1.5 font-medium',
          ok ? 'text-[var(--success)]' : 'text-muted-foreground'
        )}
      >
        {ok ? <Check className="size-3.5" /> : <Minus className="size-3.5" />}
        {ok ? 'Enabled' : 'Disabled'}
      </span>
    </div>
  );
}

export default function SettingsPage() {
  const { userId, setUserId } = useUserScope();
  const session = trpc.meta.session.useQuery();
  const capabilities = trpc.meta.capabilities.useQuery();
  const owners = trpc.meta.owners.useQuery();
  // The data owners this operator is bound to (WP2 T9): `'*'` when unbound.
  const allowedTenants = trpc.meta.allowedTenants.useQuery();

  const user = session.data?.user;
  const allowed = allowedTenants.data;

  return (
    <PageContainer>
      <PageHeader title="Settings" description="Session, connection, and data-owner details." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserRound className="size-4 text-muted-foreground" /> Operator
            </CardTitle>
            <CardDescription>The account signed in to this console.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {session.isLoading || !user ? (
              <Skeleton className="h-12 w-full" />
            ) : (
              <div className="flex items-center gap-3">
                <Avatar className="size-10">
                  {user.image && <AvatarImage src={user.image} alt={user.name ?? ''} />}
                  <AvatarFallback>{initials(user.name ?? user.email)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate font-medium">{user.name ?? user.email ?? 'Operator'}</p>
                  {user.email && (
                    <p className="truncate text-sm text-muted-foreground">{user.email}</p>
                  )}
                </div>
                {user.provider && (
                  <Badge variant="outline" className="ml-auto capitalize">
                    {user.provider}
                  </Badge>
                )}
              </div>
            )}
            {allowed !== undefined && (
              <div className="rounded-md border px-3 py-2 text-sm">
                <span className="text-muted-foreground">Data-owner access: </span>
                {allowed === '*' ? (
                  <span className="font-medium">All data owners</span>
                ) : allowed.length > 0 ? (
                  <span className="font-mono text-xs font-medium">{allowed.join(', ')}</span>
                ) : (
                  <span className="font-medium text-[var(--warning)]">
                    None — no tenant binding matches your account
                  </span>
                )}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void signOut({ callbackUrl: '/signin' })}
            >
              <LogOut className="size-3.5" /> Sign out
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plug className="size-4 text-muted-foreground" /> Backend connection
            </CardTitle>
            <CardDescription>What the console can do with the configured server.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {capabilities.isLoading || !capabilities.data ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <>
                <Capability ok={capabilities.data.mcpConfigured} label="ENGRAM server configured" />
                <Capability
                  ok={capabilities.data.semanticSearch}
                  label="Semantic search (recall)"
                />
                <Capability ok={capabilities.data.writes} label="Edit & delete memories" />
                {capabilities.data.mcpConfigured && (
                  <Capability
                    ok={
                      capabilities.data.delegation === 'admin' ||
                      capabilities.data.delegation === 'unrestricted'
                    }
                    label="Cross-tenant writes & search"
                  />
                )}
                {capabilities.data.limitation && (
                  <p className="pt-1 text-xs text-[var(--warning)]">
                    {capabilities.data.limitation}
                  </p>
                )}
                {!capabilities.data.mcpConfigured && (
                  <p className="pt-1 text-xs text-muted-foreground">
                    Set <code className="font-mono">ENGRAM_MCP_URL</code> to enable semantic search
                    and write actions. Reads and analytics work directly against Postgres.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-muted-foreground" /> Data owners
          </CardTitle>
          <CardDescription>
            Memory owners in storage. Select one to set the active scope for the console.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {owners.isLoading ? (
            <div className="space-y-2 px-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : owners.data && owners.data.length > 0 ? (
            <ul className="divide-y">
              {owners.data.map((owner) => (
                <li key={owner.userId} className="flex items-center gap-3 px-6 py-2.5">
                  <span className="truncate font-mono text-sm">{owner.userId}</span>
                  {owner.userId === userId && <Badge variant="secondary">Active</Badge>}
                  <span className="ml-auto text-sm text-muted-foreground">
                    {formatNumber(owner.count)} · {relativeTime(owner.lastActivityAt)}
                  </span>
                  <Button
                    variant={owner.userId === userId ? 'secondary' : 'outline'}
                    size="sm"
                    disabled={owner.userId === userId}
                    onClick={() => setUserId(owner.userId)}
                  >
                    {owner.userId === userId ? 'Selected' : 'Select'}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-6 text-sm text-muted-foreground">
              No memory owners found. Once memories exist in Postgres, their owners appear here.
            </p>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
