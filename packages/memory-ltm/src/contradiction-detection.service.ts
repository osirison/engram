import { Injectable } from '@nestjs/common';
import type { ContradictionMatch, ContradictionCandidate, ContradictionPolicy } from './types';

export const DEFAULT_CONTRADICTION_THRESHOLD = 0.8;
export const DEFAULT_CONTRADICTION_THRESHOLD_MAX = 0.97; // below duplicate zone
/** Conservative default (G3-T4 / Decision 3): keep both rows, hide nothing. */
export const DEFAULT_CONTRADICTION_POLICY: ContradictionPolicy = 'flag';

@Injectable()
export class ContradictionDetectionService {
  private readonly thresholdLow: number;
  private readonly thresholdHigh: number;
  private readonly policy: ContradictionPolicy;

  constructor() {
    this.thresholdLow = this.resolveThreshold(
      process.env.MEMORY_CONTRADICTION_THRESHOLD,
      DEFAULT_CONTRADICTION_THRESHOLD
    );
    this.thresholdHigh = this.resolveThreshold(
      process.env.MEMORY_CONTRADICTION_THRESHOLD_MAX,
      DEFAULT_CONTRADICTION_THRESHOLD_MAX
    );
    // Same consumption pattern as the MEMORY_DECAY_* / threshold vars (G3-T5):
    // the value is schema-validated at boot by @engram/config, and the direct
    // process.env read here falls back to the default on anything invalid.
    this.policy = this.resolvePolicy(process.env.MEMORY_CONTRADICTION_POLICY);
  }

  /**
   * Find the first candidate that contradicts newContent using heuristics.
   *
   * Candidates are filtered to the [thresholdLow, thresholdHigh) similarity
   * band before heuristic checks run — high similarity ensures shared subject
   * matter while staying below the duplicate zone.
   *
   * The match's `action` reflects the boot-configured policy (G3-T4):
   * `flagged` under `flag` (default — both rows kept and marked), `superseded`
   * under `supersede` (latest-wins).
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
          action: this.policy === 'supersede' ? 'superseded' : 'flagged',
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

  /**
   * Annotate a memory as contradicted-but-kept (G3-T4, policy `flag`).
   * Applied symmetrically to BOTH rows of a contradicted pair; each points at
   * its counterpart. Unlike `supersededBy`, this never hides the row — the
   * recall filter keys on `supersededBy`/`status === 'superseded'` only, so a
   * `contradicted` row still surfaces, carrying the review fields. As with the
   * decay-rewritten `status` for superseded rows, `contradictionWith` is the
   * durable marker: `status` may later be recomputed by the importance/decay
   * pass, but the review fields are written once and never cleared.
   */
  annotateContradicted(
    metadata: Record<string, unknown> | null | undefined,
    counterpartId: string,
    reason: string
  ): Record<string, unknown> {
    const next = { ...(metadata ?? {}) };
    next['status'] = 'contradicted';
    next['contradictionWith'] = counterpartId;
    next['contradictionReason'] = reason;
    next['contradictedAt'] = new Date().toISOString();
    return next;
  }

  getLowThreshold(): number {
    return this.thresholdLow;
  }

  getHighThreshold(): number {
    return this.thresholdHigh;
  }

  getPolicy(): ContradictionPolicy {
    return this.policy;
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

    // Same-subject value swap (G3-T6): "editor is vim" vs "editor is emacs".
    // Runs LAST so the cheaper/asymmetric heuristics above keep their reasons.
    return this.checkValueSwap(newLow, existLow);
  }

