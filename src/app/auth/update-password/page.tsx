'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useI18n } from '@/i18n/I18nProvider';
import { BrandMark } from '@/components/BrandMark';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export default function UpdatePasswordPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      const supabase = createClient();
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        throw new Error(t('authCallback.errMissing'));
      }
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) throw updErr;
      // Recovery complete: force fresh login with the new password.
      await supabase.auth.signOut();
      router.replace('/?passwordUpdated=1#resident-login');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('authCallback.errGeneric'));
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
        <h1 className="text-xl font-semibold">{t('authUpdatePassword.title')}</h1>
        <p className="text-sm text-secondary">{t('authUpdatePassword.lead')}</p>
        {error ? (
          <div className="rounded-xl border border-danger/25 bg-danger-bg px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
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
            {busy ? t('common.saving') : t('authUpdatePassword.submit')}
          </button>
        </form>
      </main>
    </div>
  );
}
