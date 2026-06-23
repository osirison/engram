-- Add scope column and index to memories table for agent/session/project namespacing
ALTER TABLE "memories" ADD COLUMN "scope" TEXT;

CREATE INDEX "memories_userId_scope_idx" ON "memories"("userId", "scope");
