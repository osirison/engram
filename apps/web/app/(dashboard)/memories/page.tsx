import { Suspense } from 'react';

import { MemoryNavigator } from '@/components/memories/memory-navigator';
import { PageContainer, PageHeader } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';

function NavigatorFallback() {
  return (
    <PageContainer>
      <PageHeader title="Memories" description="Browse, search, and manage memories" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-64 w-full" />
    </PageContainer>
  );
}

export default function MemoriesPage() {
  return (
    <Suspense fallback={<NavigatorFallback />}>
      <MemoryNavigator />
    </Suspense>
  );
}
