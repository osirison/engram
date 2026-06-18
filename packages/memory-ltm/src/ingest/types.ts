/**
 * Stream B0 — Typed Ingest Pipeline
 *
 * PipelineStep<T> is the composable unit: each step receives a context object,
 * may mutate it, and returns the (possibly modified) context for the next step.
 *
 * Steps signal early termination by setting ctx.aborted = true. The pipeline
 * stops executing subsequent steps when it encounters an aborted context.
 */
export interface PipelineStep<T> {
  readonly name: string;
  execute(ctx: T): Promise<T>;
}

/** Mutable context threaded through the 13-step ingest pipeline. */
export interface IngestContext {
  // ── Input fields (set before pipeline starts) ──────────────────────────────
  userId: string;
  organizationId?: string;
  /** The original raw content submitted by the caller. */
  originalContent: string;
  originalTags: string[];
  originalMetadata: Record<string, unknown> | null;

  // ── Mutable fields (steps may read and write these) ────────────────────────
  /** Content after privacy filtering (step 1). */
  content: string;
  /** Tags after topic detection enrichment (step 4). */
  tags: string[];
  /** Metadata accumulator — importance annotation added in step 5. */
  metadata: Record<string, unknown>;

  /**
   * Content hash (SHA-256 of normalised content) computed in step 2.
   * Used for exact-duplicate detection without a vector lookup.
   */
  contentHash: string | null;

  /** Topics detected by TopicDetectorStep (step 4), mirrored into tags. */
  detectedTopics: string[];

  /** Description of what the privacy filter redacted (for audit). */
  redactions: string[];

  // ── Control flow ────────────────────────────────────────────────────────────
  /**
   * When true the pipeline stops and the caller should treat this as a
   * no-op (e.g. exact duplicate detected).
   */
  aborted: boolean;
  abortReason?: string;
  /** ID of the existing memory when aborting due to exact dedup. */
  duplicateId?: string;
}

/** Factory to build a fresh context from caller input. */
export function buildIngestContext(input: {
  userId: string;
  organizationId?: string;
  content: string;
  tags?: string[];
  metadata?: Record<string, unknown> | null;
}): IngestContext {
  return {
    userId: input.userId,
    organizationId: input.organizationId,
    originalContent: input.content,
    originalTags: input.tags ?? [],
    originalMetadata: input.metadata ?? null,
    content: input.content,
    tags: [...(input.tags ?? [])],
    metadata: { ...(input.metadata ?? {}) },
    contentHash: null,
    detectedTopics: [],
    redactions: [],
    aborted: false,
  };
}
