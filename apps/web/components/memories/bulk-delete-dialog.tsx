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

/**
 * Hardened bulk-delete confirmation (WP2 T6/D7). Shows the count and a preview of
 * the first few contents; for large selections (>10) it gates the destructive
 * action behind typing the word "delete".
 */
export function BulkDeleteDialog({
  open,
  onOpenChange,
  count,
  previews,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  /** Contents of (up to) the first few selected memories, for context. */
  previews: string[];
  isPending: boolean;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = React.useState('');

  // Reset the typed guard whenever the dialog re-opens.
  React.useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const needsTyped = count > TYPE_TO_CONFIRM_THRESHOLD;
  const confirmDisabled = isPending || (needsTyped && typed.trim().toLowerCase() !== CONFIRM_WORD);

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
