-- AlterTable (G4-T3 CAS-skip): record the Memory.version the importer last
-- wrote so the next re-import can pass it as expectedVersion. Nullable —
-- pre-existing ledger rows have no known version (one last LWW re-import
-- backfills it).
ALTER TABLE "memory_import_sources" ADD COLUMN "lastWrittenVersion" INTEGER;
