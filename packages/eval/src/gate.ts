import { runHarness } from './harness.js';
import { formatReport } from './report.js';
import { recallFixtures } from './fixtures/recall-fixtures.js';
import { createKeywordRetriever } from './retrievers/keyword-retriever.js';
import { createEmbeddingRetriever } from './retrievers/embedding-retriever.js';
import { createFusionRetriever } from './retrievers/fusion-retriever.js';
import { RECALL_GATE_THRESHOLDS, evaluateGate } from './thresholds.js';
import type { HarnessReport } from './types.js';

// Deterministic hash embedding (mirrors `run.ts`) so the gate needs no network,
// DB, or API key — it runs the same hybrid fusion retriever `pnpm eval` measures.
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
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vector : vector.map((value) => value / norm);
}

/** Build the fusion-retriever harness report over the sanitized recall fixtures. */
export async function buildRecallGateReport(
  k: number = RECALL_GATE_THRESHOLDS.k
): Promise<HarnessReport> {
  const keyword = createKeywordRetriever(recallFixtures.documents);
  const embedding = await createEmbeddingRetriever(
    recallFixtures.documents,
    (text) => embedText(text),
    {
      minScore: 0.05,
    }
  );
  const fusion = createFusionRetriever([keyword, embedding], {
    candidateLimit: 20,
    weights: [2, 1],
  });
  return runHarness(recallFixtures.queries, fusion, k);
}

async function main(): Promise<void> {
  const report = await buildRecallGateReport();
  console.log(formatReport(report, 'recall-quality gate (hybrid fusion)'));
  const { passed, breaches } = evaluateGate(report);
  if (!passed) {
    console.error(`\nRecall-quality gate FAILED:\n  - ${breaches.join('\n  - ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nRecall-quality gate PASSED (all metrics at or above the pinned floors).');
  }
}

// Run only as a CLI (`node dist/gate.js`), never when imported by a test.
if (process.argv[1] !== undefined && /gate\.(js|ts)$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error('Recall-quality gate failed to run:', error);
    process.exitCode = 1;
  });
}
