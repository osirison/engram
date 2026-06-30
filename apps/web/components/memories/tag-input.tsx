'use client';

import * as React from 'react';
import { X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** A lightweight chip-based tag editor. */
export function TagInput({
  value,
  onChange,
  disabled,
  placeholder = 'Add a tag…',
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = React.useState('');

  const add = (raw: string) => {
    const tag = raw.trim();
    if (!tag || value.includes(tag)) {
      setDraft('');
      return;
    }
    onChange([...value, tag]);
    setDraft('');
  };

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  return (
    <div
      className={cn(
        'flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent p-1.5 shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      {value.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-1 pr-1">
          {tag}
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => remove(tag)}
              className="rounded-sm opacity-60 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          )}
        </Badge>
      ))}
      <input
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && value.length > 0) {
            remove(value[value.length - 1]!);
          }
        }}
        onBlur={() => draft && add(draft)}
        placeholder={value.length === 0 ? placeholder : ''}
        className="min-w-[8ch] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
    </div>
  );
}
