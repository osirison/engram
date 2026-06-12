// Main exports for the memory-ltm package
export { MemoryLtmService } from './memory-ltm.service';
export { MemoryLtmModule } from './memory-ltm.module';

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
