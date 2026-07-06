'use client';

import * as React from 'react';
import { Download, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Options chosen in the export dialog (WP3 T8). */
export interface ExportOptions {
  includeStm: boolean;
  /** `single` = one anchored file; `multi` = one note per memory (default). */
  singleFile: boolean;
}

/**
 * Export options + confirm dialog (WP3 T8). Pure UI: it owns the option toggles
 * and calls `onConfirm` — the mutation, zip decode, and download live in the
 * navigator (mirrors `BulkDeleteDialog`). The current view's tag/scope/type
 * filters are applied by the caller; this dialog only picks tier + layout.
 */
export function ExportDialog({
  open,
  onOpenChange,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onConfirm: (options: ExportOptions) => void;
}) {
  const [includeStm, setIncludeStm] = React.useState(false);
  const [singleFile, setSingleFile] = React.useState(false);

  // Reset the options whenever the dialog re-opens.
  React.useEffect(() => {
    if (open) {
      setIncludeStm(false);
      setSingleFile(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export memories</DialogTitle>
          <DialogDescription>
            Download an Obsidian-compatible markdown vault (frontmatter + wikilinks) as a zip. The
            current tag, scope, and type filters are applied. Embeddings are not included.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={includeStm}
              onCheckedChange={(checked) => setIncludeStm(checked === true)}
              disabled={isPending}
              aria-label="Include short-term memories"
            />
            <span>
              Include short-term memories
              <span className="block text-xs text-muted-foreground">
                Their TTL is a point-in-time snapshot and is not preserved.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={singleFile}
              onCheckedChange={(checked) => setSingleFile(checked === true)}
              disabled={isPending}
              aria-label="Export as a single file"
            />
            <span>
              Single file
              <span className="block text-xs text-muted-foreground">
                One anchored document instead of one note per memory.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm({ includeStm, singleFile })} disabled={isPending}>
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
