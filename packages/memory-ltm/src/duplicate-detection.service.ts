import { Injectable } from '@nestjs/common';
import type { DuplicateDetectionMatch } from './types';

const DEFAULT_DUPLICATE_THRESHOLD = 0.97;
type SearchHit = { id: string; score: number };

@Injectable()
export class DuplicateDetectionService {
  private readonly duplicateThreshold: number;

  constructor() {
    this.duplicateThreshold = this.resolveThreshold(process.env.MEMORY_DUPLICATE_THRESHOLD);
  }

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
    return this.duplicateThreshold;
  }

  private resolveThreshold(raw: string | undefined): number {
    const parsed = raw ? Number(raw) : DEFAULT_DUPLICATE_THRESHOLD;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DUPLICATE_THRESHOLD;
  }
}