  /**
   * Deterministic same-subject value-swap detection (G3-T6, Decision 9:
   * lexical only — there is deliberately NO LLM fallback path here or
   * anywhere in contradiction detection).
   *
   * Each side is parsed into a (subject, value) pair via two pattern families:
   *  - relational verbs: "X prefers/uses/likes/loves Y", "X lives in Y",
   *    "X works at/for Y", "X (is) based in Y" — the normalized subject
   *    includes the canonical verb ("qp lives in"), so different relations
   *    never cross-fire;
   *  - copular/assignment: "X is Y", "X = Y", "X: Y" (with optional leading
   *    possessive/article: "my editor is vim" → subject "editor").
   *
   * Fires only when BOTH sides parse, the normalized subjects are identical,
   * and the values genuinely diverge. Deliberately conservative:
   *  - different subjects never fire ("editor is vim" vs "shell is zsh");
   *  - a value that merely elaborates the other (token superset — "vim" vs
   *    "vim with plugins") never fires: an elaboration is not a contradiction,
   *    and a false flag/supersede costs more than a miss;
   *  - a bare-pronoun copular subject ("this is …", "it is …") never fires —
   *    there is no reliable subject to compare.
   */
  private checkValueSwap(newLow: string, existLow: string): string | null {
    const a = this.extractSubjectValue(newLow);
    if (!a) return null;
    const b = this.extractSubjectValue(existLow);
    if (!b) return null;
    if (a.subject !== b.subject) return null;

    const aTokens = this.normalizeValueTokens(a.value);
    const bTokens = this.normalizeValueTokens(b.value);
    if (aTokens.length === 0 || bTokens.length === 0) return null;

    const aValue = aTokens.join(' ');
    const bValue = bTokens.join(' ');
    if (aValue === bValue) return null;
    // Elaboration guard: one value containing every token of the other is a
    // refinement ("vim" ⊂ "vim with plugins"), not a swap.
    if (this.isTokenSubset(aTokens, bTokens) || this.isTokenSubset(bTokens, aTokens)) {
      return null;
    }

    return `value swap: ${a.subject} '${aValue}' vs '${bValue}'`;
  }

  /** Extract a normalized (subject, value) pair, or null when no pattern applies. */
  private extractSubjectValue(content: string): { subject: string; value: string } | null {
    const text = content.trim().replace(/[.!?\s]+$/, '');

    // Relational-verb form first: "qp lives in nyc", "I prefer tabs".
    const verbMatch = text.match(
      /^(.{1,60}?)\s+(?:is\s+)?(prefers?|uses?|likes?|loves?|lives\s+in|works\s+(?:at|for)|based\s+in)\s+(.+)$/
    );
    if (verbMatch) {
      const actor = this.normalizeSubjectTokens(verbMatch[1]!, { allowPronoun: true });
      if (actor) {
        const relation = this.canonicalRelation(verbMatch[2]!);
        return { subject: `${actor} ${relation}`, value: verbMatch[3]! };
      }
    }

    // Copular/assignment form: "editor is vim", "editor = vim", "editor: vim".
    const copularMatch = text.match(/^(.{1,60}?)(?:\s+is\s+|\s*[=:]\s*)(.+)$/);
    if (copularMatch) {
      // A bare pronoun carries no subject identity ("this is fine").
      const subject = this.normalizeSubjectTokens(copularMatch[1]!, { allowPronoun: false });
      if (subject) {
        return { subject, value: copularMatch[2]! };
      }
    }

    return null;
  }

  /** Canonical relation key: singularized verb, collapsed whitespace. */
  private canonicalRelation(raw: string): string {
    const singular: Record<string, string> = {
      prefers: 'prefer',
      uses: 'use',
      likes: 'like',
      loves: 'love',
    };
    const collapsed = raw.toLowerCase().replace(/\s+/g, ' ').trim();
    return singular[collapsed] ?? collapsed;
  }

  /**
   * Normalize a subject phrase: strip leading possessives/articles, reject an
   * empty or (optionally) pronoun-only remainder.
   */
  private normalizeSubjectTokens(raw: string, options: { allowPronoun: boolean }): string | null {
    const determiners = new Set([
      'my',
      'our',
      'your',
      'his',
      'her',
      'their',
      'its',
      'the',
      'a',
      'an',
    ]);
    const pronouns = new Set([
      'i',
      'we',
      'you',
      'he',
      'she',
      'it',
      'they',
      'this',
      'that',
      'these',
      'those',
      'there',
    ]);
    const tokens = raw
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0 && !determiners.has(token));
    if (tokens.length === 0) return null;
    if (!options.allowPronoun && tokens.every((token) => pronouns.has(token))) return null;
    return tokens.join(' ');
  }

  /** Tokenize a value: strip wrapping punctuation and articles. */
  private normalizeValueTokens(raw: string): string[] {
    const articles = new Set(['a', 'an', 'the']);
    return raw
      .trim()
      .split(/\s+/)
      .map((token) => token.replace(/^["'([]+|["')\],.!?;:]+$/g, ''))
      .filter((token) => token.length > 0 && !articles.has(token));
  }

  /** True when every token of `small` occurs in `large`. */
  private isTokenSubset(small: string[], large: string[]): boolean {
    const largeSet = new Set(large);
    return small.every((token) => largeSet.has(token));
  }

  private resolveThreshold(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
  }

  private resolvePolicy(raw: string | undefined): ContradictionPolicy {
    return raw === 'supersede' || raw === 'flag' ? raw : DEFAULT_CONTRADICTION_POLICY;
  }
}
