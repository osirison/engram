import { Injectable } from '@nestjs/common';
import type { ContradictionMatch, ContradictionCandidate } from './types';

export const DEFAULT_CONTRADICTION_THRESHOLD = 0.8;
export const DEFAULT_CONTRADICTION_THRESHOLD_MAX = 0.97; // below duplicate zone

@Injectable()
export class ContradictionDetectionService {
  private readonly thresholdLow: number;
  private readonly thresholdHigh: number;

  constructor() {
    this.thresholdLow = this.resolveThreshold(
      process.env.MEMORY_CONTRADICTION_THRESHOLD,
      DEFAULT_CONTRADICTION_THRESHOLD
    );
    this.thresholdHigh = this.resolveThreshold(
      process.env.MEMORY_CONTRADICTION_THRESHOLD_MAX,
      DEFAULT_CONTRADICTION_THRESHOLD_MAX
    );
  }

  /**
   * Find the first candidate that contradicts newContent using heuristics.
   *
   * Candidates are filtered to the [thresholdLow, thresholdHigh) similarity
   * band before heuristic checks run — high similarity ensures shared subject
   * matter while staying below the duplicate zone.
   */
  detect(newContent: string, candidates: ContradictionCandidate[]): ContradictionMatch | null {
    const inBand = candidates.filter(
      (c) => c.score >= this.thresholdLow && c.score < this.thresholdHigh
    );

    for (const candidate of inBand) {
      const reason = this.checkHeuristics(newContent, candidate.content);
      if (reason) {
        return {
          memoryId: candidate.id,
          score: candidate.score,
          action: 'superseded',
          reason,
        };
      }
    }
    return null;
  }

  /** Annotate the new memory's metadata to record the contradiction it introduces. */
  annotateContradictor(
    metadata: Record<string, unknown> | null | undefined,
    match: ContradictionMatch,
    existingContentSummary: string
  ): Record<string, unknown> {
    const next = { ...(metadata ?? {}) };
    const existing = Array.isArray(next['contradictionMatches'])
      ? (next['contradictionMatches'] as unknown[])
      : [];
    next['contradictionMatches'] = [
      ...existing,
      {
        memoryId: match.memoryId,
        score: match.score,
        action: match.action,
        reason: match.reason,
        summary: existingContentSummary.slice(0, 120),
        detectedAt: new Date().toISOString(),
      },
    ];
    return next;
  }

  /** Annotate the old memory's metadata to record that it was superseded. */
  annotateSuperseded(
    metadata: Record<string, unknown> | null | undefined,
    supersededById: string,
    reason: string
  ): Record<string, unknown> {
    const next = { ...(metadata ?? {}) };
    next['status'] = 'superseded';
    next['supersededBy'] = supersededById;
    next['supersededReason'] = reason;
    next['supersededAt'] = new Date().toISOString();
    return next;
  }

  getLowThreshold(): number {
    return this.thresholdLow;
  }

  getHighThreshold(): number {
    return this.thresholdHigh;
  }

  private checkHeuristics(newContent: string, existingContent: string): string | null {
    const newLow = newContent.toLowerCase();
    const existLow = existingContent.toLowerCase();

    // Negation asymmetry: one side uses negation, the other does not.
    const negationRe =
      /\b(not|don't|doesn't|didn't|never|isn't|aren't|won't|can't|cannot|no longer|stopped|quit)\b/i;
    if (negationRe.test(newLow) !== negationRe.test(existLow)) {
      return 'negation asymmetry';
    }

    // Change indicators: new memory signals an update superseding prior state.
    const changeRe =
      /\b(changed|now I|actually|instead|rather|switched|moved|no longer|updated|revised)\b/i;
    if (changeRe.test(newLow) && !changeRe.test(existLow)) {
      return 'change indicator in new memory';
    }

    // Polar-opposite word pairs within otherwise similar content.
    const polarPairs: Array<[string, string]> = [
      ['like', 'dislike'],
      ['prefer', 'avoid'],
      ['love', 'hate'],
      ['always', 'never'],
      ['agree', 'disagree'],
      ['correct', 'incorrect'],
      ['true', 'false'],
    ];
    for (const [a, b] of polarPairs) {
      const newA = new RegExp(`\\b${a}\\b`, 'i').test(newLow);
      const newB = new RegExp(`\\b${b}\\b`, 'i').test(newLow);
      const exA = new RegExp(`\\b${a}\\b`, 'i').test(existLow);
      const exB = new RegExp(`\\b${b}\\b`, 'i').test(existLow);
      if ((newA && exB) || (newB && exA)) {
        return `polar opposite: ${a}/${b}`;
      }
    }

    return null;
  }

  private resolveThreshold(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
  }
}
