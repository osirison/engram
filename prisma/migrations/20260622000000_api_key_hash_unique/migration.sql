-- CreateIndex: enforce one-key-per-hash uniqueness for collision safety
CREATE UNIQUE INDEX "api_keys_hash_key" ON "api_keys"("hash");

-- CreateIndex: compound index covering prefix+hash lookups in verifyApiKey
CREATE INDEX "api_keys_prefix_hash_idx" ON "api_keys"("prefix", "hash");
