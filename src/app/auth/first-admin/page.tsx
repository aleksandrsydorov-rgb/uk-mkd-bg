'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useI18n } from '@/i18n/I18nProvider';
import { BrandMark } from '@/components/BrandMark';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import {
  INITIAL_SETUP_ADMIN_PATH,
  isValidBootstrapToken,
} from '@/lib/firstBoot';

function FirstAdminInner() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenFromQuery = (searchParams.get('t') ?? '').trim();
  const nameFromQuery = (searchParams.get('name') ?? '').trim();

  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(nameFromQuery);
  const [token, setToken] = useState(tokenFromQuery);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      const email = data.session?.user?.email ?? null;
      setSessionEmail(email);
      setReady(true);
      if (!email) {
        setError(t('authFirstAdmin.errSession'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const canSubmit = useMemo(() => {
    return (
      Boolean(sessionEmail) &&
      displayName.trim().length >= 2 &&
      isValidBootstrapToken(token) &&
      password.length >= 8 &&
      password === password2 &&
      !busy
    );
  }, [sessionEmail, displayName, token, password, password2, busy]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session?.user?.email) {
        throw new Error(t('authFirstAdmin.errSession'));
      }

      const { error: pwdErr } = await supabase.auth.updateUser({ password });
      if (pwdErr) throw pwdErr;

      const { data: staffId, error: claimErr } = await supabase.rpc(
        'install_bootstrap_claim_first_admin',
        {
          p_approval_token: token.trim(),
          p_display_name: displayName.trim(),
        },
      );
      if (claimErr) throw claimErr;
      if (staffId == null) {
        throw new Error(t('authFirstAdmin.errClaim'));
      }

      router.replace(INITIAL_SETUP_ADMIN_PATH);
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : err instanceof Error
            ? err.message
            : t('authFirstAdmin.errGeneric');
      setError(msg);
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
        <h1 className="text-xl font-semibold">{t('authFirstAdmin.title')}</h1>
        <p className="text-sm text-secondary">{t('authFirstAdmin.lead')}</p>
        {sessionEmail ? (
          <p className="text-sm text-muted">
            {t('authFirstAdmin.signedInAs')}: <strong>{sessionEmail}</strong>
          </p>
        ) : null}
        {error ? (
          <div className="rounded-xl border border-danger/25 bg-danger-bg px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}
        {ready ? (
          <form onSubmit={(ev) => void onSubmit(ev)} className="space-y-3">
            <label className="grid gap-1 text-sm text-secondary">
              {t('authFirstAdmin.displayName')}
              <input
                type="text"
                className="w-full min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                value={displayName}
                onChange={(ev) => setDisplayName(ev.target.value)}
                autoComplete="name"
                required
              />
            </label>
            {!tokenFromQuery ? (
              <label className="grid gap-1 text-sm text-secondary">
                {t('authFirstAdmin.approvalToken')}
                <input
                  type="password"
                  className="w-full min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono"
                  value={token}
                  onChange={(ev) => setToken(ev.target.value)}
                  autoComplete="off"
                  required
                />
              </label>
            ) : null}
            <label className="grid gap-1 text-sm text-secondary">
              {t('invite.password')}
              <input
                type="password"
                className="w-full min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
              />
            </label>
            <label className="grid gap-1 text-sm text-secondary">
              {t('invite.password2')}
              <input
                type="password"
                className="w-full min-h-10 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                value={password2}
                onChange={(ev) => setPassword2(ev.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
              />
            </label>
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg disabled:opacity-50"
            >
              {busy ? t('common.saving') : t('authFirstAdmin.submit')}
            </button>
          </form>
        ) : (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        )}
      </main>
    </div>
  );
}

export default function FirstAdminPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted">…</div>}>
      <FirstAdminInner />
    </Suspense>
  );
}
