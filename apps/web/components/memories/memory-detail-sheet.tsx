'use client';

import * as React from 'react';
import { Copy, Loader2, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { TagInput } from '@/components/memories/tag-input';
import { ErrorState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { absoluteTime, formatPercent, memoryTypeLabel, relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { trpc } from '@/trpc/react';

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

export function MemoryDetailSheet({
  userId,
  memoryId,
  score,
  open,
  onOpenChange,
}: {
  userId: string;
  memoryId: string | null;
  score?: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const capabilities = trpc.meta.capabilities.useQuery(undefined, { staleTime: 5 * 60_000 });
  const canWrite = capabilities.data?.writes ?? false;

  const memory = trpc.memory.get.useQuery(
    { userId, memoryId: memoryId ?? '' },
    { enabled: open && Boolean(memoryId) }
  );

  const [isEditing, setIsEditing] = React.useState(false);
  const [draftContent, setDraftContent] = React.useState('');
  const [draftTags, setDraftTags] = React.useState<string[]>([]);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  // Reset transient edit/confirm UI whenever the target memory changes or the
  // sheet closes — the canonical "reset state on prop change" effect.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsEditing(false);
    setConfirmingDelete(false);
  }, [memoryId, open]);

  const beginEdit = () => {
    if (!memory.data) return;
    setDraftContent(memory.data.content);
    setDraftTags(memory.data.tags);
    setIsEditing(true);
  };

  const invalidate = async () => {
    await Promise.all([
      utils.memory.list.invalidate(),
      utils.memory.search.invalidate(),
      utils.analytics.invalidate(),
      memoryId ? utils.memory.get.invalidate({ userId, memoryId }) : Promise.resolve(),
    ]);
  };

  const update = trpc.memory.update.useMutation({
    onSuccess: async () => {
      toast.success('Memory updated');
      setIsEditing(false);
      await invalidate();
    },
    onError: (error) => toast.error('Update failed', { description: error.message }),
  });

  const remove = trpc.memory.delete.useMutation({
    onSuccess: async () => {
      toast.success('Memory deleted');
      onOpenChange(false);
      await invalidate();
    },
    onError: (error) => toast.error('Delete failed', { description: error.message }),
  });

  const saveEdit = () => {
    if (!memoryId) return;
    update.mutate({
      userId,
      memoryId,
      content: draftContent,
      tags: draftTags,
      scope: memory.data?.scope ?? undefined,
    });
  };

  const data = memory.data;
  const writeBlockedReason = canWrite
    ? undefined
    : 'Editing requires a configured ENGRAM server (ENGRAM_MCP_URL).';

  const copyId = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.id);
      toast.success('Memory ID copied');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-2">
            <SheetTitle>Memory</SheetTitle>
            {data && (
              <Badge variant={data.type === 'long-term' ? 'secondary' : 'muted'}>
                {memoryTypeLabel(data.type)}
              </Badge>
            )}
            {data?.isInsight && <Badge variant="outline">Insight</Badge>}
          </div>
          <SheetDescription className="sr-only">
            Inspect and manage a single memory.
          </SheetDescription>
          {data && (
            <button
              type="button"
              onClick={copyId}
              className="flex w-fit items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
              title="Copy memory ID"
            >
              {data.id}
              <Copy className="size-3" />
            </button>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6">
          {memory.isError ? (
            <ErrorState message={memory.error.message} onRetry={() => void memory.refetch()} />
          ) : memory.isLoading || !data ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : (
            <div className="space-y-6 pb-6">
              <section className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Content
                </h3>
                {isEditing ? (
                  <Textarea
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                    className="min-h-40 font-normal"
                    aria-label="Memory content"
                  />
                ) : (
                  <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm leading-relaxed">
                    {data.content}
                  </p>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Tags
                </h3>
                {isEditing ? (
                  <TagInput value={draftTags} onChange={setDraftTags} />
                ) : data.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {data.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No tags</p>
                )}
              </section>

              <section>
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Details
                </h3>
                <div className="divide-y rounded-md border px-3">
                  <MetaRow label="User">
                    <span className="font-mono text-xs">{data.userId}</span>
                  </MetaRow>
                  <MetaRow label="Scope">
                    {data.scope ? <span className="font-mono text-xs">{data.scope}</span> : '—'}
                  </MetaRow>
                  {typeof score === 'number' && (
                    <MetaRow label="Relevance">{formatPercent(score, 1)}</MetaRow>
                  )}
                  <MetaRow label="Importance">
                    {data.importance !== null ? data.importance.toFixed(2) : '—'}
                  </MetaRow>
                  <MetaRow label="Embedding">
                    {data.hasEmbedding ? 'Indexed' : 'Not indexed'}
                  </MetaRow>
                  <MetaRow label="Created">
                    <span title={absoluteTime(data.createdAt)}>{relativeTime(data.createdAt)}</span>
                  </MetaRow>
                  <MetaRow label="Updated">
                    <span title={absoluteTime(data.updatedAt)}>{relativeTime(data.updatedAt)}</span>
                  </MetaRow>
                  {data.expiresAt && (
                    <MetaRow label="Expires">
                      <span title={absoluteTime(data.expiresAt)}>
                        {relativeTime(data.expiresAt)}
                      </span>
                    </MetaRow>
                  )}
                </div>
              </section>

              {data.metadata && Object.keys(data.metadata).length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Metadata
                  </h3>
                  <pre className="max-h-64 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs leading-relaxed">
                    {JSON.stringify(data.metadata, null, 2)}
                  </pre>
                </section>
              )}
            </div>
          )}
        </div>

        {data && (
          <>
            <Separator />
            <SheetFooter className="flex-row items-center justify-end gap-2 pt-4">
              {isEditing ? (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => setIsEditing(false)}
                    disabled={update.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={saveEdit}
                    disabled={update.isPending || draftContent.trim().length === 0}
                  >
                    {update.isPending && <Loader2 className="size-4 animate-spin" />}
                    Save changes
                  </Button>
                </>
              ) : confirmingDelete ? (
                <>
                  <span className="mr-auto text-sm text-muted-foreground">Delete this memory?</span>
                  <Button
                    variant="ghost"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={remove.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() =>
                      remove.mutate({ userId, memoryId: data.id, scope: data.scope ?? undefined })
                    }
                    disabled={remove.isPending}
                  >
                    {remove.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                    Delete
                  </Button>
                </>
              ) : (
                <WriteActions
                  canWrite={canWrite}
                  reason={writeBlockedReason}
                  onEdit={beginEdit}
                  onDelete={() => setConfirmingDelete(true)}
                />
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function WriteActions({
  canWrite,
  reason,
  onEdit,
  onDelete,
}: {
  canWrite: boolean;
  reason?: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  if (canWrite) {
    return (
      <>
        <Button variant="outline" onClick={onEdit}>
          <Pencil className="size-4" /> Edit
        </Button>
        <Button variant="outline" onClick={onDelete} className="text-destructive">
          <Trash2 className="size-4" /> Delete
        </Button>
      </>
    );
  }

  // Writes disabled: keep the buttons focusable (aria-disabled, not `disabled`)
  // so the explanatory tooltip is reachable by keyboard and screen readers.
  const blocked = (label: string, Icon: typeof Pencil, extra?: string) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          aria-disabled
          onClick={(e) => e.preventDefault()}
          className={cn('cursor-not-allowed opacity-50', extra)}
        >
          <Icon className="size-4" /> {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{reason ?? 'Writes are disabled'}</TooltipContent>
    </Tooltip>
  );

  return (
    <>
      {blocked('Edit', Pencil)}
      {blocked('Delete', Trash2, 'text-destructive')}
    </>
  );
}
