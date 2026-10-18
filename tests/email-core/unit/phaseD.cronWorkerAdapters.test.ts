import { describe, expect, it, vi } from 'vitest';
import { assertCronAuthorized, EMAIL_CRON_HOBBY_SLOTS_UTC } from '@/lib/email/cronAuth';
import {
  canWorkerSend,
  computeBackoffSeconds,
  runOutboxWorker,
} from '@/lib/email/outboxWorker';
import {
  EMAIL_CORE_PHASE,
  honestyFromDeliveryState,
  isOutboxRetryEligible,
  isPermanentProviderFailure,
  resolveEmailLocale,
} from '@/lib/emailCore';
import { emailCoreNotifyMeeting } from '@/lib/emailCoreAdapters';
import { renderTransactionalEmail } from '@/lib/email/templates';

describe('Email Core Phase D · locale', () => {
  it('resolves recipient preferred locale then installation default', () => {
    expect(resolveEmailLocale('ru', 'bg')).toBe('ru');
    expect(resolveEmailLocale(null, 'en')).toBe('en');
    expect(resolveEmailLocale('xx', 'bg')).toBe('bg');
    expect(resolveEmailLocale(undefined, undefined)).toBe('bg');
  });

  it('renders BG / RU / EN subjects for email_test', () => {
    expect(renderTransactionalEmail({ templateKey: 'email_test', locale: 'bg' }).subject).toMatch(
      /тестов/i
    );
    expect(renderTransactionalEmail({ templateKey: 'email_test', locale: 'ru' }).subject).toMatch(
      /тестов/i
    );
    expect(renderTransactionalEmail({ templateKey: 'email_test', locale: 'en' }).subject).toMatch(
      /test email/i
    );
  });
});

describe('Email Core Phase D · permanent failure & retry', () => {
  it('classifies permanent provider failures', () => {
    expect(isPermanentProviderFailure('invalid_recipient')).toBe(true);
    expect(isPermanentProviderFailure('permanent:http_422')).toBe(true);
    expect(isPermanentProviderFailure('network_error')).toBe(false);
    expect(isPermanentProviderFailure('rate_limited')).toBe(false);
    expect(isPermanentProviderFailure('Invalid from address', 'rejected')).toBe(true);
  });

  it('retry eligibility excludes permanent / terminal statuses', () => {
    expect(
      isOutboxRetryEligible({ status: 'queued', attempts: 1, last_error_code: 'network_error' })
    ).toBe(true);
    expect(
      isOutboxRetryEligible({
        status: 'queued',
        attempts: 1,
        last_error_code: 'permanent:invalid',
      })
    ).toBe(false);
    expect(isOutboxRetryEligible({ status: 'sent', attempts: 1 })).toBe(false);
    expect(isOutboxRetryEligible({ status: 'queued', attempts: 8 })).toBe(false);
  });

  it('maps delivery honesty from outbox + webhook event', () => {
    expect(honestyFromDeliveryState({ status: 'queued' })).toBe('QUEUED');
    expect(honestyFromDeliveryState({ status: 'sent', latestEventType: 'delivered' })).toBe('SENT');
    expect(honestyFromDeliveryState({ status: 'sent', latestEventType: 'bounced' })).toBe('FAILED');
    expect(honestyFromDeliveryState({ status: 'failed' })).toBe('FAILED');
  });

  it('keeps exponential backoff bounds', () => {
    expect(computeBackoffSeconds(1)).toBe(60);
    expect(computeBackoffSeconds(10)).toBe(3600);
  });
});

