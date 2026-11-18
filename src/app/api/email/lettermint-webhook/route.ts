import { NextResponse } from 'next/server';
import type { Json } from '@/lib/database.types';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import {
  redactLettermintWebhookPayload,
  verifyLettermintWebhookSignature,
} from '@/lib/email/lettermintWebhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lettermint delivery webhook.
 * Verifies HMAC (whsec_…) per https://lettermint.co/docs/platform/webhooks/signing
 * Absence of webhook does not block sending — UI stays at «accepted by service».
 */
export async function POST(request: Request) {
  const secret = (process.env.LETTERMINT_WEBHOOK_SECRET ?? '').trim();
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'webhook_secret_not_configured' }, { status: 503 });
  }

  const rawBody = await request.text();
  const verified = verifyLettermintWebhookSignature({
    rawBody,
    headers: request.headers,
    secret,
  });
  if (!verified.ok) {
    const status = verified.reason === 'timestamp_out_of_tolerance' ? 401 : 401;
    return NextResponse.json({ ok: false, error: verified.reason }, { status });
  }

  try {
    const supabase = createServiceRoleClient();
    const { data: recorded, error } = await supabase.rpc('email_core_record_delivery_event', {
      p_provider_message_id: verified.messageId,
      p_event_type: verified.eventType,
      p_payload_redacted: redactLettermintWebhookPayload(verified.payload) as Json,
      p_outbox_id: null,
      p_provider_event_id: verified.eventId,
    } as never);
    if (error) {
      // Fallback if 5-arg overload not yet applied: try 4-arg
      const legacy = await supabase.rpc('email_core_record_delivery_event', {
        p_provider_message_id: verified.messageId,
        p_event_type: verified.eventType,
        p_payload_redacted: redactLettermintWebhookPayload(verified.payload) as Json,
        p_outbox_id: null,
      });
      if (legacy.error) {
        return NextResponse.json({ ok: false, error: 'record_failed' }, { status: 500 });
      }
      return NextResponse.json({ ok: true, event: verified.eventType, recorded: legacy.data });
    }
    return NextResponse.json({ ok: true, event: verified.eventType, recorded });
  } catch {
    return NextResponse.json({ ok: false, error: 'webhook_failed' }, { status: 500 });
  }
}
