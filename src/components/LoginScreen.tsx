'use client';

import Link from 'next/link';
import { BrandMark } from '@/components/BrandMark';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useI18n } from '@/i18n/I18nProvider';

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

  const form = (
    <div className={`w-full ${embedded ? 'max-w-[480px]' : 'max-w-md'} px-4`}>
      {!embedded && (
        <>
          <div className="mb-4 flex justify-center">
            <LanguageSwitcher />
          </div>
          <div className="mb-6 flex justify-center">
            <BrandMark compact showTagline={false} />
          </div>
        </>
      )}
      <h2 className="mb-1 text-center text-xl font-semibold">
        {embedded ? t('home.loginTitle') : t('login.title')}
      </h2>
      {embedded ? (
        <p className="mb-4 text-center text-sm text-secondary">{t('home.loginSubtitle')}</p>
      ) : (
        <p className="mb-4 text-center text-sm text-secondary">{t('login.hint')}</p>
      )}
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-card">
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-secondary">Email</label>
            <input
              className="mt-2 w-full rounded-[10px] border border-border-strong bg-surface px-3 py-3 text-base text-foreground"
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              placeholder="email@example.com"
              type="email"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="text-sm text-secondary">Password</label>
            <input
              className="mt-2 w-full rounded-[10px] border border-border-strong bg-surface px-3 py-3 text-base text-foreground"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </div>
          <button
            type="submit"
            disabled={loginLoading}
            className="min-h-11 w-full rounded-[10px] bg-accent px-4 py-3 font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {loginLoading ? '…' : t('common.login')}
          </button>
          {loginError ? (
            <div className="rounded-lg border border-danger/25 bg-danger-bg p-3 text-sm text-danger">
              {loginError}
            </div>
          ) : null}
        </form>
      </div>
      {!embedded && (
        <div className="mt-4 text-center">
          <Link href="/" className="text-sm text-secondary hover:text-foreground">
            {t('common.backHome')}
          </Link>
        </div>
      )}
    </div>
  );

  if (embedded) {
    return <div className="flex justify-center">{form}</div>;
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-background px-4 py-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] text-foreground">
      {form}
    </div>
  );
}
