import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';

/** Parse an ISO string defensively; returns null on invalid input. */
function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  try {
    const date = parseISO(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/** "3 hours ago" — compact relative time. */
export function relativeTime(iso: string | null | undefined): string {
  const date = toDate(iso);
  if (!date) return '—';
  return `${formatDistanceToNowStrict(date)} ago`;
}

/** "Jun 30, 2026, 14:22" — absolute timestamp for tooltips/detail. */
export function absoluteTime(iso: string | null | undefined): string {
  const date = toDate(iso);
  if (!date) return '—';
  return format(date, 'MMM d, yyyy, HH:mm');
}

/** "Jun 30" — short date for chart axes. */
export function shortDate(iso: string | null | undefined): string {
  const date = toDate(iso);
  if (!date) return '';
  return format(date, 'MMM d');
}

/** Thousands-separated integer, or "—" for nullish. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat().format(value);
}

/** Percentage from a ratio in [0,1]. */
export function formatPercent(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** Humanise a duration in seconds, e.g. "3d 4h" or "12m". */
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/**
 * Countdown to an expiry instant (WP2 T3), e.g. "expires in 3h 12m",
 * "expires in 45s", or "expired" once past. `nowMs` is injectable for tests.
 */
export function formatCountdown(
  expiresAt: string | null | undefined,
  nowMs: number = Date.now()
): string {
  if (!expiresAt) return '—';
  const remainingMs = new Date(expiresAt).getTime() - nowMs;
  if (Number.isNaN(remainingMs)) return '—';
  if (remainingMs <= 0) return 'expired';
  const s = Math.floor(remainingMs / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `expires in ${d}d ${h}h`;
  if (h > 0) return `expires in ${h}h ${m}m`;
  if (m > 0) return `expires in ${m}m`;
  return `expires in ${s % 60}s`;
}

/** Seconds until an expiry instant (WP2 T3); negative once past, null if absent. */
export function secondsUntil(
  expiresAt: string | null | undefined,
  nowMs: number = Date.now()
): number | null {
  if (!expiresAt) return null;
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((t - nowMs) / 1000);
}

/** Title-case a memory type for display. */
export function memoryTypeLabel(type: string): string {
  if (type === 'short-term') return 'Short-term';
  if (type === 'long-term') return 'Long-term';
  return type;
}

/** Truncate to `max` chars with an ellipsis. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

/** Initials from a name or email for avatar fallbacks. */
export function initials(nameOrEmail: string | null | undefined): string {
  if (!nameOrEmail) return '?';
  const base = nameOrEmail.includes('@') ? nameOrEmail.split('@')[0]! : nameOrEmail;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return base.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
}
