'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BrandMark } from '@/components/BrandMark';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useI18n } from '@/i18n/I18nProvider';
import { createClient } from '@/lib/supabase/client';
import { normalizeEmail } from '@/lib/email';
import { buildAuthCallbackUrl } from '@/lib/auth/emailConfirmation';

export function LoginScreen({
  email,
  onEmailChange,
  password,
  onPasswordChange,
  loginError,
  loginLoading,
  onSubmit,
  embedded = false,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  loginError?: string;
  loginLoading?: boolean;
  onSubmit: (e: React.FormEvent) => void;
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const [resetBusy, setResetBusy] = useState(false);
  const [resetInfo, setResetInfo] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  async function handleForgotPassword() {
    const nextEmail = normalizeEmail(email);
    if (!nextEmail) {
      setResetError(t('login.resetNeedEmail'));
      return;
    }
    setResetBusy(true);
    setResetError(null);
    setResetInfo(null);
    try {
      const supabase = createClient();
      const emailRedirectTo = buildAuthCallbackUrl({
        nextPath: '/auth/update-password',
      });
      const { error } = await supabase.auth.resetPasswordForEmail(nextEmail, {
        redirectTo: emailRedirectTo,
      });
      if (error) throw error;
      setResetInfo(t('login.resetSent'));
    } catch (err: unknown) {
      setResetError(err instanceof Error ? err.message : t('login.resetFailed'));
    } finally {
      setResetBusy(false);
    }
  }

  const fields = (
    <form onSubmit={onSubmit} className={embedded ? 'login-embed-form' : 'space-y-4'}>
      <div>
        <label className={embedded ? 'login-embed-label' : 'text-sm text-secondary'}>Email</label>
        <input
          className={
            embedded
              ? 'login-embed-input'
              : 'mt-2 w-full rounded-[10px] border border-border-strong bg-surface px-3 py-3 text-base text-foreground'
          }
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder="email@example.com"
          type="email"
          autoComplete="email"
        />
      </div>
      <div>
        <label className={embedded ? 'login-embed-label' : 'text-sm text-secondary'}>Password</label>
        <input
          className={
            embedded
              ? 'login-embed-input'
              : 'mt-2 w-full rounded-[10px] border border-border-strong bg-surface px-3 py-3 text-base text-foreground'
          }
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          type="password"
          autoComplete="current-password"
        />
      </div>
      <button
        type="submit"
        disabled={loginLoading}
        className={
          embedded
            ? 'login-embed-submit'
            : 'min-h-11 w-full rounded-[10px] bg-accent px-4 py-3 font-semibold text-white hover:bg-accent-hover disabled:opacity-50'
        }
      >
        {loginLoading ? '…' : t('common.login')}
      </button>
      <button
        type="button"
        disabled={resetBusy || loginLoading}
        onClick={() => void handleForgotPassword()}
        className={
          embedded
            ? 'text-left text-xs text-secondary underline-offset-2 hover:underline disabled:opacity-50'
            : 'w-full text-left text-sm text-secondary underline-offset-2 hover:underline disabled:opacity-50'
        }
      >
        {resetBusy ? t('login.resetSending') : t('login.forgotPassword')}
      </button>
      {resetInfo ? (
        <div className="rounded-lg border border-success/25 bg-success-bg p-3 text-sm">{resetInfo}</div>
      ) : null}
      {resetError ? (
        <div className="rounded-lg border border-danger/25 bg-danger-bg p-3 text-sm text-danger">
          {resetError}
        </div>
      ) : null}
      {loginError ? (
        <div className="rounded-lg border border-danger/25 bg-danger-bg p-3 text-sm text-danger">
          {loginError}
        </div>
      ) : null}
    </form>
  );

  if (embedded) {
    return (
      <div className="login-embed">
        <h2 className="login-embed-title">{t('home.loginTitle')}</h2>
        <p className="login-embed-sub">
          <span>{t('home.loginSubtitle')}</span>
          <span className="login-embed-sub-brand">{t('brand.name')}</span>
        </p>
        {fields}
      </div>
    );
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-background px-4 py-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] text-foreground">
      <div className="w-full max-w-md px-4">
        <div className="mb-4 flex justify-center">
          <LanguageSwitcher />
        </div>
        <div className="mb-6 flex justify-center">
          <BrandMark compact showTagline={false} />
        </div>
        <h2 className="mb-1 text-center text-xl font-semibold">{t('login.title')}</h2>
        <p className="mb-4 text-center text-sm text-secondary">{t('login.hint')}</p>
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">{fields}</div>
        <div className="mt-4 text-center">
          <Link href="/" className="text-sm text-secondary hover:text-foreground">
            {t('common.backHome')}
          </Link>
        </div>
      </div>
    </div>
  );
}
