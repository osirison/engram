export { precisionAtK, recallAtK, reciprocalRank, dcgAtK, ndcgAtK, mean } from './metrics.js';
export { runHarness } from './harness.js';
export { createKeywordRetriever, tokenize } from './retrievers/keyword-retriever.js';
export {
  reciprocalRankFusion,
  createFusionRetriever,
  DEFAULT_RRF_K,
} from './retrievers/fusion-retriever.js';
export { createEmbeddingRetriever, cosineSimilarity } from './retrievers/embedding-retriever.js';
export { recallFixtures } from './fixtures/recall-fixtures.js';
export { formatReport } from './report.js';
export { RECALL_GATE_THRESHOLDS, evaluateGate } from './thresholds.js';
export type { GateThresholds, GateResult } from './thresholds.js';
export { buildRecallGateReport } from './gate.js';
export { percentile, summarize, runLatencyBenchmark } from './latency.js';
export { createVectorStoreLatencyTarget } from './latency-adapters.js';
export type {
  EvalDocument,
  EvalQuery,
  EvalDataset,
  Retriever,
  QueryResult,
  HarnessReport,
} from './types.js';
export type {
  LatencyTarget,
  LatencySummary,
  LatencyThresholds,
  LatencyBenchmarkOptions,
  LatencyBenchmarkResult,
} from './latency.js';
export type {
  VectorStoreLike,
  LatencyFixtureRecord,
  LatencyFixtureQuery,
  VectorStoreLatencyTargetOptions,
} from './latency-adapters.js';
export type {
  ReciprocalRankFusionOptions,
  FusionRetrieverOptions,
} from './retrievers/fusion-retriever.js';
export type { EmbedFunction, EmbeddingRetrieverOptions } from './retrievers/embedding-retriever.js';
