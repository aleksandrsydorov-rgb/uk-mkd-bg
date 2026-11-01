/**
 * Shared send contract for Email Core providers.
 * `ok: true` means the provider API accepted the message, not that it was delivered.
 */

export type MailSendInput = {
  to: string;
  subject: string;
  html: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
  idempotencyKey?: string | null;
};

export type MailSendResult =
  | { ok: true; providerMessageId: string }
  | {
      ok: false;
      errorCode: string;
      responseClass: 'rejected' | 'rate_limited' | 'error';
      status?: number;
    };

export type MailAdapter = {
  readonly name: 'resend' | 'lettermint';
  send(input: MailSendInput): Promise<MailSendResult>;
};
