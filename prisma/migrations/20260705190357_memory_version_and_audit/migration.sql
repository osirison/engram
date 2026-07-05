-- AlterTable
ALTER TABLE "memories" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "memory_audits" (
    "id" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "scope" TEXT,
    "action" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" VARCHAR(256),
    "delegated" BOOLEAN NOT NULL DEFAULT false,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memory_audits_memoryId_idx" ON "memory_audits"("memoryId");

-- CreateIndex
CREATE INDEX "memory_audits_userId_createdAt_idx" ON "memory_audits"("userId", "createdAt");
