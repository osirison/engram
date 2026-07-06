import type { HarnessReport } from './types.js';

export interface GateThresholds {
  k: number;
  recallAtK: number;
  mrr: number;
  ndcgAtK: number;
}

/**
 * Minimum acceptable recall-quality metrics for the hybrid fusion retriever over
 * the sanitized recall fixtures. Pinned just under the recorded baseline (recall@5
 * ~0.92, MRR 1.000, nDCG@5 ~0.92) so noise does not trip the gate but a genuine
 * regression does. This is the "primary memory can't silently get dumber" guard
 * (WP5 T5 / GAPS G8). Documented in `docs/RELEASE_GATES.md`.
 */
export const RECALL_GATE_THRESHOLDS: GateThresholds = {
  k: 5,
  recallAtK: 0.9,
  mrr: 0.95,
  ndcgAtK: 0.9,
};

export interface GateResult {
  passed: boolean;
  breaches: string[];
}

/** Evaluate a harness report against the recall-quality thresholds. Pure. */
export function evaluateGate(
  report: HarnessReport,
  thresholds: GateThresholds = RECALL_GATE_THRESHOLDS
): GateResult {
  const breaches: string[] = [];
  if (report.recallAtK < thresholds.recallAtK) {
    breaches.push(
      `recall@${report.k} ${report.recallAtK.toFixed(3)} < floor ${thresholds.recallAtK}`
    );
  }
  if (report.mrr < thresholds.mrr) {
    breaches.push(`MRR ${report.mrr.toFixed(3)} < floor ${thresholds.mrr}`);
  }
  if (report.ndcgAtK < thresholds.ndcgAtK) {
    breaches.push(`nDCG@${report.k} ${report.ndcgAtK.toFixed(3)} < floor ${thresholds.ndcgAtK}`);
  }
  return { passed: breaches.length === 0, breaches };
}
