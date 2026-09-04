'use client';

import { LOCALES, LOCALE_META, type Locale } from '@/i18n/config';
import { useI18n } from '@/i18n/I18nProvider';

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className={`inline-flex rounded-full bg-white/[0.06] p-0.5 ${compact ? '' : ''}`} role="group" aria-label={t('common.language')}>
      {LOCALES.map((code: Locale) => (
        <button
          key={code}
          type="button"
          onClick={() => setLocale(code)}
          className={`rounded-full px-2 py-1 text-[11px] font-semibold tracking-wide transition ${
            locale === code
              ? 'bg-emerald-500/25 text-emerald-200'
              : 'text-white/45 hover:text-white/80'
          }`}
          title={LOCALE_META[code].native}
        >
          {LOCALE_META[code].short}
        </button>
      ))}
    </div>
  );
}
