'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n/I18nProvider';

export function BrandMark({
  href = '/',
  compact = false,
}: {
  href?: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Link href={href} className="flex min-w-0 items-center gap-2.5">
      <div
        className={`flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/25 ${
          compact ? 'h-8 w-8' : 'h-9 w-9'
        }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" className={compact ? 'h-4 w-4' : 'h-5 w-5'}>
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </div>
      <span className={`truncate font-bold ${compact ? 'text-sm' : 'text-base sm:text-lg'}`}>
        {t('brand.name')} <span className="text-emerald-400">{t('brand.country')}</span>
      </span>
    </Link>
  );
}
