import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createLettermintAdapter, LETTERMINT_SEND_URL } from '@/lib/email/lettermintAdapter';
import { createResendAdapter } from '@/lib/email/resendAdapter';
import {
  canWorkerSend,
  idempotencyWindowDuplicateRisk,
  outboxScheduledRetrySpanSeconds,
  PROVIDER_IDEMPOTENCY_DUPLICATE_RISK,
  PROVIDER_IDEMPOTENCY_WINDOW_SECONDS,
  runOutboxWorker,
} from '@/lib/email/outboxWorker';
import {
  LETTERMINT_IDEMPOTENCY_KEY_MAX,
  providerIdempotencyKey,
} from '@/lib/email/providerIdempotency';
import { honestyFromDeliveryState, isPermanentProviderFailure } from '@/lib/emailCore';

const sendInput = {
  to: 'owner@example.com',
  subject: 'Receipt',
  html: '<p>private body</p>',
  fromName: 'Complex',
  fromEmail: 'mail@example.com',
  replyTo: 'reply@example.com',
  idempotencyKey: 'outbox:pb1:1',
};

function tokenHeader(init?: RequestInit): string | null {
  return new Headers(init?.headers).get('x-lettermint-token');
}

describe('Email Core · Lettermint adapter', () => {
  it('accepts 202 message_id without treating it as delivery', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(LETTERMINT_SEND_URL);
      expect(tokenHeader(init)).toBe('lm_test');
      expect(new Headers(init?.headers).get('Authorization')).toBeNull();
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('outbox:pb1:1');
      expect(String(init?.body)).toContain('"html":"<p>private body</p>"');
      expect(String(init?.body)).not.toContain('lm_test');
      return new Response(JSON.stringify({ message_id: 'msg_1', status: 'pending' }), {
        status: 202,
      });
    });
    const adapter = createLettermintAdapter({
      apiKey: 'lm_test',
      http: { fetch: fetchMock as unknown as typeof fetch },
    });
    const res = await adapter.send(sendInput);
    expect(res).toEqual({ ok: true, providerMessageId: 'msg_1' });
    expect(honestyFromDeliveryState({ status: 'sent' })).toBe('ACCEPTED');
    expect(honestyFromDeliveryState({ status: 'sent', latestEventType: 'pending' })).not.toBe(
      'SENT'
    );
  });

  it('rejects a success body without message_id and does not copy the payload', async () => {
    const adapter = createLettermintAdapter({
      apiKey: 'lm_test',
      http: {
        fetch: async () =>
          new Response(JSON.stringify({ id: 'email_1', html: '<p>private body</p>' }), {
            status: 202,
          }),
      },
    });
    const res = await adapter.send(sendInput);
    expect(res).toEqual({
      ok: false,
      errorCode: 'missing_provider_id',
      responseClass: 'error',
      status: 202,
    });
    expect(JSON.stringify(res)).not.toContain('private body');
    expect(JSON.stringify(res)).not.toContain('lm_test');
  });

  it('classifies auth, validation, 429, 5xx and timeout with the queue rules', async () => {
    const cases: Array<{
      status?: number;
      error?: unknown;
      body?: string;
      errorCode: string;
      responseClass: string;
      permanent: boolean;
    }> = [
      { status: 401, errorCode: 'forbidden', responseClass: 'rejected', permanent: true },
      { status: 403, errorCode: 'forbidden', responseClass: 'rejected', permanent: true },
      { status: 422, errorCode: 'validation_error', responseClass: 'rejected', permanent: true },
      { status: 429, errorCode: 'rate_limited', responseClass: 'rate_limited', permanent: false },
      { status: 503, errorCode: 'http_503', responseClass: 'error', permanent: false },
      {
        error: Object.assign(new Error('aborted'), { name: 'TimeoutError' }),
        errorCode: 'timeout',
        responseClass: 'error',
        permanent: false,
      },
    ];

    for (const item of cases) {
      const adapter = createLettermintAdapter({
        apiKey: 'lm_test',
        http: {
          fetch: async () => {
            if (item.error) throw item.error;
            return new Response(
              JSON.stringify({ message: 'lm_test owner@example.com private body' }),
              { status: item.status }
            );
          },
        },
      });
      const res = await adapter.send(sendInput);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errorCode).toBe(item.errorCode);
        expect(res.responseClass).toBe(item.responseClass);
        expect(isPermanentProviderFailure(res.errorCode, res.responseClass)).toBe(item.permanent);
        expect(res.errorCode).not.toContain('lm_test');
        expect(res.errorCode).not.toContain('owner@example.com');
      }
    }
  });

  it('repeats the same idempotency key and body for the same operation', async () => {
    const bodies: string[] = [];
    const keys: Array<string | null> = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      keys.push(new Headers(init?.headers).get('Idempotency-Key'));
      return new Response(JSON.stringify({ message_id: 'msg_same', status: 'pending' }), {
        status: 202,
      });
    });
    const adapter = createLettermintAdapter({
      apiKey: 'lm_test',
      http: { fetch: fetchMock as unknown as typeof fetch },
    });
    await adapter.send(sendInput);
    await adapter.send({ ...sendInput });
    expect(bodies[0]).toBe(bodies[1]);
    expect(keys[0]).toBe('outbox:pb1:1');
    expect(keys[1]).toBe(keys[0]);
  });

  it('hashes different over-long keys without truncating them', () => {
    const left = `pb1:${'a'.repeat(400)}`;
    const right = `pb1:${'b'.repeat(400)}`;
    const leftKey = providerIdempotencyKey(left, LETTERMINT_IDEMPOTENCY_KEY_MAX);
    const rightKey = providerIdempotencyKey(right, LETTERMINT_IDEMPOTENCY_KEY_MAX);
    expect(leftKey).toBe(`sha256:${createHash('sha256').update(left, 'utf8').digest('hex')}`);
    expect(rightKey).not.toBe(leftKey);
    expect(leftKey).toBe(providerIdempotencyKey(left, LETTERMINT_IDEMPOTENCY_KEY_MAX));
    expect(left.startsWith(String(leftKey))).toBe(false);
    expect(providerIdempotencyKey('k'.repeat(255), LETTERMINT_IDEMPOTENCY_KEY_MAX)).toBe(
      'k'.repeat(255)
    );
    expect(providerIdempotencyKey('k'.repeat(256), LETTERMINT_IDEMPOTENCY_KEY_MAX)).toMatch(
      /^sha256:[0-9a-f]{64}$/
    );
  });
});

