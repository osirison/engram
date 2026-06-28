export interface RememberInput {
  userId: string;
  content: string;
  type?: 'auto' | 'short-term' | 'long-term';
  scope?: string;
  tags?: string[];
  ttl?: number;
  skipDuplicateCheck?: boolean;
  metadata?: Record<string, unknown>;
}

export interface MemoryRecord {
  id: string;
  userId: string;
  content: string;
  type: string;
  tags: string[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  scope?: string | null;
}

export interface RememberResult {
  memoryId: string;
  resolvedType: 'short-term' | 'long-term';
  wasDeduped: boolean;
  memory: MemoryRecord;
}

export interface RecallInput {
  userId: string;
  query: string;
  limit?: number;
  scope?: string;
  tags?: string[];
  createdFrom?: string;
  createdTo?: string;
}

export interface RecallHit {
  score: number;
  memory: MemoryRecord;
}

export interface RecallResult {
  query: string;
  count: number;
  results: RecallHit[];
}

export interface ForgetInput {
  userId: string;
  query: string;
  confirm?: boolean;
  limit?: number;
  minScore?: number;
  scope?: string;
}

export interface ForgetCandidate {
  memoryId: string;
  content: string;
  score: number;
}

export interface ForgetResult {
  dryRun: boolean;
  candidates: ForgetCandidate[];
  deleted: number;
  message: string;
}

export interface ReflectInput {
  userId: string;
  query: string;
  limit?: number;
  minScore?: number;
  scope?: string;
  tags?: string[];
}

export interface ReflectResult {
  query: string;
  summary: string;
  themes: string[];
  sourceIds: string[];
  memoryCount: number;
  dateRange: { earliest: string; latest: string } | null;
}

export interface PromptContextInput {
  userId: string;
  query: string;
  tokenBudget?: number;
  limit?: number;
  minScore?: number;
  scope?: string;
  tags?: string[];
  createdFrom?: string;
  createdTo?: string;
}

export interface PromptContextResult {
  context: string;
  memoryCount: number;
  estimatedTokens: number;
  tokenBudget: number;
  truncated: boolean;
  candidatesFound: number;
}

export type ConversationRole = 'user' | 'assistant' | 'system';

export interface ConversationTurn {
  role: ConversationRole;
  content: string;
}

export interface IngestConversationInput {
  userId: string;
  turns: ConversationTurn[];
  tags?: string[];
  concurrency?: number;
  metadata?: Record<string, unknown>;
}

export interface IngestConversationResult {
  ingested: number;
  skipped: number;
  failed: number;
  total: number;
  memoryIds: string[];
}
