/**
 * @engram/memory-lite
 *
 * Encrypted-at-rest, owner-only file-backed JSON memory store used by the
 * ENGRAM `profile-lite` deployment mode.
 */

export {
  LiteJsonStore,
  LITE_STORE_TOKEN,
  getLiteStore,
  resetLiteStoreCache,
  liteMemorySchema,
  type LiteMemory,
  type CreateLiteMemoryInput,
  type UpdateLiteMemoryInput,
  type ListLiteMemoriesOptions,
  type ListLiteMemoriesResult,
  ENCRYPTION_VERSION_PREFIX,
} from './lite-store';

export {
  encrypt,
  decrypt,
  decodeEncryptionKey,
  generateEncryptionKeyBase64,
  constantTimeEqual,
  DecryptionError,
  KEY_LENGTH_BYTES,
  IV_LENGTH_BYTES,
  AUTH_TAG_LENGTH_BYTES,
  type EncryptedPayload,
} from './encryption';

export {
  assertSecureStartup,
  resolveSecureStartupOptions,
  isDirModeAcceptable,
  isFileModeAcceptable,
  ensureDataDirectory,
  auditExistingPermissions,
  OWNER_ONLY_DIR_MODE,
  OWNER_ONLY_FILE_MODE,
  type SecureStartupOptions,
} from './secure-startup';

export { MemoryLiteModule } from './memory-lite.module';
