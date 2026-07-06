/**
 * Defense-in-depth secret redaction. The write rubric (docs/agent-memory-contract.md)
 * forbids storing secrets at the source; this is a best-effort backstop before any
 * `remember` call. It is deliberately conservative and is NOT a substitute for the
 * full import-time redaction stage (WP4 / GAPS G2).
 */

/** Patterns that identify a concrete credential anywhere in a string. */
const SECRET_PATTERNS: readonly RegExp[] = [
  // Private key blocks
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  // OpenAI-style keys (sk-, sk-proj-)
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  // ENGRAM API keys
  /\beng_[A-Za-z0-9]{16,}\b/,
  // AWS access key id
  /\bAKIA[0-9A-Z]{16}\b/,
  // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_) and fine-grained
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  // Slack tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  // Google API keys
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  // JWTs (three base64url segments)
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
];

/** `key = value` / `key: value` assignments whose key names a secret. */
const SECRET_ASSIGNMENT =
  /\b(?:api[_-]?key|secret|token|password|passwd|access[_-]?key|private[_-]?key|client[_-]?secret|auth(?:orization)?)\b\s*[:=]\s*['"]?([A-Za-z0-9_./+=-]{12,})['"]?/gi;

const REDACTED = '[REDACTED]';

export interface RedactionResult {
  text: string;
  redactionCount: number;
}

/** Replace any detected secrets with `[REDACTED]`. Never throws. */
export function redactSecrets(input: string): RedactionResult {
  let count = 0;
  let text = input;

  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(
      new RegExp(pattern, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'),
      () => {
        count += 1;
        return REDACTED;
      }
    );
  }

  text = text.replace(SECRET_ASSIGNMENT, (match, value: string) => {
    count += 1;
    return match.replace(value, REDACTED);
  });

  return { text, redactionCount: count };
}

/**
 * Whether the string is *predominantly* a secret and should be dropped entirely
 * rather than partially redacted. Used to skip storing a fact that is essentially
 * just a credential.
 */
export function looksLikeSecret(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0) return false;

  for (const pattern of SECRET_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match && match[0].length >= trimmed.length * 0.6) return true;
    // Private-key blocks are always a hard block regardless of length ratio.
    if (pattern.source.includes('PRIVATE KEY') && pattern.test(trimmed)) return true;
  }
  return false;
}
