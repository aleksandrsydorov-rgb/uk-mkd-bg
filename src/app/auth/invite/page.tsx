'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { normalizeEmail } from '@/lib/email';
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!token) {
        setError(t('invite.errToken'));
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
        setEmail(normalizeEmail(payload.email));
        setApartment(String(payload.apartment_number ?? ''));
        if (payload.already_accepted) {
          setInfo(t('invite.alreadyAccepted'));
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t('invite.errGeneric'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, t, token]);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !email) return;
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
      if (existing.user?.email && normalizeEmail(existing.user.email) === email) {
        await supabase.rpc('accept_property_invite', {
          p_token: token,
          p_mark_accepted: true,
        });
        router.replace('/account');
        return;
      }

      const { data, error: signErr } = await supabase.auth.signUp({
        email,
        password,
      });
      if (signErr) {
        // Already registered — ask to sign in, then mark accepted
        if (/already|registered|exists/i.test(signErr.message)) {
          const { error: inErr } = await supabase.auth.signInWithPassword({ email, password });
          if (inErr) throw inErr;
          await supabase.rpc('accept_property_invite', {
            p_token: token,
            p_mark_accepted: true,
          });
          router.replace('/account');
          return;
        }
        throw signErr;
      }

      if (data.session) {
        await supabase.rpc('accept_property_invite', {
          p_token: token,
          p_mark_accepted: true,
        });
        router.replace('/account');
        return;
      }

      // Email confirmation / OTP required
      setNeedOtp(true);
      setInfo(t('invite.otpSent'));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('invite.errGeneric'));
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
      const { error: otpErr } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: 'signup',
      });
      if (otpErr) throw otpErr;
      await supabase.rpc('accept_property_invite', {
        p_token: token,
        p_mark_accepted: true,
      });
      router.replace('/account');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('invite.errGeneric'));
    } finally {
      setBusy(false);
    }
  }

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
        {!loading && !error && email ? (
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
                <label className="grid gap-1 text-sm text-secondary">
                  {t('invite.otp')}
                  <input
                    className="w-full min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    required
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? t('common.saving') : t('invite.verifyOtp')}
                </button>
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