describe('Email Core · provider gates', () => {
  it('stays closed when sending is disabled, even with a Lettermint token', async () => {
    const fetchMock = vi.fn();
    expect(
      canWorkerSend({
        EMAIL_SENDING_ENABLED: 'false',
        EMAIL_MAIL_PROVIDER: 'lettermint',
        LETTERMINT_PROJECT_TOKEN: 'lm_test',
        RESEND_API_KEY: 're_test',
      })
    ).toEqual({ ok: false, reason: 'EMAIL_SENDING_ENABLED=false' });

    const result = await runOutboxWorker({
      supabase: { rpc: vi.fn() } as never,
      env: {
        EMAIL_SENDING_ENABLED: 'false',
        EMAIL_MAIL_PROVIDER: 'lettermint',
        LETTERMINT_PROJECT_TOKEN: 'lm_test',
      },
      adapter: createLettermintAdapter({
        apiKey: 'lm_test',
        http: { fetch: fetchMock as unknown as typeof fetch },
      }),
    });
    expect(result.skipped).toBe(true);
    expect(result.claimed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not use Resend when Lettermint is selected and its token is missing', () => {
    expect(
      canWorkerSend({
        EMAIL_SENDING_ENABLED: 'true',
        EMAIL_MAIL_PROVIDER: 'lettermint',
        RESEND_API_KEY: 're_test',
      })
    ).toEqual({ ok: false, reason: 'LETTERMINT_PROJECT_TOKEN_missing' });
  });

  it('keeps Resend when the provider setting is empty', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.resend.com/emails');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer re_test');
      expect(new Headers(init?.headers).get('x-lettermint-token')).toBeNull();
      return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
    });
    const result = await runOutboxWorker({
      supabase: readySupabase(),
      env: {
        EMAIL_SENDING_ENABLED: 'true',
        RESEND_API_KEY: 're_test',
        LETTERMINT_PROJECT_TOKEN: 'lm_unused',
      },
      http: { fetch: fetchMock as unknown as typeof fetch },
    });
    expect(result.sent).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();

    const direct = await createResendAdapter({
      apiKey: 're_test',
      http: { fetch: fetchMock as unknown as typeof fetch },
    }).send(sendInput);
    expect(direct).toEqual({ ok: true, providerMessageId: 'email_1' });
  });

  it('does not fall back to Resend after a Lettermint 5xx', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ message: 'lm_test secret body' }), { status: 500 });
    });
    const result = await runOutboxWorker({
      supabase: readySupabase(),
      env: {
        EMAIL_SENDING_ENABLED: 'true',
        EMAIL_MAIL_PROVIDER: 'lettermint',
        LETTERMINT_PROJECT_TOKEN: 'lm_test',
        RESEND_API_KEY: 're_test',
      },
      http: { fetch: fetchMock as unknown as typeof fetch },
    });
    expect(result.retried).toBe(1);
    expect(result.sent).toBe(0);
    expect(urls).toEqual([LETTERMINT_SEND_URL]);
  });

  it('does not call the provider when the database gate is off', async () => {
    const fetchMock = vi.fn();
    const result = await runOutboxWorker({
      supabase: {
        rpc: vi.fn(async (name: string) => {
          if (name === 'email_core_worker_get_context') {
            return { data: { email_enabled: false, db_ready: true }, error: null };
          }
          return { data: null, error: null };
        }),
      } as never,
      env: {
        EMAIL_SENDING_ENABLED: 'true',
        EMAIL_MAIL_PROVIDER: 'lettermint',
        LETTERMINT_PROJECT_TOKEN: 'lm_test',
      },
      adapter: createLettermintAdapter({
        apiKey: 'lm_test',
        http: { fetch: fetchMock as unknown as typeof fetch },
      }),
    });
    expect(result.reason).toBe('db_not_ready');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Email Core · idempotency window', () => {
  it('keeps the scheduled retry span inside 24 hours and names the later duplicate risk', () => {
    const span = outboxScheduledRetrySpanSeconds();
    expect(span).toBe(60 + 120 + 240 + 480 + 960 + 1920 + 3600);
    expect(span).toBeLessThan(PROVIDER_IDEMPOTENCY_WINDOW_SECONDS);
    expect(idempotencyWindowDuplicateRisk(span)).toBe(false);
    expect(idempotencyWindowDuplicateRisk(PROVIDER_IDEMPOTENCY_WINDOW_SECONDS + 1)).toBe(true);
    expect(PROVIDER_IDEMPOTENCY_DUPLICATE_RISK).toMatch(/24-hour/);
    expect(PROVIDER_IDEMPOTENCY_DUPLICATE_RISK).toMatch(/second copy/);
  });
});

describe('Email Core · Lettermint webhook stays out of Resend', () => {
  it('does not route Lettermint events through the Svix receiver', () => {
    const route = readFileSync('src/app/api/email/resend-webhook/route.ts', 'utf8');
    expect(route.toLowerCase()).not.toContain('lettermint');
    expect(existsSync('src/app/api/email/lettermint-webhook/route.ts')).toBe(false);
  });
});

function readySupabase() {
  return {
    rpc: vi.fn(async (name: string) => {
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
      if (name === 'email_core_digest_flush_ready') return { data: null, error: null };
      if (name === 'email_core_claim_outbox_batch') {
        return {
          data: [
            {
              id: 4,
              idempotency_key: 'outbox:pb1:1',
              module_key: 'system',
              template_key: 'email_test',
              locale: 'en',
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
        return { data: { ok: true, status: 'queued' }, error: null };
      }
      return { data: null, error: { message: `unexpected ${name}` } };
    }),
  } as never;
}
