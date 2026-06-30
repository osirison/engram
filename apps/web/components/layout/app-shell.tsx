'use client';

import * as React from 'react';
import Link from 'next/link';
import { Menu } from 'lucide-react';

import { SidebarNav } from '@/components/layout/sidebar-nav';
import { ScopeSwitcher } from '@/components/layout/scope-switcher';
import { UserMenu, type SessionUser } from '@/components/layout/user-menu';
import { EngramMark } from '@/components/provider-icons';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { UserScopeProvider } from '@/components/user-scope';

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <EngramMark />
      <span>ENGRAM</span>
      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Console
      </span>
    </Link>
  );
}

export function AppShell({
  user,
  initialUserId,
  children,
}: {
  user: SessionUser;
  initialUserId: string;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <UserScopeProvider initialUserId={initialUserId}>
      <div className="grid min-h-svh grid-cols-1 lg:grid-cols-[16rem_1fr]">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-svh flex-col border-r bg-sidebar text-sidebar-foreground lg:flex">
          <div className="flex h-14 items-center border-b px-5">
            <Brand />
          </div>
          <div className="flex-1 overflow-y-auto">
            <SidebarNav />
          </div>
          <div className="border-t p-4 text-xs text-muted-foreground">
            <p>Memory engine console</p>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
            {/* Mobile nav trigger */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="lg:hidden"
                  aria-label="Open navigation"
                >
                  <Menu className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <SheetTitle className="flex h-14 items-center border-b px-5">
                  <Brand />
                </SheetTitle>
                <SidebarNav onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>

            <div className="lg:hidden">
              <Brand />
            </div>

            <div className="ml-auto flex items-center gap-2">
              <ScopeSwitcher />
              <UserMenu user={user} />
            </div>
          </header>

          <main className="flex-1 overflow-x-hidden">{children}</main>
        </div>
      </div>
    </UserScopeProvider>
  );
}
