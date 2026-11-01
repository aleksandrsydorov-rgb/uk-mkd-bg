/**
 * Server-only Lettermint Sending API adapter.
 * Never import from client components. Does not log tokens or message bodies.
 * A successful response means the API accepted the message (`message_id`), not that it was delivered.
 */

import {
  LETTERMINT_IDEMPOTENCY_KEY_MAX,
  providerIdempotencyKey,
} from '@/lib/email/providerIdempotency';
import type { MailSendInput, MailSendResult } from '@/lib/email/mailSend';

export const LETTERMINT_SEND_URL = 'https://api.lettermint.co/v1/send';
export const LETTERMINT_SEND_TIMEOUT_MS = 15_000;

export type LettermintHttpClient = {
  fetch: typeof fetch;
};

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String((error as { name?: unknown }).name ?? '') : '';
  return name === 'TimeoutError' || name === 'AbortError';
}

/** Stable JSON body. The same input always produces the same bytes. */
export function lettermintSendBody(input: MailSendInput): string {
  const from = input.fromName.trim()
    ? `${input.fromName.trim()} <${input.fromEmail.trim()}>`
    : input.fromEmail.trim();
  const body: Record<string, unknown> = {
    from,
    to: [input.to.trim()],
    subject: input.subject,
    html: input.html,
  };
  const reply = input.replyTo?.trim();
  if (reply) body.reply_to = [reply];
  return JSON.stringify(body);
}

export function createLettermintAdapter(opts: {
  apiKey: string;
  http?: LettermintHttpClient;
  baseUrl?: string;
  timeoutMs?: number;
}) {
  const http = opts.http ?? { fetch: globalThis.fetch.bind(globalThis) };
  const endpoint = `${(opts.baseUrl ?? LETTERMINT_SEND_URL).replace(/\/$/, '')}`;
  const apiKey = opts.apiKey.trim();
  const timeoutMs = opts.timeoutMs ?? LETTERMINT_SEND_TIMEOUT_MS;

  return {
    name: 'lettermint' as const,

    async send(input: MailSendInput): Promise<MailSendResult> {
      if (!apiKey) {
        return { ok: false, errorCode: 'missing_api_key', responseClass: 'error' };
      }

      const headers: Record<string, string> = {
        'x-lettermint-token': apiKey,
        'Content-Type': 'application/json',
      };
      const idempotency = input.idempotencyKey
        ? providerIdempotencyKey(input.idempotencyKey, LETTERMINT_IDEMPOTENCY_KEY_MAX)
        : null;
      if (idempotency) headers['Idempotency-Key'] = idempotency;

      let res: Response;
      try {
        res = await http.fetch(endpoint, {
          method: 'POST',
          headers,
          body: lettermintSendBody(input),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (isTimeoutError(error)) {
          return { ok: false, errorCode: 'timeout', responseClass: 'error' };
        }
        return { ok: false, errorCode: 'network_error', responseClass: 'error' };
      }

      if (res.status === 429) {
        return { ok: false, errorCode: 'rate_limited', responseClass: 'rate_limited', status: 429 };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, errorCode: 'forbidden', responseClass: 'rejected', status: res.status };
      }
      if (res.status === 400 || res.status === 413 || res.status === 422) {
        return {
          ok: false,
          errorCode: 'validation_error',
          responseClass: 'rejected',
          status: res.status,
        };
      }
      if (res.status === 409) {
        return {
          ok: false,
          errorCode: 'invalid_idempotency',
          responseClass: 'rejected',
          status: 409,
        };
      }
      if (res.status >= 500) {
        return {
          ok: false,
          errorCode: `http_${res.status}`,
          responseClass: 'error',
          status: res.status,
        };
      }

      let payload: unknown = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }

      if (!res.ok) {
        return {
          ok: false,
          errorCode: `http_${res.status}`,
          responseClass: 'error',
          status: res.status,
        };
      }

      const messageId =
        payload && typeof payload === 'object' && 'message_id' in payload
          ? String((payload as { message_id?: unknown }).message_id ?? '').trim()
          : '';
      if (!messageId) {
        return {
          ok: false,
          errorCode: 'missing_provider_id',
          responseClass: 'error',
          status: res.status,
        };
      }
      return { ok: true, providerMessageId: messageId };
    },
  };
}

export type LettermintAdapter = ReturnType<typeof createLettermintAdapter>;
