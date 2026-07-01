-- CreateTable
CREATE TABLE "migration_checkpoints" (
    "id" TEXT NOT NULL,
    "sourceProfile" TEXT NOT NULL,
    "targetProfile" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "cursor" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "totalItems" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "sourceManifestHash" TEXT,
    "history" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "migration_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "migration_checkpoints_state_idx" ON "migration_checkpoints"("state");
