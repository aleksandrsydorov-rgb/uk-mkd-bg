/**
 * Server-only AES-256-GCM for Lettermint Project API token at rest.
 * Key: EMAIL_SETTINGS_ENCRYPTION_KEY — 32-byte secret as base64 or 64-char hex.
 * Never import from client components. Never log plaintext or ciphertext in user UI.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const PREFIX = 'v1';

export function parseEmailSettingsEncryptionKey(
  raw: string | undefined = process.env.EMAIL_SETTINGS_ENCRYPTION_KEY
): Buffer | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  if (/^[0-9a-fA-F]{64}$/.test(v)) return Buffer.from(v, 'hex');
  try {
    const buf = Buffer.from(v, 'base64');
    if (buf.length === 32) return buf;
  } catch {
    /* fall through */
  }
  return null;
}

export function isEmailSettingsEncryptionConfigured(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): boolean {
  return Boolean(parseEmailSettingsEncryptionKey(env.EMAIL_SETTINGS_ENCRYPTION_KEY));
}

/** Returns opaque string suitable for DB storage. */
export function encryptProviderToken(
  plaintext: string,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): string {
  const key = parseEmailSettingsEncryptionKey(env.EMAIL_SETTINGS_ENCRYPTION_KEY);
  if (!key) {
    throw new Error('EMAIL_SETTINGS_ENCRYPTION_KEY_missing');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptProviderToken(
  ciphertext: string,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): string {
  const key = parseEmailSettingsEncryptionKey(env.EMAIL_SETTINGS_ENCRYPTION_KEY);
  if (!key) {
    throw new Error('EMAIL_SETTINGS_ENCRYPTION_KEY_missing');
  }
  const parts = String(ciphertext ?? '').split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error('provider_token_ciphertext_invalid');
  }
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const data = Buffer.from(parts[3], 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function safeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
