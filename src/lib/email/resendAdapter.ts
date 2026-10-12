/**
 * Server-only Resend HTTP adapter.
 * Never import from client components.
 */

export type ResendSendInput = {
  to: string;
  subject: string;
  html: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
  idempotencyKey?: string | null;
};

export type ResendSendResult =
  | { ok: true; providerMessageId: string }
  | {
      ok: false;
      errorCode: string;
      responseClass: 'rejected' | 'rate_limited' | 'error';
      status?: number;
    };

export type ResendHttpClient = {
  fetch: typeof fetch;
};

export function createResendAdapter(opts: {
  apiKey: string;
  http?: ResendHttpClient;
  baseUrl?: string;
}) {
  const http = opts.http ?? { fetch: globalThis.fetch.bind(globalThis) };
  const baseUrl = (opts.baseUrl ?? 'https://api.resend.com').replace(/\/$/, '');
  const apiKey = opts.apiKey.trim();

  return {
    name: 'resend' as const,

    async send(input: ResendSendInput): Promise<ResendSendResult> {
      if (!apiKey) {
        return { ok: false, errorCode: 'missing_api_key', responseClass: 'error' };
      }

      const from = input.fromName.trim()
        ? `${input.fromName.trim()} <${input.fromEmail}>`
        : input.fromEmail;

      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };
      if (input.idempotencyKey) {
        headers['Idempotency-Key'] = input.idempotencyKey.slice(0, 256);
      }

      let res: Response;
      try {
        res = await http.fetch(`${baseUrl}/emails`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            from,
            to: [input.to],
            subject: input.subject,
            html: input.html,
            reply_to: input.replyTo || undefined,
          }),
        });
      } catch {
        return { ok: false, errorCode: 'network_error', responseClass: 'error' };
      }

      if (res.status === 429) {
        return { ok: false, errorCode: 'rate_limited', responseClass: 'rate_limited', status: 429 };
      }

      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }

      if (!res.ok) {
        const msg =
          body && typeof body === 'object' && 'message' in body
            ? String((body as { message?: unknown }).message ?? 'resend_error')
            : `http_${res.status}`;
        return {
          ok: false,
          errorCode: msg.slice(0, 120),
          responseClass: res.status >= 400 && res.status < 500 ? 'rejected' : 'error',
          status: res.status,
        };
      }

      const id =
        body && typeof body === 'object' && 'id' in body
          ? String((body as { id?: unknown }).id ?? '')
          : '';
      if (!id) {
        return { ok: false, errorCode: 'missing_provider_id', responseClass: 'error' };
      }
      return { ok: true, providerMessageId: id };
    },
  };
}

export type ResendAdapter = ReturnType<typeof createResendAdapter>;
