/**
 * Resend webhooks are signed with Svix-compatible headers.
 * Verify against the *raw* request body (never a re-serialized JSON object).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type SvixHeaders = {
  id: string;
  timestamp: string;
  signature: string;
};

export function parseSvixHeaders(headers: Headers): SvixHeaders | null {
  const id = headers.get('svix-id') ?? headers.get('webhook-id') ?? '';
  const timestamp = headers.get('svix-timestamp') ?? headers.get('webhook-timestamp') ?? '';
  const signature = headers.get('svix-signature') ?? headers.get('webhook-signature') ?? '';
  if (!id || !timestamp || !signature) return null;
  return { id, timestamp, signature };
}

/** Decode Resend/Svix secret (`whsec_...` base64 payload or raw string). */
export function decodeWebhookSecret(secret: string): Buffer {
  const raw = secret.trim();
  if (raw.startsWith('whsec_')) {
    return Buffer.from(raw.slice('whsec_'.length), 'base64');
  }
  return Buffer.from(raw, 'utf8');
}

export function verifyResendWebhookSignature(opts: {
  rawBody: string;
  headers: SvixHeaders;
  secret: string;
  /** Reject timestamps older than this many seconds (default 5 minutes). */
  toleranceSeconds?: number;
  nowSeconds?: number;
}): { ok: true } | { ok: false; reason: string } {
  const tolerance = opts.toleranceSeconds ?? 300;
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ts = Number(opts.headers.timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'invalid_timestamp' };
  }
  if (Math.abs(now - ts) > tolerance) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }

  const signedContent = `${opts.headers.id}.${opts.headers.timestamp}.${opts.rawBody}`;
  const key = decodeWebhookSecret(opts.secret);
  const expected = createHmac('sha256', key).update(signedContent, 'utf8').digest('base64');

  const candidates = opts.headers.signature
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [, sig] = part.split(',', 2);
      return (sig ?? part).trim();
    })
    .filter(Boolean);

  // Also accept bare base64 signatures without v1, prefix
  if (candidates.length === 0) {
    return { ok: false, reason: 'missing_signature' };
  }

  const expectedBuf = Buffer.from(expected, 'utf8');
  for (const cand of candidates) {
    const candBuf = Buffer.from(cand, 'utf8');
    if (candBuf.length === expectedBuf.length && timingSafeEqual(candBuf, expectedBuf)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: 'signature_mismatch' };
}

/** Map Resend event type → Email Core event label. */
export function normalizeResendEventType(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (t === 'email.delivered' || t === 'delivered') return 'delivered';
  if (t === 'email.bounced' || t === 'bounced' || t === 'bounce') return 'bounced';
  if (t === 'email.complained' || t === 'complained' || t === 'complaint') return 'complained';
  if (t === 'email.delivery_delayed' || t === 'delayed') return 'delayed';
  if (t === 'email.failed' || t === 'failed') return 'failed';
  if (t === 'email.sent' || t === 'sent') return 'sent';
  return t || 'unknown';
}

/** Strip PII-heavy fields before persisting webhook payload. */
export function redactResendWebhookPayload(payload: unknown): Record<string, unknown> {
  const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const data = obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : {};
  return {
    type: typeof obj.type === 'string' ? obj.type : null,
    created_at: typeof obj.created_at === 'string' ? obj.created_at : null,
    email_id: typeof data.email_id === 'string' ? data.email_id : data.id ?? null,
    // deliberately omit to / from / subject bodies
  };
}
