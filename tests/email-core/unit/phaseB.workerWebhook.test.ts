import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createResendAdapter } from '@/lib/email/resendAdapter';
import {
  assertWorkerAuthorized,
  canWorkerSend,
  computeBackoffSeconds,
  runOutboxWorker,
} from '@/lib/email/outboxWorker';
import {
  decodeWebhookSecret,
  normalizeResendEventType,
  redactResendWebhookPayload,
  verifyResendWebhookSignature,
} from '@/lib/email/webhookSignature';
import { buildIdempotencyKey } from '@/lib/emailCore';

function signSvix(rawBody: string, secret: string, id = 'msg_1', timestamp = '1700000000') {
  const key = decodeWebhookSecret(secret);
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const sig = createHmac('sha256', key).update(signedContent, 'utf8').digest('base64');
  return { id, timestamp, signature: `v1,${sig}` };
}

describe('Email Core Phase B · Resend adapter (mocked)', () => {
  it('sends via Resend API with Idempotency-Key', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer re_test');
      expect(headers.get('Idempotency-Key')).toBe('idem-1');
      return new Response(JSON.stringify({ id: 'email_123' }), { status: 200 });
    });

    const adapter = createResendAdapter({
      apiKey: 're_test',
      http: { fetch: fetchMock as unknown as typeof fetch },
    });

    const res = await adapter.send({
      to: 'owner@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      fromName: 'Complex',
      fromEmail: 'mail@example.com',
      idempotencyKey: 'idem-1',
    });
    expect(res).toEqual({ ok: true, providerMessageId: 'email_123' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('maps 429 to rate_limited', async () => {
    const adapter = createResendAdapter({
      apiKey: 're_test',
      http: {
        fetch: async () => new Response('{}', { status: 429 }),
      },
    });
    const res = await adapter.send({
      to: 'a@b.com',
      subject: 'x',
      html: 'x',
      fromName: 'N',
      fromEmail: 'n@b.com',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.responseClass).toBe('rate_limited');
  });
});

describe('Email Core Phase B · webhook signature', () => {
  const secret = 'whsec_' + Buffer.from('super-secret-key').toString('base64');

  it('accepts valid signature over raw body', () => {
    const rawBody = '{"type":"email.delivered","data":{"email_id":"email_1"}}';
    const headers = signSvix(rawBody, secret);
    const result = verifyResendWebhookSignature({
      rawBody,
      headers,
      secret,
      nowSeconds: 1700000000,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects tampered body', () => {
    const rawBody = '{"type":"email.delivered"}';
    const headers = signSvix(rawBody, secret);
    const result = verifyResendWebhookSignature({
      rawBody: '{"type":"email.bounced"}',
      headers,
      secret,
      nowSeconds: 1700000000,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects stale timestamp', () => {
    const rawBody = '{}';
    const headers = signSvix(rawBody, secret, 'msg_2', '100');
    const result = verifyResendWebhookSignature({
      rawBody,
      headers,
      secret,
      nowSeconds: 1700000000,
      toleranceSeconds: 300,
    });
    expect(result).toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' });
  });

  it('normalizes and redacts event payloads', () => {
    expect(normalizeResendEventType('email.bounced')).toBe('bounced');
    expect(normalizeResendEventType('email.complained')).toBe('complained');
    const redacted = redactResendWebhookPayload({
      type: 'email.delivered',
      data: { email_id: 'email_9', to: ['secret@example.com'], subject: 'private' },
    });
    expect(redacted.email_id).toBe('email_9');
    expect(JSON.stringify(redacted)).not.toContain('secret@example.com');
    expect(JSON.stringify(redacted)).not.toContain('private');
  });
});

describe('Email Core Phase B · worker gates / retry / idempotency', () => {
  it('refuses send while EMAIL_SENDING_ENABLED=false', () => {
    expect(canWorkerSend({ EMAIL_SENDING_ENABLED: 'false', RESEND_API_KEY: 're_x' })).toEqual({
      ok: false,
      reason: 'EMAIL_SENDING_ENABLED=false',
    });
  });

  it('requires worker secret authorization', () => {
    const env = { EMAIL_WORKER_SECRET: 'worker-secret' };
    const bad = assertWorkerAuthorized(
      new Request('http://local/api/email/worker', { method: 'POST' }),
      env
    );
    expect(bad.ok).toBe(false);

    const good = assertWorkerAuthorized(
      new Request('http://local/api/email/worker', {
        method: 'POST',
        headers: { authorization: 'Bearer worker-secret' },
      }),
      env
    );
    expect(good).toEqual({ ok: true });
  });

  it('computes bounded exponential backoff', () => {
    expect(computeBackoffSeconds(1)).toBe(60);
    expect(computeBackoffSeconds(2)).toBe(120);
    expect(computeBackoffSeconds(20)).toBe(3600);
  });

  it('idempotency keys remain stable for retries', () => {
    const a = buildIdempotencyKey(['pkg_xfer', 47, 'submitted', 'hash']);
    const b = buildIdempotencyKey(['pkg_xfer', 47, 'submitted', 'hash']);
    expect(a).toBe(b);
  });

  it('runOutboxWorker skips without claiming when EMAIL_SENDING_ENABLED=false', async () => {
    const rpc = vi.fn();
    const supabase = { rpc } as never;
    const result = await runOutboxWorker({
      supabase,
      env: { EMAIL_SENDING_ENABLED: 'false', RESEND_API_KEY: 're_x' },
      adapter: createResendAdapter({
        apiKey: 're_x',
        http: { fetch: async () => new Response('{}', { status: 500 }) },
      }),
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('EMAIL_SENDING_ENABLED=false');
    expect(result.claimed).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('runOutboxWorker sends claimed rows with mocked Resend when gates open', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'email_core_worker_get_context') {
        return {
          data: {
            email_enabled: true,
            db_ready: true,
            sender_email: 'mail@example.com',
            sender_name: 'Complex',
            reply_to_email: null,
          },
          error: null,
        };
      }
      if (name === 'email_core_claim_outbox_batch') {
        return {
          data: [
            {
              id: 1,
              idempotency_key: 'k1',
              module_key: 'system',
              template_key: 'email_test',
              locale: 'bg',
              to_email: 'owner@example.com',
              subject: 'Test',
              payload: {},
              attempts: 1,
            },
          ],
          error: null,
        };
      }
      if (name === 'email_core_complete_outbox_send') {
        return { data: { ok: true, status: 'sent' }, error: null };
      }
      return { data: null, error: { message: `unexpected ${name}` } };
    });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'email_ok' }), { status: 200 }));
    const result = await runOutboxWorker({
      supabase: { rpc } as never,
      env: { EMAIL_SENDING_ENABLED: '1', RESEND_API_KEY: 're_x' },
      adapter: createResendAdapter({
        apiKey: 're_x',
        http: { fetch: fetchMock as unknown as typeof fetch },
      }),
    });

    expect(result.skipped).toBe(false);
    expect(result.claimed).toBe(1);
    expect(result.sent).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
