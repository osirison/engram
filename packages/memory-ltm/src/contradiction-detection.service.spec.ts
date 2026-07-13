import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ContradictionDetectionService,
  DEFAULT_CONTRADICTION_THRESHOLD,
  DEFAULT_CONTRADICTION_THRESHOLD_MAX,
  DEFAULT_CONTRADICTION_POLICY,
} from './contradiction-detection.service';
import type { ContradictionCandidate } from './types';

const THRESHOLD = DEFAULT_CONTRADICTION_THRESHOLD;
const THRESHOLD_MAX = DEFAULT_CONTRADICTION_THRESHOLD_MAX;
const IN_BAND = (THRESHOLD + THRESHOLD_MAX) / 2; // score inside contradiction band
const BELOW_BAND = THRESHOLD - 0.01;
const AT_MAX = THRESHOLD_MAX; // score at/above max is in duplicate zone, not contradiction band

function candidate(id: string, score: number, content: string): ContradictionCandidate {
  return { id, score, content };
}

describe('ContradictionDetectionService', () => {
  let service: ContradictionDetectionService;

  beforeEach(() => {
    // The policy is read from the environment at construction time — pin the
    // default so a developer's shell cannot flip these expectations.
    delete process.env.MEMORY_CONTRADICTION_POLICY;
    service = new ContradictionDetectionService();
  });

  describe('getLowThreshold / getHighThreshold', () => {
    it('returns the default thresholds', () => {
      expect(service.getLowThreshold()).toBe(THRESHOLD);
      expect(service.getHighThreshold()).toBe(THRESHOLD_MAX);
    });
  });

  describe('contradiction policy (G3-T4, MEMORY_CONTRADICTION_POLICY)', () => {
    afterEach(() => {
      delete process.env.MEMORY_CONTRADICTION_POLICY;
    });

    it('defaults to flag (Decision 3 — conservative: keep both rows)', () => {
      expect(DEFAULT_CONTRADICTION_POLICY).toBe('flag');
      expect(service.getPolicy()).toBe('flag');
    });

    it('detect() returns action=flagged under the default policy', () => {
      const c = candidate('m1', IN_BAND, 'I like Python');
      const result = service.detect("I don't like Python", [c]);
      expect(result!.action).toBe('flagged');
    });

    it('detect() returns action=superseded when policy=supersede (latest-wins opt-in)', () => {
      process.env.MEMORY_CONTRADICTION_POLICY = 'supersede';
      const superseding = new ContradictionDetectionService();
      expect(superseding.getPolicy()).toBe('supersede');
      const c = candidate('m1', IN_BAND, 'I like Python');
      const result = superseding.detect("I don't like Python", [c]);
      expect(result!.action).toBe('superseded');
    });

    it('an unknown policy value falls back to the flag default', () => {
      process.env.MEMORY_CONTRADICTION_POLICY = 'llm-arbitrate';
      expect(new ContradictionDetectionService().getPolicy()).toBe('flag');
    });
  });

  describe('detect()', () => {
    it('returns null when candidates array is empty', () => {
      expect(service.detect('I like Python', [])).toBeNull();
    });

    it('returns null when all candidates are below the similarity band', () => {
      const c = candidate('m1', BELOW_BAND, "I don't like Python");
      expect(service.detect('I like Python', [c])).toBeNull();
    });

    it('returns null when candidate is at or above the duplicate threshold (not a contradiction)', () => {
      const c = candidate('m1', AT_MAX, "I don't like Python");
      expect(service.detect('I like Python', [c])).toBeNull();
    });

    it('returns null when in-band candidates do not contradict', () => {
      const c = candidate('m1', IN_BAND, 'I like Python and use it daily');
      expect(service.detect('I enjoy Python for scripting', [c])).toBeNull();
    });

    describe('negation asymmetry', () => {
      it('detects when new memory has negation and existing does not', () => {
        const c = candidate('m1', IN_BAND, 'I like Python');
        const result = service.detect("I don't like Python", [c]);
        expect(result).not.toBeNull();
        expect(result!.memoryId).toBe('m1');
        expect(result!.reason).toBe('negation asymmetry');
        expect(result!.action).toBe('flagged'); // default policy keeps both rows
      });

      it('detects when existing memory has negation and new does not', () => {
        const c = candidate('m1', IN_BAND, "I don't use TypeScript");
        const result = service.detect('I use TypeScript', [c]);
        expect(result).not.toBeNull();
        expect(result!.reason).toBe('negation asymmetry');
      });

      it('does not flag when both have negation', () => {
        const c = candidate('m1', IN_BAND, 'I never use JavaScript');
        const result = service.detect("I don't use JavaScript either", [c]);
        expect(result).toBeNull();
      });

      it('does not flag when neither has negation', () => {
        const c = candidate('m1', IN_BAND, 'I use Python');
        expect(service.detect('I use Python daily', [c])).toBeNull();
      });

      it('matches "cannot" as negation', () => {
        const c = candidate('m1', IN_BAND, 'I can handle this');
        const result = service.detect('I cannot handle this anymore', [c]);
        expect(result).not.toBeNull();
        expect(result!.reason).toBe('negation asymmetry');
      });

      it('matches "no longer" as negation', () => {
        const c = candidate('m1', IN_BAND, 'I work at Acme Corp');
        const result = service.detect('I no longer work at Acme Corp', [c]);
        expect(result).not.toBeNull();
        expect(result!.reason).toBe('negation asymmetry');
      });
    });

    describe('change indicators', () => {
      it('detects change indicator in new memory only', () => {
        const c = candidate('m1', IN_BAND, 'I use JavaScript for backend work');
        const result = service.detect('I switched to TypeScript for backend work', [c]);
        expect(result).not.toBeNull();
        expect(result!.reason).toBe('change indicator in new memory');
      });

      it('detects "now I" as change indicator', () => {
        const c = candidate('m1', IN_BAND, 'I prefer tabs for indentation');
        const result = service.detect('Now I prefer spaces for indentation', [c]);
        expect(result).not.toBeNull();
        expect(result!.reason).toBe('change indicator in new memory');
      });

      it('does not flag when both have change indicators', () => {
        const c = candidate('m1', IN_BAND, 'I changed to using tabs');
        const result = service.detect('I switched to using spaces', [c]);
        // both have change indicators so neither negation nor change-only applies
        expect(result).toBeNull();
      });
    });

    describe('polar opposites', () => {
      it('detects like/dislike', () => {
        const c = candidate('m1', IN_BAND, 'I like early mornings');
        const result = service.detect('I dislike early mornings', [c]);
        expect(result).not.toBeNull();
        expect(result!.reason).toBe('polar opposite: like/dislike');
      });

      it('detects prefer/avoid', () => {
        const c = candidate('m1', IN_BAND, 'I prefer async code patterns');
        const result = service.detect('I avoid async code patterns', [c]);
        expect(result).not.toBeNull();
        expect(result!.reason).toBe('polar opposite: prefer/avoid');
      });

      it('detects love/hate', () => {
        const c = candidate('m1', IN_BAND, 'I love dark mode');
        const result = service.detect('I hate dark mode', [c]);
        expect(result).not.toBeNull();
        expect(result!.reason).toBe('polar opposite: love/hate');
      });

      it('detects agree/disagree', () => {
        const c = candidate('m1', IN_BAND, 'I agree with that approach');
        const result = service.detect('I disagree with that approach', [c]);
        expect(result).not.toBeNull();
        expect(result!.reason).toBe('polar opposite: agree/disagree');
      });

      it('detects reverse direction (new has A, old has B)', () => {
        const c = candidate('m1', IN_BAND, 'I dislike meetings');
        const result = service.detect('I like meetings when they are short', [c]);
        expect(result).not.toBeNull();
        expect(result!.reason).toBe('polar opposite: like/dislike');
      });
    });

    describe('same-subject value swap (G3-T6, deterministic — no LLM path)', () => {
      // Table of pairs that MUST fire: same normalized subject, diverging value.
      const firing: Array<{ name: string; newContent: string; existing: string; subject: string }> =
        [
          {
            name: 'copular value swap',
            newContent: 'editor is emacs',
            existing: 'editor is vim',
            subject: 'editor',
          },
          {
            name: 'copular with possessive subject',
            newContent: 'my editor is emacs',
            existing: 'editor is vim',
            subject: 'editor',
          },
          {
            name: 'assignment form (=)',
            newContent: 'editor = emacs',
            existing: 'editor = vim',
            subject: 'editor',
          },
          {
            name: 'key-value form (:)',
            newContent: 'editor: emacs',
            existing: 'editor: vim',
            subject: 'editor',
          },
          {
            name: 'named-subject relational form (lives in)',
            newContent: 'qp lives in SF',
            existing: 'qp lives in NYC',
            subject: 'qp lives in',
          },
          {
            name: 'named-subject relational form (works at)',
            newContent: 'qp works at Initech',
            existing: 'qp works at Acme',
            subject: 'qp works at',
          },
          {
            name: 'preference verb with singular/plural normalization',
            newContent: 'qp prefers tabs',
            existing: 'qp prefers spaces',
            subject: 'qp prefer',
          },
        ];

      it.each(firing)('fires on $name', ({ newContent, existing, subject }) => {
        const c = candidate('m1', IN_BAND, existing);
        const result = service.detect(newContent, [c]);
        expect(result).not.toBeNull();
        expect(result!.reason).toContain(`value swap: ${subject}`);
      });

      it('includes both values in the reason (new first, existing second)', () => {
        const c = candidate('m1', IN_BAND, 'editor is vim');
        const result = service.detect('editor is emacs', [c]);
        expect(result!.reason).toBe("value swap: editor 'emacs' vs 'vim'");
      });

      // Table of pairs that must NOT fire.
      const nonFiring: Array<{ name: string; newContent: string; existing: string }> = [
        {
          // Different subjects never fire even though both parse.
          name: 'different subjects',
          newContent: 'shell is zsh',
          existing: 'editor is vim',
        },
        {
          // Conservative choice (documented in checkValueSwap): a value that is
          // a token-superset of the other is an ELABORATION, not a swap —
          // "vim with plugins" refines "vim". Missing a real contradiction here
          // costs less than falsely flagging a refinement.
          name: 'value superset / elaboration',
          newContent: 'editor is vim with plugins',
          existing: 'editor is vim',
        },
        {
          name: 'identical values',
          newContent: 'editor is vim',
          existing: 'my editor is vim',
        },
        {
          // Bare-pronoun copular subject carries no identity to compare.
          name: 'pronoun-only subject',
          newContent: 'this is fine',
          existing: 'this is terrible',
        },
        {
          // Different relations on the same actor are different subjects.
          name: 'different relations',
          newContent: 'qp works at Acme',
          existing: 'qp lives in NYC',
        },
        {
          // One side has no extractable pattern at all.
          name: 'unparseable side',
          newContent: 'I enjoy Python for scripting',
          existing: 'editor is vim',
        },
      ];

      it.each(nonFiring)('does not fire on $name', ({ newContent, existing }) => {
        const c = candidate('m1', IN_BAND, existing);
        expect(service.detect(newContent, [c])).toBeNull();
      });

      it('earlier heuristics keep priority over the value-swap reason', () => {
        // Negation asymmetry also holds here; it must win since it runs first.
        const c = candidate('m1', IN_BAND, 'editor is vim');
        const result = service.detect("editor isn't vim", [c]);
        expect(result!.reason).toBe('negation asymmetry');
      });
    });

    it('uses score and sets action from the active policy (flagged by default)', () => {
      const c = candidate('abc', IN_BAND, 'I like Python');
      const result = service.detect("I don't like Python", [c]);
      expect(result!.memoryId).toBe('abc');
      expect(result!.score).toBe(IN_BAND);
      expect(result!.action).toBe('flagged');
    });

    it('returns first matching candidate when multiple are in band', () => {
      const c1 = candidate('first', IN_BAND, 'I like Python');
      const c2 = candidate('second', IN_BAND + 0.01, 'I prefer Python');
      const result = service.detect("I don't like Python anymore", [c1, c2]);
      expect(result!.memoryId).toBe('first');
    });
  });

  describe('annotateContradictor()', () => {
    it('adds contradictionMatches to empty metadata', () => {
      const match = {
        memoryId: 'm1',
        score: 0.85,
        action: 'superseded' as const,
        reason: 'negation asymmetry',
      };
      const result = service.annotateContradictor(null, match, 'I like Python');
      expect(Array.isArray(result['contradictionMatches'])).toBe(true);
      const entries = result['contradictionMatches'] as unknown[];
      expect(entries).toHaveLength(1);
      const entry = entries[0] as Record<string, unknown>;
      expect(entry['memoryId']).toBe('m1');
      expect(entry['action']).toBe('superseded');
      expect(entry['reason']).toBe('negation asymmetry');
      expect(typeof entry['detectedAt']).toBe('string');
    });

    it('appends to existing contradictionMatches', () => {
      const existing = { contradictionMatches: [{ memoryId: 'old' }] };
      const match = {
        memoryId: 'new',
        score: 0.85,
        action: 'superseded' as const,
        reason: 'change indicator in new memory',
      };
      const result = service.annotateContradictor(existing, match, 'summary');
      expect((result['contradictionMatches'] as unknown[]).length).toBe(2);
    });

    it('truncates summary to 120 characters', () => {
      const longSummary = 'a'.repeat(200);
      const match = { memoryId: 'm1', score: 0.85, action: 'superseded' as const, reason: 'test' };
      const result = service.annotateContradictor(null, match, longSummary);
      const entry = (result['contradictionMatches'] as Array<Record<string, unknown>>)[0];
      expect((entry['summary'] as string).length).toBe(120);
    });
  });

  describe('annotateSuperseded()', () => {
    it('sets status=superseded with audit fields', () => {
      const result = service.annotateSuperseded(null, 'new-id', 'negation asymmetry');
      expect(result['status']).toBe('superseded');
      expect(result['supersededBy']).toBe('new-id');
      expect(result['supersededReason']).toBe('negation asymmetry');
      expect(typeof result['supersededAt']).toBe('string');
    });

    it('merges with existing metadata without clobbering other fields', () => {
      const meta = { importance: 0.7, tags: ['work'] };
      const result = service.annotateSuperseded(meta, 'new-id', 'reason');
      expect(result['importance']).toBe(0.7);
      expect(result['tags']).toEqual(['work']);
      expect(result['status']).toBe('superseded');
    });
  });

  describe('annotateContradicted() (G3-T4, policy flag)', () => {
    it('sets status=contradicted with review fields pointing at the counterpart', () => {
      const result = service.annotateContradicted(null, 'counterpart-id', 'negation asymmetry');
      expect(result['status']).toBe('contradicted');
      expect(result['contradictionWith']).toBe('counterpart-id');
      expect(result['contradictionReason']).toBe('negation asymmetry');
      expect(typeof result['contradictedAt']).toBe('string');
      // Crucially, no supersede marker: the recall filter keys on
      // supersededBy/status=superseded, so this row keeps surfacing.
      expect(result['supersededBy']).toBeUndefined();
    });

    it('merges with existing metadata without clobbering other fields', () => {
      const meta = { importance: 0.7, pinned: true };
      const result = service.annotateContradicted(meta, 'counterpart-id', 'reason');
      expect(result['importance']).toBe(0.7);
      expect(result['pinned']).toBe(true);
      expect(result['status']).toBe('contradicted');
    });
  });
});
