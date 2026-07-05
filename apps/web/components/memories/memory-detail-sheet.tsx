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
  // Optimistic-concurrency conflict UI (WP2 T4/D5): set when a save is rejected
  // because another writer moved the version. `preservedDraft` keeps the
  // operator's rejected text so a reload never silently discards their work.
  const [conflict, setConflict] = React.useState(false);
  const [preservedDraft, setPreservedDraft] = React.useState<string | null>(null);

  // Reset transient edit/confirm UI whenever the target memory changes or the
  // sheet closes — the canonical "reset state on prop change" effect.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsEditing(false);
    setConfirmingDelete(false);
    setConflict(false);
    setPreservedDraft(null);
    setHistoryOpen(false);
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
      setConflict(false);
      setPreservedDraft(null);
      await invalidate();
    },
    onError: (error) => {
      // A version conflict is expected control-flow, not a failure toast: surface
      // the reload-and-rediff panel instead (WP2 T4/D5).
      if (error.data?.code === 'CONFLICT') {
        setConflict(true);
        return;
      }
      toast.error('Update failed', { description: error.message });
    },
  });

  // Pull the latest server copy into the editor after a conflict, stashing the
  // operator's rejected text so it is never lost. The next save carries the
  // fresh version, so it will succeed unless another write races again.
  const reloadLatest = async () => {
    setPreservedDraft(draftContent);
    const fresh = await memory.refetch();
    if (fresh.data) {
      setDraftContent(fresh.data.content);
      setDraftTags(fresh.data.tags);
    }
    setConflict(false);
  };

  const remove = trpc.memory.delete.useMutation({
    onSuccess: async () => {
      toast.success('Memory deleted');
      onOpenChange(false);
      await invalidate();
    },
    onError: (error) => toast.error('Delete failed', { description: error.message }),
  });

  // Repair a stale vector by regenerating the embedding for current content (T7).
  const reembed = trpc.memory.reembed.useMutation({
    onSuccess: async () => {
      toast.success('Memory re-embedded');
      await invalidate();
    },
    onError: (error) => toast.error('Re-embed failed', { description: error.message }),
  });

  // Audit history (WP2 T5) — collapsed by default; fetched lazily on expand.
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const auditLog = trpc.memory.auditLog.useQuery(
    { userId, memoryId: memoryId ?? '', limit: 50 },
    { enabled: open && historyOpen && Boolean(memoryId) }
  );

  const restore = trpc.memory.restore.useMutation({
    onSuccess: async () => {
      toast.success('Memory restored');
      await Promise.all([invalidate(), auditLog.refetch()]);
    },
    onError: (error) => toast.error('Restore failed', { description: error.message }),
  });

  const saveEdit = () => {
    if (!memoryId) return;
    setConflict(false);
    update.mutate({
      userId,
      memoryId,
      content: draftContent,
      tags: draftTags,
      scope: memory.data?.scope ?? undefined,
      // Optimistic concurrency (WP2 T4): the save is rejected with CONFLICT if the
      // memory has moved past the version we loaded/reloaded.
      expectedVersion: memory.data?.version,
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
              {isEditing && conflict && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
                >
                  <p className="font-medium text-destructive">
                    This memory changed since you opened it
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Another writer updated it, so your save was rejected. Reload the latest version
                    to continue — your unsaved text is preserved below.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={reloadLatest}
                  >
                    Reload latest
                  </Button>
                </div>
              )}
              {isEditing && preservedDraft !== null && (
                <details className="rounded-md border bg-muted/30 p-3 text-sm">
                  <summary className="cursor-pointer font-medium">
                    Your previous unsaved edit
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{preservedDraft}</p>
                </details>
              )}
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
                    <span className="flex flex-wrap items-center gap-2">
                      {data.embeddingStale ? (
                        <span className="text-destructive">
                          Stale — content changed but the vector didn’t
                        </span>
                      ) : data.hasEmbedding ? (
                        'Indexed'
                      ) : (
                        'Not indexed'
                      )}
                      {canWrite &&
                        data.type === 'long-term' &&
                        (data.embeddingStale || !data.hasEmbedding) && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={reembed.isPending}
                            onClick={() =>
                              reembed.mutate({
                                userId,
                                memoryId: data.id,
                                scope: data.scope ?? undefined,
                              })
                            }
                          >
                            {reembed.isPending && <Loader2 className="size-4 animate-spin" />}
                            Re-embed
                          </Button>
                        )}
                    </span>
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

              {/* History (WP2 T5): audit trail with a restore path for deletes. */}
              <section className="space-y-2">
                <button
                  type="button"
                  onClick={() => setHistoryOpen((v) => !v)}
                  className="text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
                >
                  {historyOpen ? '▾' : '▸'} History
                </button>
                {historyOpen && (
                  <div className="space-y-2">
                    {auditLog.isLoading && (
                      <p className="text-sm text-muted-foreground">Loading history…</p>
                    )}
                    {auditLog.data && auditLog.data.length === 0 && (
                      <p className="text-sm text-muted-foreground">No recorded changes.</p>
                    )}
                    {auditLog.data?.map((entry) => (
                      <div key={entry.id} className="rounded-md border p-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{entry.action}</Badge>
                          <span
                            className="text-muted-foreground"
                            title={absoluteTime(entry.createdAt)}
                          >
                            {relativeTime(entry.createdAt)}
                          </span>
                          {entry.actorLabel && (
                            <span className="text-muted-foreground">by {entry.actorLabel}</span>
                          )}
                          {entry.delegated && <Badge variant="muted">delegated</Badge>}
                          {entry.action === 'delete' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="ml-auto"
                              disabled={restore.isPending}
                              onClick={() => restore.mutate({ userId, memoryId: data.id })}
                            >
                              {restore.isPending && <Loader2 className="size-4 animate-spin" />}
                              Restore
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
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
