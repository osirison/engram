import { Injectable } from '@nestjs/common';
import type { ImportanceScoreResult, ImportanceSignals } from './types';

const DEFAULT_HALF_LIFE_DAYS = 14;
const BASE_IMPORTANCE = 0.35;
const MAX_ACCESS_BOOST = 0.25;

const readEnv = (name: string): string | undefined => {
  const globalValue = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return globalValue.process?.env?.[name];
};

@Injectable()
export class ImportanceScoringService {
  score(signals: ImportanceSignals, now: Date = new Date()): ImportanceScoreResult {
    const metadata = signals.metadata ?? {};
    const accessCount = this.readNumber(signals.accessCount ?? metadata['accessCount']) ?? 0;
    const pinned = this.readBoolean(signals.pinned ?? metadata['pinned']) ?? false;
    const lastAccessedAt = this.readDate(signals.lastAccessedAt ?? metadata['lastAccessedAt']);
    const createdAt = signals.createdAt ?? this.readDate(metadata['createdAt']) ?? now;
    const ageSource = lastAccessedAt ?? createdAt;
    const ageDays = Math.max(0, (now.getTime() - ageSource.getTime()) / 86_400_000);
    const halfLifeDays =
      this.readPositiveNumber(readEnv('MEMORY_IMPORTANCE_HALF_LIFE_DAYS')) ??
      DEFAULT_HALF_LIFE_DAYS;
    const recencyMultiplier = pinned ? 1 : Math.exp((-Math.LN2 * ageDays) / halfLifeDays);
    const accessBoost = Math.min(MAX_ACCESS_BOOST, 0.04 * Math.log2(accessCount + 1));

    const reasons: string[] = [];
    let cueBoost = 0;
    if (this.matches(signals.content, ['decision', 'decided', 'resolved'])) {
      cueBoost += 0.18;
      reasons.push('decision cue');
    }
    if (this.matches(signals.content, ['problem', 'incident', 'bug', 'failure', 'error'])) {
      cueBoost += 0.12;
      reasons.push('problem cue');
    }
    if (this.matches(signals.content, ['milestone', 'launch', 'release', 'deadline'])) {
      cueBoost += 0.1;
      reasons.push('milestone cue');
    }
    if (
      (signals.tags ?? []).some((tag) =>
        ['critical', 'important', 'pinned'].includes(tag.toLowerCase())
      )
    ) {
      cueBoost += 0.08;
      reasons.push('priority tag');
    }

    const pinBoost = pinned ? 0.25 : 0;
    const rawScore = (BASE_IMPORTANCE + accessBoost + cueBoost + pinBoost) * recencyMultiplier;
    const score = pinned ? Math.max(0.9, this.clamp(rawScore)) : this.clamp(rawScore);

    let status: ImportanceScoreResult['status'] = 'active';
    if (pinned) {
      status = 'pinned';
      reasons.push('pinned');
    } else if (score < 0.15 && ageDays >= 30) {
      status = 'archived';
      reasons.push('archive candidate');
    } else if (score < 0.3) {
      status = 'stale';
      reasons.push('stale');
    }
    if (accessCount > 0) {
      reasons.push('reinforced by access');
    }

    return {
      score,
      status,
      factors: {
        base: BASE_IMPORTANCE,
        recencyMultiplier,
        accessBoost,
        cueBoost,
        pinBoost,
      },
      reasons,
    };
  }

  annotateMetadata(
    metadata: Record<string, unknown> | null | undefined,
    signals: ImportanceSignals,
    now: Date = new Date()
  ): Record<string, unknown> {
    const nextMetadata = { ...(metadata ?? {}) };
    const scored = this.score({ ...signals, metadata: nextMetadata }, now);
    const accessCount = this.readNumber(signals.accessCount ?? nextMetadata['accessCount']) ?? 0;
    const lastAccessedAt =
      this.readDate(signals.lastAccessedAt ?? nextMetadata['lastAccessedAt']) ?? now;
    nextMetadata['importance'] = scored.score;
    nextMetadata['importanceFactors'] = scored.factors;
    nextMetadata['importanceReasons'] = scored.reasons;
    nextMetadata['status'] = scored.status;
    nextMetadata['accessCount'] = accessCount;
    nextMetadata['lastAccessedAt'] = lastAccessedAt.toISOString();
    if (signals.pinned ?? nextMetadata['pinned']) {
      nextMetadata['pinned'] = true;
    }
    return nextMetadata;
  }

  private matches(content: string, terms: string[]): boolean {
    const lower = content.toLowerCase();
    return terms.some((term) => lower.includes(term));
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private readPositiveNumber(value: unknown): number | null {
    return typeof value === 'string' && Number.isFinite(Number(value)) && Number(value) > 0
      ? Number(value)
      : null;
  }

  private readBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
  }

  private readDate(value: unknown): Date | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }
    if (typeof value === 'string') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
  }
}
