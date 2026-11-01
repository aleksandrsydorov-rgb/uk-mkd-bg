import { createHash } from 'node:crypto';

/** Resend accepts an Idempotency-Key of at most 256 characters. */
export const RESEND_IDEMPOTENCY_KEY_MAX = 256;

/** Lettermint accepts an Idempotency-Key of 1–255 characters. */
export const LETTERMINT_IDEMPOTENCY_KEY_MAX = 255;

/**
 * Keep a key that already fits. Longer keys become a stable SHA-256 digest
 * so a retry sends the same header without dropping the tail of the original.
 */
export function providerIdempotencyKey(raw: string, maxLength: number): string | null {
  const key = raw.trim();
  if (!key || maxLength < 71) return null;
  if (key.length <= maxLength) return key;
  return `sha256:${createHash('sha256').update(key, 'utf8').digest('hex')}`;
}
