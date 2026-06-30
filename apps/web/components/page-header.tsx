import * as React from 'react';

import { cn } from '@/lib/utils';

/** Consistent page padding + max width for every dashboard page. */
export function PageContainer({ className, children }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8', className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
