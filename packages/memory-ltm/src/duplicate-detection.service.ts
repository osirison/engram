import { Injectable } from '@nestjs/common';
import type { DuplicateDetectionMatch } from './types';

const DEFAULT_DUPLICATE_THRESHOLD = 0.97;
type SearchHit = { id: string; score: number };

const readEnv = (name: string): string | undefined => {
  const globalValue = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return globalValue.process?.env?.[name];
};

@Injectable()
export class DuplicateDetectionService {
  findMatch(
    hits: SearchHit[],
    currentId?: string,
    threshold: number = this.threshold()
  ): DuplicateDetectionMatch | null {
    if (!Number.isFinite(threshold) || threshold <= 0 || hits.length === 0) {
      return null;
    }
    const hit = hits.find(
      (candidate) => candidate.id !== currentId && candidate.score >= threshold
    );
    if (!hit) {
      return null;
    }
    return { memoryId: hit.id, score: hit.score };
  }

  annotateMetadata(
    metadata: Record<string, unknown> | null | undefined,
    match: DuplicateDetectionMatch,
    summary: string
  ): Record<string, unknown> {
    const nextMetadata = { ...(metadata ?? {}) };
    const existing = Array.isArray(nextMetadata['duplicateMatches'])
      ? (nextMetadata['duplicateMatches'] as unknown[])
      : [];
    nextMetadata['duplicateMatches'] = [
      ...existing,
      {
        memoryId: match.memoryId,
        score: match.score,
        summary,
        detectedAt: new Date().toISOString(),
      },
    ];
    return nextMetadata;
  }

  threshold(): number {
    const raw = readEnv('MEMORY_DUPLICATE_THRESHOLD');
    const parsed = raw ? Number(raw) : DEFAULT_DUPLICATE_THRESHOLD;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DUPLICATE_THRESHOLD;
  }
}
