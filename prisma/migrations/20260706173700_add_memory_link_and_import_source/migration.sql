-- CreateTable
CREATE TABLE "memory_links" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "sourceMemoryId" TEXT NOT NULL,
    "targetMemoryId" TEXT,
    "targetLocator" TEXT NOT NULL,
    "relType" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'authored',
    "score" DOUBLE PRECISION,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_import_sources" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "sourceTool" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_import_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memory_links_userId_targetLocator_idx" ON "memory_links"("userId", "targetLocator");

-- CreateIndex
CREATE INDEX "memory_links_targetMemoryId_idx" ON "memory_links"("targetMemoryId");

-- CreateIndex
CREATE INDEX "memory_links_sourceMemoryId_idx" ON "memory_links"("sourceMemoryId");

-- CreateIndex
CREATE UNIQUE INDEX "memory_links_sourceMemoryId_targetLocator_relType_key" ON "memory_links"("sourceMemoryId", "targetLocator", "relType");

-- CreateIndex
CREATE INDEX "memory_import_sources_userId_contentHash_idx" ON "memory_import_sources"("userId", "contentHash");

-- CreateIndex
CREATE INDEX "memory_import_sources_memoryId_idx" ON "memory_import_sources"("memoryId");

-- CreateIndex
CREATE UNIQUE INDEX "memory_import_sources_userId_sourceKey_key" ON "memory_import_sources"("userId", "sourceKey");

-- AddForeignKey
ALTER TABLE "memory_links" ADD CONSTRAINT "memory_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_links" ADD CONSTRAINT "memory_links_sourceMemoryId_fkey" FOREIGN KEY ("sourceMemoryId") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_links" ADD CONSTRAINT "memory_links_targetMemoryId_fkey" FOREIGN KEY ("targetMemoryId") REFERENCES "memories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
