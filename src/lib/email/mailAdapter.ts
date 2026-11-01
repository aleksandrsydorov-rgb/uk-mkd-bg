/**
 * Selects one Email Core transport from the server environment.
 * A Lettermint failure stays on Lettermint. This module does not send mail.
 */

import { createLettermintAdapter } from '@/lib/email/lettermintAdapter';
import type { MailAdapter, MailSendResult } from '@/lib/email/mailSend';
import { createResendAdapter } from '@/lib/email/resendAdapter';
import { resolveEmailMailProvider } from '@/lib/emailCore';

type EnvProbe = Record<string, string | undefined>;

type MailHttp = { fetch: typeof fetch };

const unavailable: MailAdapter = {
  name: 'lettermint',
  async send(): Promise<MailSendResult> {
    return { ok: false, errorCode: 'provider_not_configured', responseClass: 'rejected' };
  },
};

export function createConfiguredMailAdapter(env: EnvProbe, http?: MailHttp): MailAdapter {
  const provider = resolveEmailMailProvider(env);
  if (provider === 'lettermint') {
    return createLettermintAdapter({
      apiKey: (env.LETTERMINT_PROJECT_TOKEN ?? '').trim(),
      http,
    });
  }
  if (provider === 'resend') {
    return createResendAdapter({ apiKey: (env.RESEND_API_KEY ?? '').trim(), http });
  }
  return unavailable;
}
