import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import {
  encryptProviderToken,
  isEmailSettingsEncryptionConfigured,
} from '@/lib/email/settingsCrypto';
import { isEmailSendingEnvEnabled } from '@/lib/emailCore';
import { normalizeEmail } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  sender_email?: string;
  project_token?: string | null;
  enable?: boolean;
  action?: 'save_enable' | 'disable';
};

/**
 * Admin Lettermint connection: encrypts Project API token server-side.
 * Never returns the token. Empty project_token keeps the existing ciphertext.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { data: isAdmin, error: roleErr } = await supabase.rpc('has_staff_role' as never, {
    p_role: 'администрация',
  } as never);
  if (roleErr || isAdmin !== true) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const action = body.action === 'disable' ? 'disable' : 'save_enable';
  const enable = action === 'save_enable' ? body.enable !== false : false;

  if (enable && !isEmailSendingEnvEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        error: 'host_sending_disabled',
        host_sending_enabled: false,
      },
      { status: 409 }
    );
  }

  let senderEmail = normalizeEmail(String(body.sender_email ?? ''));
  if (action === 'save_enable' && (!senderEmail || !senderEmail.includes('@'))) {
    return NextResponse.json({ ok: false, error: 'invalid_sender_email' }, { status: 400 });
  }
  if (action === 'disable' && !senderEmail) {
    // Keep existing sender when disabling.
    try {
      const { data: settings } = await supabase.rpc('admin_get_email_settings');
      const row = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {};
      senderEmail = normalizeEmail(String(row.sender_email ?? '')) || 'noreply@invalid.local';
    } catch {
      senderEmail = 'noreply@invalid.local';
    }
  }

  const tokenRaw = typeof body.project_token === 'string' ? body.project_token.trim() : '';
  const replaceToken = tokenRaw.length > 0;
  if (replaceToken && !isEmailSettingsEncryptionConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'encryption_key_not_configured' },
      { status: 503 }
    );
  }

  let ciphertext: string | null = null;
  if (replaceToken) {
    try {
      ciphertext = encryptProviderToken(tokenRaw);
    } catch {
      return NextResponse.json({ ok: false, error: 'encrypt_failed' }, { status: 500 });
    }
  }

  let complexName = 'AMADEUS 11';
  try {
    const nameRes = await supabase.rpc('admin_get_complex_display_name' as never);
    const name = nameRes.data as unknown;
    if (typeof name === 'string' && name.trim()) complexName = name.trim();
  } catch {
    /* fallback */
  }

  try {
    const admin = createServiceRoleClient();
    const { data, error } = await admin.rpc(
      'email_core_service_save_lettermint_connection' as never,
      {
        p_sender_email: senderEmail || 'noreply@invalid.local',
        p_sender_name: complexName,
        p_enable: enable,
        p_token_ciphertext: ciphertext,
        p_replace_token: replaceToken,
        p_actor_email: user.email ?? null,
      } as never
    );
    if (error) {
      return NextResponse.json(
        { ok: false, error: 'save_failed', code: error.code ?? null },
        { status: 400 }
      );
    }

    const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    return NextResponse.json({
      ok: true,
      token_saved: replaceToken,
      host_sending_enabled: isEmailSendingEnvEnabled(),
      email_enabled: payload.email_enabled === true,
      has_provider_token: payload.has_provider_token === true,
      connection_status: payload.connection_status ?? null,
      mail_provider: 'lettermint',
      sender_name: complexName,
      sender_email: senderEmail,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'save_failed';
    // Never echo ciphertext / token material.
    if (/EMAIL_SETTINGS_ENCRYPTION_KEY/i.test(message)) {
      return NextResponse.json({ ok: false, error: 'encryption_key_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 });
  }
}

export async function GET() {
  const hostSending = isEmailSendingEnvEnabled();
  const encryptionConfigured = isEmailSettingsEncryptionConfigured();
  const workerSecretConfigured = Boolean((process.env.EMAIL_WORKER_SECRET ?? '').trim());
  const mailProvider = (process.env.EMAIL_MAIL_PROVIDER ?? '').trim().toLowerCase();
  return NextResponse.json({
    host_sending_enabled: hostSending,
    encryption_configured: encryptionConfigured,
    worker_secret_configured: workerSecretConfigured,
    mail_provider_env: mailProvider === 'lettermint' || mailProvider === 'resend' ? mailProvider : null,
    // Never expose secrets. Concrete block reasons for the admin UI:
    send_block_reason: !hostSending
      ? 'host_sending_disabled'
      : !encryptionConfigured
        ? 'encryption_key_not_configured'
        : null,
  });
}
