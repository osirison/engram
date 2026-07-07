'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { truncate } from '@/lib/format';

/** Above this many, deletion requires typing the confirm word — WP2 T6/D7. */
const TYPE_TO_CONFIRM_THRESHOLD = 10;
const CONFIRM_WORD = 'delete';

/** Per-item outcome of a bulk delete (WP2 T6/D9). */
export type BulkDeleteOutcome = {
  deleted: string[];
  failed: Array<{ id: string; reason: string }>;
};

/**
 * Hardened bulk-delete confirmation (WP2 T6/D7). Shows the count and a preview of
 * the first few contents; for large selections (>10) it gates the destructive
 * action behind typing the word "delete". When a completed `result` carries
 * per-item failures, the dialog switches to an outcome view with an expandable
 * failure list instead of closing silently.
 */
export function BulkDeleteDialog({
  open,
  onOpenChange,
  count,
  previews,
  isPending,
  onConfirm,
  result,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  /** Contents of (up to) the first few selected memories, for context. */
  previews: string[];
  isPending: boolean;
  onConfirm: () => void;
  /** Set after a partial-failure run so the operator can see what failed. */
  result?: BulkDeleteOutcome | null;
}) {
  const [typed, setTyped] = React.useState('');

  // Reset the typed guard whenever the dialog re-opens.
  React.useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const needsTyped = count > TYPE_TO_CONFIRM_THRESHOLD;
  const confirmDisabled = isPending || (needsTyped && typed.trim().toLowerCase() !== CONFIRM_WORD);

  // Outcome view: a completed run left some items undeleted. Show what failed and
  // why; the successful ids are already gone from the list.
  if (result && result.failed.length > 0) {
    const total = result.deleted.length + result.failed.length;
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Deleted {result.deleted.length} of {total}
            </DialogTitle>
            <DialogDescription>
              {result.failed.length} memor{result.failed.length === 1 ? 'y' : 'ies'} could not be
              deleted. Successful deletions have already been removed from the list.
            </DialogDescription>
          </DialogHeader>

          <details className="rounded-md border bg-muted/30 p-2 text-sm" open>
            <summary className="cursor-pointer font-medium">
              Show {result.failed.length} failure{result.failed.length === 1 ? '' : 's'}
            </summary>
            <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
              {result.failed.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-3">
                  <span className="truncate font-mono text-xs text-muted-foreground">{f.id}</span>
                  <span className="shrink-0 text-xs text-destructive">{f.reason}</span>
                </li>
              ))}
            </ul>
          </details>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {count} memories?</DialogTitle>
          <DialogDescription>
            This permanently deletes the selected memories. Deleted items can be restored from their
            history while an audit record exists.
          </DialogDescription>
        </DialogHeader>

        {previews.length > 0 && (
          <ul className="max-h-40 space-y-1 overflow-auto rounded-md bg-muted/40 p-2 text-sm">
            {previews.map((content, i) => (
              <li key={i} className="truncate text-muted-foreground">
                {truncate(content, 80)}
              </li>
            ))}
            {count > previews.length && (
              <li className="text-xs text-muted-foreground">…and {count - previews.length} more</li>
            )}
          </ul>
        )}

        {needsTyped && (
          <div className="space-y-1">
            <label htmlFor="bulk-confirm" className="text-sm text-muted-foreground">
              Type <span className="font-mono font-medium text-foreground">delete</span> to confirm
            </label>
            <Input
              id="bulk-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              aria-label="Type delete to confirm"
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={confirmDisabled}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Delete {count}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
