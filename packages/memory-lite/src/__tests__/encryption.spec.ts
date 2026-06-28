import { describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  decodeEncryptionKey,
  generateEncryptionKeyBase64,
  constantTimeEqual,
  DecryptionError,
  ENCRYPTION_VERSION_PREFIX,
  KEY_LENGTH_BYTES,
} from '../encryption';

describe('memory-lite encryption', () => {
  describe('decodeEncryptionKey', () => {
    it('accepts a 32-byte key encoded as base64', () => {
      const raw = generateEncryptionKeyBase64();
      const decoded = decodeEncryptionKey(raw);
      expect(decoded.length).toBe(KEY_LENGTH_BYTES);
    });

    it('rejects a missing key', () => {
      expect(() => decodeEncryptionKey(undefined)).toThrow();
      expect(() => decodeEncryptionKey('')).toThrow();
    });

    it('rejects the wrong key size', () => {
      const tooShort = Buffer.alloc(KEY_LENGTH_BYTES - 1).toString('base64');
      expect(() => decodeEncryptionKey(tooShort)).toThrow();
    });

    it('rejects malformed base64', () => {
      expect(() => decodeEncryptionKey('!!!not-base64!!!')).toThrow();
    });
  });

  describe('encrypt + decrypt round-trip', () => {
    const key = Buffer.from(generateEncryptionKeyBase64(), 'base64');
    const aad = 'memory-1';

    it('round-trips an arbitrary UTF-8 payload', () => {
      const plaintext = JSON.stringify({ hello: 'world', n: 42 });
      const ciphertext = encrypt(plaintext, key, aad);
      expect(ciphertext.startsWith(ENCRYPTION_VERSION_PREFIX)).toBe(true);
      expect(ciphertext).not.toContain('world');
      const recovered = decrypt(ciphertext, key, aad);
      expect(recovered).toBe(plaintext);
    });

    it('uses a fresh IV each call', () => {
      const a = encrypt('same payload', key, aad);
      const b = encrypt('same payload', key, aad);
      expect(a).not.toBe(b);
    });

    it('detects ciphertext tampering via the auth tag', () => {
      const ciphertext = encrypt('payload', key, aad);
      const stripped = ciphertext.slice(ENCRYPTION_VERSION_PREFIX.length);
      const decoded = Buffer.from(stripped, 'base64');
      // Flip a single bit in the ciphertext region (after iv+tag).
      const tailIdx = decoded.length - 1;
      decoded[tailIdx] = decoded[tailIdx]! ^ 0x01;
      const corrupted = ENCRYPTION_VERSION_PREFIX + decoded.toString('base64');
      expect(() => decrypt(corrupted, key, aad)).toThrow(DecryptionError);
    });

    it('rejects a mismatched AAD', () => {
      const ciphertext = encrypt('payload', key, 'memory-1');
      expect(() => decrypt(ciphertext, key, 'memory-2')).toThrow(DecryptionError);
    });

    it('rejects an unsupported version prefix', () => {
      expect(() => decrypt('v0:abcd', key, aad)).toThrow(DecryptionError);
      expect(() => decrypt('not-a-version-prefix', key, aad)).toThrow(DecryptionError);
    });

    it('rejects a payload that is too short to contain iv + tag', () => {
      expect(() => decrypt(ENCRYPTION_VERSION_PREFIX + 'AA==', key, aad)).toThrow(DecryptionError);
    });

    it('rejects the wrong key', () => {
      const ciphertext = encrypt('payload', key, aad);
      const otherKey = Buffer.from(generateEncryptionKeyBase64(), 'base64');
      expect(() => decrypt(ciphertext, otherKey, aad)).toThrow(DecryptionError);
    });

    it('enforces key length at the API boundary', () => {
      const shortKey = Buffer.alloc(KEY_LENGTH_BYTES - 1);
      expect(() => encrypt('x', shortKey, aad)).toThrow();
      expect(() => decrypt(ENCRYPTION_VERSION_PREFIX + 'AA==', shortKey, aad)).toThrow();
    });
  });

  describe('constantTimeEqual', () => {
    it('returns true for equal strings', () => {
      expect(constantTimeEqual('abc', 'abc')).toBe(true);
    });

    it('returns false for differing strings of equal length', () => {
      expect(constantTimeEqual('abc', 'abd')).toBe(false);
    });

    it('returns false for differing strings of different lengths', () => {
      expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    });

    it('returns false for two empty strings vs one empty string', () => {
      expect(constantTimeEqual('', '')).toBe(true);
      expect(constantTimeEqual('', 'a')).toBe(false);
    });
  });
});
