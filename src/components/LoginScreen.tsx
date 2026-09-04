'use client';

import Link from 'next/link';
import { BrandMark } from '@/components/BrandMark';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useI18n } from '@/i18n/I18nProvider';

export function LoginScreen({
  email,
  onEmailChange,
  onSubmit,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="relative min-h-screen bg-[#070b0a] text-white flex items-center justify-center">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-64 w-64 rounded-full bg-teal-500/10 blur-3xl" />
      </div>
      <div className="relative z-10 w-full max-w-md px-4">
        <div className="mb-4 flex justify-center">
          <LanguageSwitcher />
        </div>
        <div className="mb-6 flex justify-center">
          <BrandMark />
        </div>
        <h1 className="text-xl font-semibold text-center mb-4">{t('login.title')}</h1>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="text-sm text-white/70">Email</label>
              <input
                className="mt-2 w-full rounded-lg border border-white/10 bg-[#070b0a] px-3 py-2 text-white"
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                placeholder="email@example.com"
                type="email"
                autoComplete="email"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2.5 font-semibold text-white"
            >
              {t('common.login')}
            </button>
            <p className="text-xs text-white/40">
              {t('login.hint')}
            </p>
          </form>
        </div>
        <div className="text-center mt-4">
          <Link href="/" className="text-sm text-white/50 hover:text-white">
            {t('common.backHome')}
          </Link>
        </div>
      </div>
    </div>
  );
}
