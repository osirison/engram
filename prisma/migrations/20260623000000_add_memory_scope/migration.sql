-- Add scope column and index to memories table for agent/session/project namespacing
ALTER TABLE "memories" ADD COLUMN "scope" TEXT;

-- Backfill the new first-class column from the legacy metadata.scope value so
-- pre-existing memories keep their namespace. Before this column existed, scope
-- was stored inside the `metadata` JSONB blob (`metadata.scope`); the application
-- no longer reads it from there, so without this backfill those memories would
-- silently lose their scope and leak across namespace boundaries.
-- Only copy non-empty string values; leave everything else NULL (unscoped).
UPDATE "memories"
SET "scope" = "metadata"->>'scope'
WHERE "scope" IS NULL
  AND jsonb_typeof("metadata"->'scope') = 'string'
  AND length("metadata"->>'scope') > 0;

CREATE INDEX "memories_userId_scope_idx" ON "memories"("userId", "scope");
