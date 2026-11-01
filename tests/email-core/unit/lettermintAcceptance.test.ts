import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { LETTERMINT_SEND_URL } from '@/lib/email/lettermintAdapter';
import { runOutboxWorker } from '@/lib/email/outboxWorker';
import { bg, en, ru } from '@/i18n/messages';
import {
  emailOutboxOperatorLabelKey,
  emailProviderUiPayload,
  honestyFromDeliveryState,
  isOutboxRetryEligible,
  outboxAttemptNeedsOperatorReview,
} from '@/lib/emailCore';

const MIGRATION = 'supabase/migrations/20261129180000_email_core_lettermint_attempt_guard.sql';
const HOUR_MS = 60 * 60 * 1000;

function sqlFunction(source: string, name: string): string {
  const marker = `function public.${name}`;
  const start = source.indexOf(marker);
  const rest = source.slice(start);
  const end = rest.indexOf('$fn$;');
  return rest.slice(0, end);
}

function context() {
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

describe('Email Core · Lettermint acceptance', () => {
  it('stores message_id after 202 and does not send that row again', async () => {
    let status = 'queued';
    let providerMessageId: string | null = null;
    const order: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      order.push('fetch');
      expect(url).toBe(LETTERMINT_SEND_URL);
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('outbox:accept:1');
      expect(new Headers(init?.headers).get('x-lettermint-token')).toBe('lm_test');
      return new Response(JSON.stringify({ message_id: 'msg_accepted', status: 'pending' }), {
        status: 202,
      });
    });
    const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'email_core_worker_get_context') return context();
      if (name === 'email_core_digest_flush_ready') return { data: null, error: null };
      if (name === 'email_core_claim_outbox_batch') {
        order.push('claim');
        if (status !== 'queued' && status !== 'held') return { data: [], error: null };
        if (providerMessageId) return { data: [], error: null };
        status = 'sending';
        return {
          data: [
            {
              id: 11,
              idempotency_key: 'outbox:accept:1',
              module_key: 'system',
              template_key: 'email_test',
              locale: 'ru',
              to_email: 'owner@example.com',
              subject: 'Receipt',
              payload: {},
              attempts: 1,
              first_attempt_at: new Date().toISOString(),
              uncertain_attempt: false,
            },
          ],
          error: null,
        };
      }
      if (name === 'email_core_complete_outbox_send') {
        expect(args).toMatchObject({
          p_ok: true,
          p_provider_message_id: 'msg_accepted',
          p_provider_response_class: 'accepted',
        });
        status = 'sent';
        providerMessageId = String(args?.p_provider_message_id);
        return { data: { status: 'sent' }, error: null };
      }
      return { data: null, error: { message: `unexpected ${name}` } };
    });
    const env = {
      EMAIL_SENDING_ENABLED: 'true',
      EMAIL_MAIL_PROVIDER: 'lettermint',
      LETTERMINT_PROJECT_TOKEN: 'lm_test',
    };
    const first = await runOutboxWorker({
      supabase: { rpc } as never,
      env,
      http: { fetch: fetchMock as unknown as typeof fetch },
    });
    const second = await runOutboxWorker({
      supabase: { rpc } as never,
      env,
      http: { fetch: fetchMock as unknown as typeof fetch },
    });

    expect(first.sent).toBe(1);
    expect(second.claimed).toBe(0);
    expect(second.sent).toBe(0);
    expect(providerMessageId).toBe('msg_accepted');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(order.indexOf('claim')).toBeLessThan(order.indexOf('fetch'));
    expect(isOutboxRetryEligible({ status: 'sent', attempts: 1 })).toBe(false);
    expect(honestyFromDeliveryState({ status: 'sent' })).toBe('ACCEPTED');
    expect(honestyFromDeliveryState({ status: 'sent', latestEventType: 'delivered' })).toBe('SENT');
    expect(honestyFromDeliveryState({ status: 'queued' })).toBe('QUEUED');
    expect(emailOutboxOperatorLabelKey({ status: 'sent' })).toBe('admin.emailAcceptedByService');
    expect(emailOutboxOperatorLabelKey({ status: 'sent', latestEventType: 'delivered' })).toBe(
      'admin.emailDelivered'
    );
    expect(emailOutboxOperatorLabelKey({ status: 'queued' })).toBe('admin.emailAwaitingSend');
    expect(emailOutboxOperatorLabelKey({ status: 'sent' })).not.toBe('admin.emailDelivered');
    expect(emailOutboxOperatorLabelKey({ status: 'sent' })).not.toBe('admin.emailAwaitingSend');
  });

  it('labels acceptance in ru, en and bg', () => {
    expect(ru.admin.emailAcceptedByService).toBe('Принято почтовым сервисом');
    expect(en.admin.emailAcceptedByService).toBe('Accepted by the mail service');
    expect(bg.admin.emailAcceptedByService).toBe('Прието от пощенската услуга');
    expect(ru.admin.emailDelivered).toBe('Доставлено');
    expect(en.admin.emailDelivered).toBe('Delivered');
    expect(bg.admin.emailDelivered).toBe('Доставено');
    expect(ru.admin.emailAwaitingSend).toBe('Ожидает отправки');
    expect(en.admin.emailAwaitingSend).toBe('Waiting to be sent');
    expect(bg.admin.emailAwaitingSend).toBe('Изчаква изпращане');
    expect(ru.admin.emailOperatorReview).toBe('Нужна проверка оператора');
    expect(en.admin.emailOperatorReview).toBe('Needs operator review');
    expect(bg.admin.emailOperatorReview).toBe('Нужна е проверка от оператор');
  });

  it('retries inside the window after timeout, then holds when the first attempt is older than 24 hours', async () => {
    const now = Date.now();
    const phases = ['fresh', 'restart', 'expired'] as const;
    let phaseIndex = 0;
    const completes: Array<Record<string, unknown>> = [];
    const holds: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    });
    const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'email_core_worker_get_context') return context();
      if (name === 'email_core_digest_flush_ready') return { data: null, error: null };
      if (name === 'email_core_claim_outbox_batch') {
        const phase = phases[phaseIndex] ?? 'expired';
        phaseIndex += 1;
        if (phase === 'fresh') {
          return {
            data: [
              {
                id: 21,
                idempotency_key: 'outbox:timeout:1',
                module_key: 'system',
                template_key: 'email_test',
                locale: 'en',
                to_email: 'owner@example.com',
                subject: 'Receipt',
                payload: {},
                attempts: 1,
                first_attempt_at: new Date(now).toISOString(),
                uncertain_attempt: false,
              },
            ],
            error: null,
          };
        }
        if (phase === 'restart') {
          return {
            data: [
              {
                id: 21,
                idempotency_key: 'outbox:timeout:1',
                module_key: 'system',
                template_key: 'email_test',
                locale: 'en',
                to_email: 'owner@example.com',
                subject: 'Receipt',
                payload: {},
                attempts: 2,
                first_attempt_at: new Date(now - HOUR_MS).toISOString(),
                uncertain_attempt: true,
              },
            ],
            error: null,
          };
        }
        return {
          data: [
            {
              id: 21,
              idempotency_key: 'outbox:timeout:1',
              module_key: 'system',
              template_key: 'email_test',
              locale: 'en',
              to_email: 'owner@example.com',
              subject: 'Receipt',
              payload: {},
              attempts: 3,
              first_attempt_at: new Date(now - 25 * HOUR_MS).toISOString(),
              uncertain_attempt: true,
            },
          ],
          error: null,
        };
      }
      if (name === 'email_core_complete_outbox_send') {
        completes.push(args ?? {});
        return { data: { status: 'queued' }, error: null };
      }
      if (name === 'email_core_hold_idempotency_review') {
        holds.push(args ?? {});
        return { data: { ok: true, held: true }, error: null };
      }
      return { data: null, error: { message: `unexpected ${name}` } };
    });
    const env = {
      EMAIL_SENDING_ENABLED: 'true',
      EMAIL_MAIL_PROVIDER: 'lettermint',
      LETTERMINT_PROJECT_TOKEN: 'lm_test',
    };
    const http = { fetch: fetchMock as unknown as typeof fetch };
    const timedOut = await runOutboxWorker({ supabase: { rpc } as never, env, http });
    const restarted = await runOutboxWorker({ supabase: { rpc } as never, env, http });
    const expired = await runOutboxWorker({ supabase: { rpc } as never, env, http });

    expect(timedOut.retried).toBe(1);
    expect(completes[0]).toMatchObject({ p_ok: false, p_error_code: 'timeout' });
    expect(restarted.retried).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryInit = fetchMock.mock.calls[1]?.[1];
    expect(new Headers(retryInit?.headers).get('Idempotency-Key')).toBe('outbox:timeout:1');
    expect(expired.reviewed).toBe(1);
    expect(expired.sent).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(holds).toEqual([{ p_outbox_id: 21 }]);
    expect(emailOutboxOperatorLabelKey({
      status: 'blocked_not_ready',
      lastErrorCode: 'idempotency_window_review',
    })).toBe('admin.emailOperatorReview');
  });

  it('still sends an old row that has never been attempted', async () => {
    const now = Date.now();
    expect(
      outboxAttemptNeedsOperatorReview({
        nowMs: now,
        attemptCount: 0,
        uncertainAttempt: false,
      })
    ).toBe(false);
    expect(
      outboxAttemptNeedsOperatorReview({
        nowMs: now,
        attemptCount: 3,
        firstAttemptAt: new Date(now - 30 * HOUR_MS).toISOString(),
        uncertainAttempt: false,
      })
    ).toBe(false);
    expect(
      outboxAttemptNeedsOperatorReview({
        nowMs: now,
        attemptCount: 2,
        uncertainAttempt: true,
      })
    ).toBe(true);

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ message_id: 'msg_old', status: 'pending' }), {
        status: 202,
      });
    });
    const rpc = vi.fn(async (name: string) => {
      if (name === 'email_core_worker_get_context') return context();
      if (name === 'email_core_digest_flush_ready') return { data: null, error: null };
      if (name === 'email_core_claim_outbox_batch') {
        return {
          data: [
            {
              id: 31,
              idempotency_key: 'outbox:old:1',
              module_key: 'system',
              template_key: 'email_test',
              locale: 'bg',
              to_email: 'owner@example.com',
              subject: 'Receipt',
              payload: {},
              attempts: 1,
              created_at: new Date(now - 400 * 24 * HOUR_MS).toISOString(),
              first_attempt_at: new Date(now).toISOString(),
              uncertain_attempt: false,
            },
          ],
          error: null,
        };
      }
      if (name === 'email_core_complete_outbox_send') {
        return { data: { status: 'sent' }, error: null };
      }
      return { data: null, error: { message: `unexpected ${name}` } };
    });
    const result = await runOutboxWorker({
      supabase: { rpc } as never,
      env: {
        EMAIL_SENDING_ENABLED: 'true',
        EMAIL_MAIL_PROVIDER: 'lettermint',
        LETTERMINT_PROJECT_TOKEN: 'lm_test',
      },
      http: { fetch: fetchMock as unknown as typeof fetch },
    });
    expect(result.sent).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('shows the host EMAIL_MAIL_PROVIDER and does not return secrets', async () => {
    const token = 'lm_secret_value';
    const resendKey = 're_secret_value';
    expect(
      emailProviderUiPayload({
        EMAIL_MAIL_PROVIDER: 'lettermint',
        LETTERMINT_PROJECT_TOKEN: token,
        RESEND_API_KEY: resendKey,
        EMAIL_WORKER_SECRET: 'worker_secret_value',
      })
    ).toEqual({ provider: 'lettermint' });
    expect(emailProviderUiPayload({ RESEND_API_KEY: resendKey })).toEqual({ provider: 'resend' });
    expect(emailProviderUiPayload({ EMAIL_MAIL_PROVIDER: 'smtp', RESEND_API_KEY: resendKey })).toEqual({
      provider: 'invalid',
    });
    const payload = emailProviderUiPayload({
      EMAIL_MAIL_PROVIDER: 'lettermint',
      LETTERMINT_PROJECT_TOKEN: token,
      RESEND_API_KEY: resendKey,
    });
    expect(Object.keys(payload)).toEqual(['provider']);
    expect(JSON.stringify(payload)).not.toContain(token);
    expect(JSON.stringify(payload)).not.toContain(resendKey);

    const previous = process.env.EMAIL_MAIL_PROVIDER;
    process.env.EMAIL_MAIL_PROVIDER = 'lettermint';
    process.env.LETTERMINT_PROJECT_TOKEN = token;
    try {
      const { GET } = await import('@/app/api/email/provider/route');
      const response = GET();
      expect(await response.json()).toEqual({ provider: 'lettermint' });
      const route = readFileSync('src/app/api/email/provider/route.ts', 'utf8');
      expect(route).not.toContain('LETTERMINT_PROJECT_TOKEN');
      expect(route).not.toContain('RESEND_API_KEY');
      expect(route).not.toContain('EMAIL_WORKER_SECRET');
    } finally {
      if (previous === undefined) delete process.env.EMAIL_MAIL_PROVIDER;
      else process.env.EMAIL_MAIL_PROVIDER = previous;
      delete process.env.LETTERMINT_PROJECT_TOKEN;
    }
  });

  it('keeps Resend acceptance on the same complete path', async () => {
    let seenId: string | null = null;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.resend.com/emails');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer re_test');
      expect(new Headers(init?.headers).get('x-lettermint-token')).toBeNull();
      return new Response(JSON.stringify({ id: 'email_ok' }), { status: 200 });
    });
    const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'email_core_worker_get_context') return context();
      if (name === 'email_core_digest_flush_ready') return { data: null, error: null };
      if (name === 'email_core_claim_outbox_batch') {
        if (seenId) return { data: [], error: null };
        return {
          data: [
            {
              id: 41,
              idempotency_key: 'outbox:resend:1',
              module_key: 'system',
              template_key: 'email_test',
              locale: 'en',
              to_email: 'owner@example.com',
              subject: 'Receipt',
              payload: {},
              attempts: 1,
              uncertain_attempt: false,
            },
          ],
          error: null,
        };
      }
      if (name === 'email_core_complete_outbox_send') {
        seenId = String(args?.p_provider_message_id);
        return { data: { status: 'sent' }, error: null };
      }
      return { data: null, error: { message: `unexpected ${name}` } };
    });
    const env = { EMAIL_SENDING_ENABLED: 'true', RESEND_API_KEY: 're_test' };
    const http = { fetch: fetchMock as unknown as typeof fetch };
    const first = await runOutboxWorker({ supabase: { rpc } as never, env, http });
    const second = await runOutboxWorker({ supabase: { rpc } as never, env, http });
    expect(first.sent).toBe(1);
    expect(seenId).toBe('email_ok');
    expect(second.claimed).toBe(0);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('records the attempt before the provider call and reviews only an unstored outcome', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const review = sqlFunction(sql, 'email_core_attempt_needs_review');
    const claim = sqlFunction(sql, 'email_core_claim_outbox_batch');
    const complete = sqlFunction(sql, 'email_core_complete_outbox_send');
    const reclaim = sqlFunction(sql, 'email_core_reclaim_stale_sending');

    expect(review).toContain('o.attempts <= 0');
    expect(review).toContain('o.first_attempt_at');
    expect(review).toContain("interval '24 hours'");
    expect(review).not.toContain('created_at');
    expect(review).toContain('v_attempt_rows = 0');

    const startedAt = claim.indexOf("select o.id, o.attempts, now(), null, 'started'");
    const returnedAt = claim.indexOf('return coalesce');
    expect(startedAt).toBeGreaterThan(0);
    expect(returnedAt).toBeGreaterThan(startedAt);
    expect(claim).toContain('first_attempt_at = coalesce(o.first_attempt_at, now())');
    expect(claim).toContain("o.status in ('queued', 'held')");

    expect(complete.indexOf('v_review :=')).toBeLessThan(
      complete.indexOf('insert into public.email_delivery_attempts')
    );
    expect(complete).toContain("when v_uncertain then 'timeout'");
    expect(complete).toContain('idempotency_window_review');
    expect(complete).toContain('provider_message_id');

    expect(reclaim.indexOf('email_core_attempt_needs_review')).toBeLessThan(
      reclaim.lastIndexOf("status = 'queued'")
    );
    expect(sql).not.toMatch(/sk_live|re_[A-Za-z0-9]{16,}|lm_[A-Za-z0-9]{16,}/);

    const stub = readFileSync('supabase/packages/fresh_install/115_ux_email_attempt_guard.sql', 'utf8');
    expect(stub).toMatch(/package stub|chronological migration/i);
    expect(stub.length).toBeLessThan(sql.length);
    expect(stub).not.toMatch(/create or replace function/i);
  });
});
