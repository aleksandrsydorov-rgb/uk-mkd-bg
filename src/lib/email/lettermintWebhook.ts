/**
 * Lettermint webhook signature verification (official scheme).
 * Docs: https://lettermint.co/docs/platform/webhooks/signing
 * Secret is whsec_… (LETTERMINT_WEBHOOK_SECRET) — never the Project API token.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const LETTERMINT_WEBHOOK_TOLERANCE_SEC = 300;

export type LettermintWebhookVerifyOk = {
  ok: true;
  timestamp: number;
  eventType: string;
  payload: Record<string, unknown>;
  eventId: string | null;
  messageId: string | null;
};

export type LettermintWebhookVerifyFail = {
  ok: false;
  reason: string;
};

function parseSignatureHeader(header: string): { t: string; v1: string } | null {
  const elements: Record<string, string> = {};
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k && v) elements[k] = v;
  }
  if (!elements.t || !elements.v1) return null;
  return { t: elements.t, v1: elements.v1 };
}

function headerGet(headers: Headers | Record<string, string | string[] | undefined>, name: string): string {
  if (headers instanceof Headers) {
    return headers.get(name) ?? headers.get(name.toLowerCase()) ?? '';
  }
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
    }
  }
  return '';
}

export function normalizeLettermintEventType(raw: string): string {
  const v = String(raw ?? '').trim().toLowerCase();
  const map: Record<string, string> = {
    'message.delivered': 'delivered',
    'message.sent': 'sent',
    'message.created': 'sent',
    'message.hard_bounced': 'bounced',
    'message.soft_bounced': 'bounced',
    'message.spam_complaint': 'complained',
    'message.failed': 'failed',
    delivered: 'delivered',
    sent: 'sent',
    bounced: 'bounced',
    complained: 'complained',
    failed: 'failed',
  };
  return map[v] ?? (v.replace(/^message\./, '') || 'unknown');
}

export function redactLettermintWebhookPayload(payload: unknown): Record<string, unknown> {
  const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const data = obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : {};
  return {
    event: typeof obj.event === 'string' ? obj.event : null,
    id: typeof obj.id === 'string' ? obj.id : null,
    data: {
      message_id:
        (typeof data.message_id === 'string' && data.message_id) ||
        (typeof data.id === 'string' && data.id) ||
        null,
    },
  };
}

export function verifyLettermintWebhookSignature(opts: {
  rawBody: string | Buffer;
  headers: Headers | Record<string, string | string[] | undefined>;
  secret: string;
  nowSec?: number;
  toleranceSec?: number;
}): LettermintWebhookVerifyOk | LettermintWebhookVerifyFail {
  const secret = String(opts.secret ?? '').trim();
  if (!secret) return { ok: false, reason: 'webhook_secret_not_configured' };

  const signatureHeader = headerGet(opts.headers, 'X-Lettermint-Signature');
  const deliveryHeader = headerGet(opts.headers, 'X-Lettermint-Delivery');
  const eventHeader = headerGet(opts.headers, 'X-Lettermint-Event');

  if (!signatureHeader) return { ok: false, reason: 'signature_header_missing' };
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return { ok: false, reason: 'signature_header_malformed' };

  const timestamp = Number(parsed.t);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'signature_header_malformed' };

  if (deliveryHeader) {
    const deliveryTs = Number(deliveryHeader);
    if (!Number.isFinite(deliveryTs) || deliveryTs !== timestamp) {
      return { ok: false, reason: 'delivery_timestamp_mismatch' };
    }
  }

  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const tolerance = opts.toleranceSec ?? LETTERMINT_WEBHOOK_TOLERANCE_SEC;
  if (Math.abs(now - timestamp) > tolerance) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }

  const raw =
    typeof opts.rawBody === 'string' ? opts.rawBody : Buffer.from(opts.rawBody).toString('utf8');
  const signedPayload = `${timestamp}.${raw}`;
  const expected = createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  const provided = parsed.v1;
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'signature_mismatch' };
    }
  } catch {
    return { ok: false, reason: 'signature_mismatch' };
  }

  let payload: Record<string, unknown>;
  try {
    const parsedJson = JSON.parse(raw) as unknown;
    if (!parsedJson || typeof parsedJson !== 'object') {
      return { ok: false, reason: 'payload_invalid' };
    }
    payload = parsedJson as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'body_invalid' };
  }

  const data =
    payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : {};
  const eventType = normalizeLettermintEventType(
    String(eventHeader || payload.event || '')
  );
  const eventId = typeof payload.id === 'string' ? payload.id : null;
  const messageId =
    (typeof data.message_id === 'string' && data.message_id) ||
    (typeof data.id === 'string' && data.id) ||
    (typeof payload.message_id === 'string' && payload.message_id) ||
    null;

  return {
    ok: true,
    timestamp,
    eventType,
    payload,
    eventId,
    messageId,
  };
}