describe('Email Core Phase D · cron auth', () => {
  it('rejects missing secrets and unauthorized callers', () => {
    const req = new Request('https://amadeus11.online/api/email/cron', { method: 'GET' });
    expect(assertCronAuthorized(req, {})).toEqual({
      ok: false,
      status: 503,
      error: 'cron_secret_not_configured',
    });
    expect(
      assertCronAuthorized(req, { CRON_SECRET: 'cron-secret', EMAIL_WORKER_SECRET: 'worker' })
    ).toEqual({ ok: false, status: 401, error: 'unauthorized' });
  });

  it('accepts CRON_SECRET or EMAIL_WORKER_SECRET bearer', () => {
    const cronReq = new Request('https://amadeus11.online/api/email/cron', {
      headers: { authorization: 'Bearer cron-secret' },
    });
    expect(
      assertCronAuthorized(cronReq, { CRON_SECRET: 'cron-secret', EMAIL_WORKER_SECRET: 'worker' })
    ).toEqual({ ok: true, via: 'cron' });

    const workerReq = new Request('https://amadeus11.online/api/email/cron', {
      headers: { authorization: 'Bearer worker' },
    });
    expect(
      assertCronAuthorized(workerReq, { CRON_SECRET: 'cron-secret', EMAIL_WORKER_SECRET: 'worker' })
    ).toEqual({ ok: true, via: 'worker' });
  });

  it('defines Hobby-safe once-daily cron at 06:00 UTC', () => {
    expect(EMAIL_CRON_HOBBY_SLOTS_UTC).toEqual(['0 6 * * *']);
    for (const expr of EMAIL_CRON_HOBBY_SLOTS_UTC) {
      expect(expr.split(' ')).toHaveLength(5);
      expect(expr.endsWith('* * *')).toBe(true);
    }
  });
});

describe('Email Core Phase D · gates + batch', () => {
  it('skips when host gate off', () => {
    expect(canWorkerSend({ EMAIL_SENDING_ENABLED: 'false', RESEND_API_KEY: 're' })).toEqual({
      ok: false,
      reason: 'EMAIL_SENDING_ENABLED=false',
    });
  });

  it('phase marker is D', () => {
    expect(EMAIL_CORE_PHASE).toBe('D');
  });

  it('runs bounded batch and respects idempotent empty claim', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'email_core_worker_get_context') {
        return {
          data: {
            email_enabled: true,
            db_ready: true,
            sender_email: 'no-reply@example.com',
            sender_name: 'Complex',
            reply_to_email: null,
          },
          error: null,
        };
      }
      if (name === 'email_core_claim_outbox_batch') {
        return { data: [], error: null };
      }
      return { data: null, error: null };
    });
    const supabase = { rpc } as never;
    const result = await runOutboxWorker({
      supabase,
      env: { EMAIL_SENDING_ENABLED: 'true', RESEND_API_KEY: 're_test' },
      limit: 10,
    });
    expect(result).toMatchObject({
      ok: true,
      skipped: false,
      reason: 'empty_batch',
      claimed: 0,
      sent: 0,
    });
    expect(rpc).toHaveBeenCalledWith('email_core_claim_outbox_batch', { p_limit: 10 });
  });

  it('marks permanent failures without retrying blindly', async () => {
    const completeCalls: unknown[] = [];
    const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'email_core_worker_get_context') {
        return {
          data: {
            email_enabled: true,
            db_ready: true,
            sender_email: 'no-reply@example.com',
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
              id: 9,
              idempotency_key: 'email_test:a@b.com:1',
              module_key: 'email_test',
              template_key: 'email_test',
              locale: 'en',
              to_email: 'bad@example.com',
              subject: null,
              payload: {},
              attempts: 1,
            },
          ],
          error: null,
        };
      }
      if (name === 'email_core_complete_outbox_send') {
        completeCalls.push(args);
        return { data: { status: 'failed' }, error: null };
      }
      return { data: null, error: null };
    });

    const result = await runOutboxWorker({
      supabase: { rpc } as never,
      env: { EMAIL_SENDING_ENABLED: 'true', RESEND_API_KEY: 're_test' },
      adapter: {
        name: 'resend',
        send: async () => ({
          ok: false as const,
          errorCode: 'invalid_recipient',
          responseClass: 'rejected' as const,
        }),
      },
      limit: 1,
    });

    expect(result.claimed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.retried).toBe(0);
    expect(completeCalls[0]).toMatchObject({
      p_ok: false,
      p_error_code: 'permanent:invalid_recipient',
    });
  });
});

describe('Email Core Phase D · meeting adapter', () => {
  it('stays in_app_only and does not enqueue without allowEmail for non-informational kinds', async () => {
    const rpc = vi.fn();
    const out = await emailCoreNotifyMeeting({ rpc } as never, {
      meetingId: 'm1',
      kind: 'legal_summons',
      toEmail: 'owner@example.com',
    });
    expect(out.honesty).toBe('in_app_only');
    expect(out.result).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
