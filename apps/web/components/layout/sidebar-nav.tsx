'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { isActiveRoute, navItems } from '@/components/layout/nav-config';
import { cn } from '@/lib/utils';

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 px-3 py-4" aria-label="Primary">
      {navItems.map((item) => {
        const active = isActiveRoute(item, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            title={item.description}
            className={cn(
              'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
            )}
          >
            <span
              aria-hidden
              className={cn(
                'absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand transition-opacity',
                active ? 'opacity-100' : 'opacity-0'
              )}
            />
            <Icon className={cn('size-4 shrink-0', active ? 'text-foreground' : '')} />
            {item.title}
          </Link>
        );
      })}
    </nav>
  );
}
