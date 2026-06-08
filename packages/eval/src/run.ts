import { runHarness } from './harness.js';
import { formatReport } from './report.js';
import { recallFixtures } from './fixtures/recall-fixtures.js';
import { createKeywordRetriever } from './retrievers/keyword-retriever.js';
import { createEmbeddingRetriever } from './retrievers/embedding-retriever.js';
import { createFusionRetriever } from './retrievers/fusion-retriever.js';
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

const HASH_DIMENSIONS = 64;

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function embedText(text: string): number[] {
  const vector = new Array<number>(HASH_DIMENSIONS).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  for (const token of tokens) {
    const index = hashToken(token) % HASH_DIMENSIONS;
    vector[index] = (vector[index] ?? 0) + 1;
  }

  // L2 normalize so cosine similarity is stable across length differences.
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return vector;
  }
  return vector.map((value) => value / norm);
}

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
  const keyword = createKeywordRetriever(recallFixtures.documents);
  const embedding = await createEmbeddingRetriever(
    recallFixtures.documents,
    (text) => embedText(text),
    { minScore: 0.05 }
  );
  const fusion = createFusionRetriever([keyword, embedding], {
    candidateLimit: 20,
    weights: [2, 1],
  });

  const reports = {
    keyword: await runHarness(recallFixtures.queries, keyword, k),
    embedding: await runHarness(recallFixtures.queries, embedding, k),
    fusion: await runHarness(recallFixtures.queries, fusion, k),
  };

  console.log(formatReport(reports.keyword, 'keyword baseline'));
  console.log('');
  console.log(formatReport(reports.embedding, 'embedding retriever'));
  console.log('');
  console.log(formatReport(reports.fusion, 'hybrid fusion retriever'));

  const regressions = findRegressions(reports.fusion);
  if (regressions.length > 0) {
    console.error(`\nFusion regression detected:\n  - ${regressions.join('\n  - ')}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('Evaluation harness failed:', error);
  process.exitCode = 1;
});
