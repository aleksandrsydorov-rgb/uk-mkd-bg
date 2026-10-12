import { NextResponse } from 'next/server';
import type { Json } from '@/lib/database.types';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import {
  normalizeResendEventType,
  parseSvixHeaders,
  redactResendWebhookPayload,
  verifyResendWebhookSignature,
} from '@/lib/email/webhookSignature';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Resend webhook receiver.
 * Verifies Svix signature against the raw body. No cookies / no client secrets.
 */
export async function POST(request: Request) {
  const secret = (process.env.RESEND_WEBHOOK_SECRET ?? '').trim();
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'webhook_secret_not_configured' }, { status: 503 });
  }

  const rawBody = await request.text();
  const svix = parseSvixHeaders(request.headers);
  if (!svix) {
    return NextResponse.json({ ok: false, error: 'missing_svix_headers' }, { status: 400 });
  }

  const verified = verifyResendWebhookSignature({
    rawBody,
    headers: svix,
    secret,
  });
  if (!verified.ok) {
    return NextResponse.json({ ok: false, error: verified.reason }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const data = obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : {};
  const eventType = normalizeResendEventType(String(obj.type ?? ''));
  const providerMessageId =
    (typeof data.email_id === 'string' && data.email_id) ||
    (typeof data.id === 'string' && data.id) ||
    null;

  try {
    const supabase = createServiceRoleClient();
    const { data: recorded, error } = await supabase.rpc('email_core_record_delivery_event', {
      p_provider_message_id: providerMessageId,
      p_event_type: eventType,
      p_payload_redacted: redactResendWebhookPayload(payload) as Json,
      p_outbox_id: null,
    });
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, event: eventType, recorded });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'webhook_failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
