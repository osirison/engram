import { runHarness } from './harness.js';
import { formatReport } from './report.js';
import { recallFixtures } from './fixtures/recall-fixtures.js';
import { createKeywordRetriever } from './retrievers/keyword-retriever.js';
import type { HarnessReport } from './types.js';

/**
 * Minimum acceptable aggregate metrics for the keyword baseline. The CI `eval`
 * step fails when a change regresses recall quality below these floors. Floors
 * sit just under the recorded baseline (recall@5 91.7%, MRR 1.000, nDCG@5
 * 0.922) to allow for noise while still catching real regressions.
 */
const BASELINE_FLOORS = {
  recallAtK: 0.9,
  mrr: 0.95,
  ndcgAtK: 0.9,
} as const;

function findRegressions(report: HarnessReport): string[] {
  const breaches: string[] = [];
  if (report.recallAtK < BASELINE_FLOORS.recallAtK) {
    breaches.push(
      `recall@${report.k} ${report.recallAtK.toFixed(3)} < floor ${BASELINE_FLOORS.recallAtK}`
    );
  }
  if (report.mrr < BASELINE_FLOORS.mrr) {
    breaches.push(`MRR ${report.mrr.toFixed(3)} < floor ${BASELINE_FLOORS.mrr}`);
  }
  if (report.ndcgAtK < BASELINE_FLOORS.ndcgAtK) {
    breaches.push(
      `nDCG@${report.k} ${report.ndcgAtK.toFixed(3)} < floor ${BASELINE_FLOORS.ndcgAtK}`
    );
  }
  return breaches;
}

/**
 * CLI entry point: runs the keyword baseline retriever over the labeled recall
 * fixtures, prints an aggregate report, and fails when metrics regress below
 * the baseline floors. Invoked via `pnpm eval`.
 */
async function main(): Promise<void> {
  const k = 5;
  const retriever = createKeywordRetriever(recallFixtures.documents);
  const report = await runHarness(recallFixtures.queries, retriever, k);

  console.log(formatReport(report, 'keyword baseline'));

  const regressions = findRegressions(report);
  if (regressions.length > 0) {
    console.error(`\nBaseline regression detected:\n  - ${regressions.join('\n  - ')}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('Evaluation harness failed:', error);
  process.exitCode = 1;
});
