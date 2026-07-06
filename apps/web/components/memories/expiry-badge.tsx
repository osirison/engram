'use client';

import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { formatCountdown, secondsUntil } from '@/lib/format';

/** Below this many seconds remaining, the badge turns destructive (WP2 T3/D4). */
const NEAR_EXPIRY_SECONDS = 15 * 60;

/**
 * Live TTL countdown for a short-term memory (WP2 T3). Re-renders every 30s so
 * the remaining time stays honest; within 15 minutes of expiry it switches to a
 * destructive "Expiring soon" style.
 */
export function ExpiryBadge({ expiresAt }: { expiresAt: string | null }) {
  // A ticking clock; the value itself is derived from `expiresAt` on each render.
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!expiresAt) return null;
  const remaining = secondsUntil(expiresAt, nowMs);
  const nearExpiry = remaining !== null && remaining <= NEAR_EXPIRY_SECONDS;
  return (
    <Badge variant={nearExpiry ? 'destructive' : 'muted'}>
      {nearExpiry && remaining !== null && remaining > 0 ? 'Expiring soon · ' : ''}
      {formatCountdown(expiresAt, nowMs)}
    </Badge>
  );
}
