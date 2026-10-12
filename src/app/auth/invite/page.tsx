'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { normalizeEmail } from '@/lib/email';
import {
  buildAuthCallbackUrl,
  buildInviteAcceptPath,
  isAlreadyRegisteredAuthError,
  isEmailNotConfirmedAuthError,
  isInvalidOtpAuthError,
  isSoftExistingSignupUser,
  signupOtpVerifyTypes,
} from '@/lib/auth/emailConfirmation';
import { useI18n } from '@/i18n/I18nProvider';
import { BrandMark } from '@/components/BrandMark';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

function InviteAcceptInner() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [supabase] = useState(() => createClient());
  const [email, setEmail] = useState('');
  const [apartment, setApartment] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [otp, setOtp] = useState('');
  const [needOtp, setNeedOtp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [inviteBlocked, setInviteBlocked] = useState(false);

  function inviteEmailRedirectTo() {
    return buildAuthCallbackUrl({
      nextPath: buildInviteAcceptPath(token),
    });
  }

  async function finishAccept() {
    const { error: accErr } = await supabase.rpc('accept_property_invite', {
      p_token: token,
      p_mark_accepted: true,
    });
    if (accErr) throw accErr;
    router.replace('/account');
  }

  function mapInviteRpcError(msg: string): string {
    if (/mismatch/i.test(msg)) return t('invite.errEmailMismatch');
    if (/ownership changed|not a current Book owner/i.test(msg))
      return t('invite.errOwnershipChanged');
    if (/incomplete/i.test(msg)) return t('invite.errIncompleteBook');
    if (/revoked/i.test(msg)) return t('invite.errRevoked');
    if (/expired/i.test(msg)) return t('invite.errExpired');
    if (/invalid token/i.test(msg)) return t('invite.errInvalidToken');
    if (/authentication required/i.test(msg)) return t('invite.errAuthRequired');
    return msg || t('invite.errGeneric');
  }

  async function requestSignupOtpResend(): Promise<void> {
    await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: inviteEmailRedirectTo() },
    });
  }

  async function enterOtpFlow(infoKey: 'invite.otpSent' | 'invite.otpResent' = 'invite.otpSent') {
    setNeedOtp(true);
    setInfo(t(infoKey));
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!token) {
        setError(t('invite.errToken'));
        setInviteBlocked(true);
        setLoading(false);
        return;
      }
      try {
        const { data, error: rpcErr } = await supabase.rpc('accept_property_invite', {
          p_token: token,
          p_mark_accepted: false,
        });
        if (rpcErr) throw rpcErr;
        const payload = data as {
          email: string;
          apartment_number: string;
          already_accepted?: boolean;
        };
        if (cancelled) return;
        const inviteEmail = normalizeEmail(payload.email);
        setEmail(inviteEmail);
        setApartment(String(payload.apartment_number ?? ''));
        if (payload.already_accepted) {
          setInfo(t('invite.alreadyAccepted'));
          setInviteBlocked(true);
        }

        const { data: userData } = await supabase.auth.getUser();
        const sessionEmail = normalizeEmail(userData.user?.email ?? '');
        const confirmed = Boolean(userData.user?.email_confirmed_at);
        if (
          sessionEmail &&
          sessionEmail === inviteEmail &&
          confirmed &&
          !payload.already_accepted
        ) {
          const { error: accErr } = await supabase.rpc('accept_property_invite', {
            p_token: token,
            p_mark_accepted: true,
          });
          if (accErr) throw accErr;
          if (!cancelled) router.replace('/account');
          return;
        }
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : t('invite.errGeneric');
          setError(mapInviteRpcError(msg));
          setInviteBlocked(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one load per invite token
  }, [supabase, t, token, router]);

  async function handleExistingOrUnconfirmed(): Promise<'accepted' | 'otp' | 'credentials'> {
    const { error: inErr } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (!inErr) {
      await finishAccept();
      return 'accepted';
    }
    if (isEmailNotConfirmedAuthError(inErr.message)) {
      try {
        await requestSignupOtpResend();
      } catch {
        /* still show OTP UI — Auth may rate-limit */
      }
      await enterOtpFlow('invite.otpSent');
      return 'otp';
    }
    return 'credentials';
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !email || inviteBlocked) return;
    if (password.length < 8) {
      setError(t('invite.errPasswordShort'));
      return;
    }
    if (password !== password2) {
      setError(t('invite.errPasswordMatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data: existing } = await supabase.auth.getUser();
      if (
        existing.user?.email &&
        normalizeEmail(existing.user.email) === email &&
        existing.user.email_confirmed_at
      ) {
        await finishAccept();
        return;
      }

      const emailRedirectTo = inviteEmailRedirectTo();
      const { data, error: signErr } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo },
      });

      if (signErr) {
        if (isAlreadyRegisteredAuthError(signErr.message)) {
          const outcome = await handleExistingOrUnconfirmed();
          if (outcome === 'credentials') setError(t('invite.errCredentials'));
          return;
        }
        throw signErr;
      }

      if (data.session) {
        await finishAccept();
        return;
      }

      if (isSoftExistingSignupUser(data.user)) {
        const outcome = await handleExistingOrUnconfirmed();
        if (outcome === 'credentials') setError(t('invite.errCredentials'));
        return;
      }

      // New user — Auth confirmation required (SMTP OTP / link).
      await enterOtpFlow('invite.otpSent');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('invite.errGeneric');
      setError(mapInviteRpcError(msg));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !otp) return;
    setBusy(true);
    setError(null);
    try {
      let lastErr: Error | null = null;
      for (const type of signupOtpVerifyTypes()) {
        const { error: otpErr } = await supabase.auth.verifyOtp({
          email,
          token: otp.trim(),
          type,
        });
        if (!otpErr) {
          lastErr = null;
          break;
        }
        lastErr = otpErr;
      }
      if (lastErr) {
        if (isInvalidOtpAuthError(lastErr.message)) {
          if (/expired/i.test(lastErr.message)) setError(t('invite.errOtpExpired'));
          else setError(t('invite.errOtpInvalid'));
          return;
        }
        throw lastErr;
      }
      await finishAccept();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('invite.errGeneric');
      setError(mapInviteRpcError(msg));
    } finally {
      setBusy(false);
    }
  }

  async function handleResendConfirmation() {
    if (!email || !token) return;
    setBusy(true);
    setError(null);
    try {
      await requestSignupOtpResend();
      setInfo(t('invite.otpResent'));
    } catch {
      // Generic — avoid account enumeration / Auth error leakage.
      setInfo(t('invite.otpResent'));
    } finally {
      setBusy(false);
    }
  }

  const canShowRegister = !loading && Boolean(email) && !inviteBlocked;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3">
          <BrandMark />
          <LanguageSwitcher />
        </div>
      </header>
      <main className="mx-auto max-w-lg space-y-4 px-4 py-8">
        <h1 className="text-xl font-semibold">{t('invite.title')}</h1>
        {loading ? <p className="text-sm text-muted">{t('common.loading')}</p> : null}
        {error ? (
          <div className="rounded-xl border border-danger/25 bg-danger-bg px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}
        {info ? (
          <div className="rounded-xl border border-success/25 bg-success-bg px-4 py-3 text-sm">
            {info}
          </div>
        ) : null}
        {canShowRegister ? (
          <>
            <p className="text-sm text-secondary">
              {t('invite.lead', { email, apt: apartment || '—' })}
            </p>
            {!needOtp ? (
              <form onSubmit={(e) => void handleRegister(e)} className="space-y-3">
                <label className="grid gap-1 text-sm text-secondary">
                  {t('invite.password')}
                  <input
                    type="password"
                    className="w-full min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </label>
                <label className="grid gap-1 text-sm text-secondary">
                  {t('invite.password2')}
                  <input
                    type="password"
                    className="w-full min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                    value={password2}
                    onChange={(e) => setPassword2(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? t('common.saving') : t('invite.submit')}
                </button>
              </form>
            ) : (
              <form onSubmit={(e) => void handleVerifyOtp(e)} className="space-y-3">
                <p className="text-sm text-secondary">{t('invite.authOtpHint')}</p>
                <label className="grid gap-1 text-sm text-secondary">
                  {t('invite.otp')}
                  <input
                    className="w-full min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                  />
                </label>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy ? t('common.saving') : t('invite.verifyOtp')}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleResendConfirmation()}
                    className="inline-flex rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground disabled:opacity-50"
                  >
                    {t('invite.resendOtp')}
                  </button>
                </div>
              </form>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted">…</div>}>
      <InviteAcceptInner />
    </Suspense>
  );
}
