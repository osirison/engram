// Main exports for the memory-ltm package
export { MemoryLtmService } from './memory-ltm.service';
export { MemoryLtmModule, LTM_PROVIDER } from './memory-ltm.module';
export { InMemoryLtmAdapter } from './adapters/inmemory-ltm.adapter';
export { HybridTransientRetriever } from './retrieval/hybrid-transient-retriever';
export { ImportanceScoringService } from './importance.service';
export { DuplicateDetectionService } from './duplicate-detection.service';
export {
  ContradictionDetectionService,
  DEFAULT_CONTRADICTION_POLICY,
} from './contradiction-detection.service';

// Stream B0 — Typed Ingest Pipeline
export { IngestPipelineService } from './ingest/ingest-pipeline.service';
export { PrivacyFilterStep } from './ingest/privacy-filter.step';
export { TopicDetectorStep } from './ingest/topic-detector.step';
export type { PipelineStep, IngestContext } from './ingest/types';
export { buildIngestContext } from './ingest/types';

// Export types and interfaces
export type {
  LtmMemory,
  CreateLtmMemoryData,
  UpdateLtmMemoryData,
  LtmQueryOptions,
  LtmConfig,
  SemanticSearchOptions,
  SemanticSearchResult,
  ReindexOptions,
  ReindexProgress,
  ReindexResult,
  ImportanceSignals,
  ImportanceScoreResult,
  DuplicateDetectionMatch,
  ContradictionMatch,
  ContradictionCandidate,
  ContradictionAction,
  ContradictionPolicy,
  DecayPolicyOptions,
  DecayPolicyResult,
  CreateLtmMemoryValidated,
  UpdateLtmMemoryValidated,
  LtmQueryOptionsValidated,
} from './types';

// Export error classes
export {
  LtmMemoryNotFoundError,
  LtmMemoryQuotaExceededError,
  LtmPromotionError,
  LtmDatabaseError,
  DEFAULT_LTM_CONFIG,
} from './types';

// Export validation functions
export { validateCreateLtmMemory, validateUpdateLtmMemory, validateLtmQueryOptions } from './types';

// Relevance ranking
export { rankResults, DEFAULT_RANKING_WEIGHTS } from './rank';
export type { RankingWeights } from './rank';
