import { describe, expect, it } from 'vitest';

import { buildRecallGateReport } from './gate.js';
import { evaluateGate, RECALL_GATE_THRESHOLDS } from './thresholds.js';
import type { HarnessReport } from './types.js';

function report(overrides: Partial<HarnessReport>): HarnessReport {
  return {
    k: 5,
    queryCount: 6,
    precisionAtK: 0.2,
    recallAtK: 0.95,
    mrr: 1,
    ndcgAtK: 0.95,
    perQuery: [],
    ...overrides,
  };
}

describe('evaluateGate', () => {
  it('passes a healthy report', () => {
    const res = evaluateGate(report({}));
    expect(res.passed).toBe(true);
    expect(res.breaches).toEqual([]);
  });

  it('fails and lists every breached metric on a degraded report', () => {
    const res = evaluateGate(report({ recallAtK: 0.5, mrr: 0.4, ndcgAtK: 0.5 }));
    expect(res.passed).toBe(false);
    expect(res.breaches).toHaveLength(3);
    expect(res.breaches.join(' ')).toContain('recall@5');
    expect(res.breaches.join(' ')).toContain('MRR');
    expect(res.breaches.join(' ')).toContain('nDCG@5');
  });

  it('respects custom thresholds', () => {
    const relaxed = { ...RECALL_GATE_THRESHOLDS, recallAtK: 0.75 };
    expect(evaluateGate(report({ recallAtK: 0.8 }), relaxed).passed).toBe(true);
    expect(evaluateGate(report({ recallAtK: 0.7 }), relaxed).passed).toBe(false);
  });
});

describe('buildRecallGateReport (integration over fixtures)', () => {
  it('meets the pinned thresholds on the current fixtures', async () => {
    const rep = await buildRecallGateReport();
    const res = evaluateGate(rep);
    expect(res.passed, `gate breaches on current fixtures: ${res.breaches.join(', ')}`).toBe(true);
  }, 20000);
});
