import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Encryption layer for at-rest payloads in profile-lite.
 *
 * Each ciphertext is a self-describing record:
 *
 *   v1:base64( iv(12) || authTag(16) || ciphertext )
 *
 * - `v1:` prefix lets us introduce new algorithms / parameters later without
 *   breaking decryption of older records.
 * - AES-256-GCM provides confidentiality + integrity. The auth tag is the
 *   last 16 bytes of the decoded payload, so tampering or corruption
 *   surfaces as a `DecryptionError`.
 * - `additionalAuthenticatedData` (AAD) is the record's stable identifier
 *   (memoryId). Binding the AAD to the record id prevents an attacker with
 *   write access to the data dir from swapping ciphertext between records.
 */

export const ENCRYPTION_VERSION_PREFIX = 'v1:';

/** AES-256-GCM IV length in bytes (NIST SP 800-38D §8.2). */
export const IV_LENGTH_BYTES = 12;
/** AES-GCM authentication tag length in bytes. */
export const AUTH_TAG_LENGTH_BYTES = 16;
/** Required key length in bytes (AES-256). */
export const KEY_LENGTH_BYTES = 32;

/** Encoded payload returned by {@link encrypt}. */
export type EncryptedPayload = string;

/** Error raised when decryption cannot recover the original plaintext. */
export class DecryptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'DecryptionError';
    if (options?.cause !== undefined) {
      // Preserve the underlying crypto error for diagnostics.
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Decode a base64-encoded AES-256 key from environment configuration.
 *
 * Returns a fresh `Buffer` of exactly {@link KEY_LENGTH_BYTES}. Throws when
 * the input is missing, malformed, or the wrong length.
 */
export function decodeEncryptionKey(raw: string | undefined): Buffer {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('LOCAL_ENCRYPTION_KEY is required (base64-encoded 32-byte AES-256 key).');
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, 'base64');
  } catch (error) {
    throw new Error(`LOCAL_ENCRYPTION_KEY is not valid base64: ${(error as Error).message}`);
  }

  if (decoded.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `LOCAL_ENCRYPTION_KEY must decode to ${KEY_LENGTH_BYTES} bytes (AES-256); received ${decoded.length}.`
    );
  }

  return decoded;
}

/**
 * Generate a fresh AES-256 key, returned as a base64-encoded string suitable
 * for `LOCAL_ENCRYPTION_KEY`. Used as a development convenience when no key
 * has been supplied — production startup refuses to derive a key this way.
 */
export function generateEncryptionKeyBase64(): string {
  return randomBytes(KEY_LENGTH_BYTES).toString('base64');
}

/**
 * Encrypt `plaintext` using AES-256-GCM and bind the result to `aad`.
 *
 * Returns a versioned, base64-encoded payload of the form `v1:...`. The
 * returned value is safe to write to disk and to surface in logs (no
 * sensitive material is leaked through the encoded form).
 */
export function encrypt(plaintext: string, key: Buffer, aad: string): EncryptedPayload {
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(`encrypt() requires a ${KEY_LENGTH_BYTES}-byte key; received ${key.length}.`);
  }
  if (typeof plaintext !== 'string') {
    throw new Error('encrypt() plaintext must be a string.');
  }

  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_LENGTH_BYTES });
  if (aad.length > 0) {
    cipher.setAAD(Buffer.from(aad, 'utf8'));
  }
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Layout: iv(12) || authTag(16) || ciphertext
  const payload = Buffer.concat([iv, authTag, ciphertext]);
  return ENCRYPTION_VERSION_PREFIX + payload.toString('base64');
}

/**
 * Decrypt a versioned payload produced by {@link encrypt}.
 *
 * Verifies the `v1:` version prefix, the AAD, and the auth tag. Any
 * mismatch raises {@link DecryptionError} so the caller can surface a
 * single, stable error to operators instead of leaking crypto internals.
 */
export function decrypt(payload: EncryptedPayload, key: Buffer, aad: string): string {
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(`decrypt() requires a ${KEY_LENGTH_BYTES}-byte key; received ${key.length}.`);
  }
  if (typeof payload !== 'string' || !payload.startsWith(ENCRYPTION_VERSION_PREFIX)) {
    throw new DecryptionError(
      `Unsupported encryption payload: missing '${ENCRYPTION_VERSION_PREFIX}' prefix.`
    );
  }

  const decoded = Buffer.from(payload.slice(ENCRYPTION_VERSION_PREFIX.length), 'base64');
  const minSize = IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES;
  if (decoded.length < minSize) {
    throw new DecryptionError(
      `Encrypted payload is too short (${decoded.length} bytes); expected at least ${minSize}.`
    );
  }

  const iv = decoded.subarray(0, IV_LENGTH_BYTES);
  const authTag = decoded.subarray(IV_LENGTH_BYTES, minSize);
  const ciphertext = decoded.subarray(minSize);

  const decipher = createDecipheriv('aes-256-gcm', key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });
  decipher.setAuthTag(authTag);
  if (aad.length > 0) {
    decipher.setAAD(Buffer.from(aad, 'utf8'));
  }

  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch (error) {
    throw new DecryptionError('Failed to decrypt payload (auth tag mismatch or AAD mismatch).', {
      cause: error,
    });
  }
}

/**
 * Constant-time comparison helper exposed for callers that need to verify
 * opaque tokens (admin secrets, etc.) without leaking timing information.
 *
 * Falls back to `false` when the lengths differ — we still pay for a
 * constant-time memcmp on a zero-padded view so the rejection time does
 * not reveal the expected token length.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    // Pad to common length to keep the comparison constant-time relative to
    // the longer input. The mismatch is still detected via the XOR result.
    const max = Math.max(aBuf.length, bBuf.length, 1);
    const paddedA = Buffer.alloc(max);
    const paddedB = Buffer.alloc(max);
    aBuf.copy(paddedA);
    bBuf.copy(paddedB);
    timingSafeEqual(paddedA, paddedB);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}
