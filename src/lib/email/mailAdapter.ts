/**
 * Selects one Email Core transport from complex settings (preferred) or host env.
 * A Lettermint failure stays on Lettermint. This module does not send mail.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { createLettermintAdapter } from '@/lib/email/lettermintAdapter';
import type { MailAdapter, MailSendResult } from '@/lib/email/mailSend';
import { createResendAdapter } from '@/lib/email/resendAdapter';
import {
  resolveEmailMailProvider,
  type EmailMailProviderName,
} from '@/lib/emailCore';
import { decryptProviderToken } from '@/lib/email/settingsCrypto';

type EnvProbe = Record<string, string | undefined>;

type MailHttp = { fetch: typeof fetch };

const unavailable = (name: EmailMailProviderName | 'invalid'): MailAdapter => ({
  name: name === 'resend' ? 'resend' : 'lettermint',
  async send(): Promise<MailSendResult> {
    return { ok: false, errorCode: 'provider_not_configured', responseClass: 'rejected' };
  },
});

/** Legacy env-only factory (tests / fallback). */
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
  return unavailable('invalid');
}

/**
 * Prefer DB complex settings (Lettermint token ciphertext) so UI save applies without restart.
 * Env LETTERMINT_PROJECT_TOKEN / RESEND_API_KEY remain ops fallback when DB token absent.
 */
export async function createMailAdapterForWorker(opts: {
  supabase: SupabaseClient<Database>;
  env?: EnvProbe;
  http?: MailHttp;
  mailProvider?: string | null;
}): Promise<MailAdapter> {
  const env = opts.env ?? (process.env as EnvProbe);
  const providerRaw = String(opts.mailProvider ?? '').trim().toLowerCase();
  const provider: EmailMailProviderName | null =
    providerRaw === 'lettermint' || providerRaw === 'resend'
      ? providerRaw
      : resolveEmailMailProvider(env);

  if (provider === 'lettermint') {
    let apiKey = '';
    let decryptFailed = false;
    try {
      const tokenRes = await opts.supabase.rpc(
        'email_core_worker_get_provider_token_ciphertext' as never
      );
      const cipher = tokenRes.data as unknown;
      if (!tokenRes.error && typeof cipher === 'string' && cipher.trim()) {
        try {
          apiKey = decryptProviderToken(cipher, env);
        } catch {
          // Ciphertext present but EMAIL_SETTINGS_ENCRYPTION_KEY does not match
          // the key used at save time — do not treat as "no token configured".
          decryptFailed = true;
          apiKey = '';
        }
      }
    } catch {
      apiKey = '';
    }
    if (!apiKey) {
      apiKey = (env.LETTERMINT_PROJECT_TOKEN ?? '').trim();
    }
    if (!apiKey && decryptFailed) {
      return {
        name: 'lettermint' as const,
        async send(): Promise<MailSendResult> {
          return {
            ok: false,
            errorCode: 'token_decrypt_failed',
            responseClass: 'rejected',
          };
        },
      };
    }
    return createLettermintAdapter({ apiKey, http: opts.http });
  }

  if (provider === 'resend') {
    return createResendAdapter({
      apiKey: (env.RESEND_API_KEY ?? '').trim(),
      http: opts.http,
    });
  }

  return unavailable('invalid');
}
