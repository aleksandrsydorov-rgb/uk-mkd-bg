'use client';

import { useI18n } from '@/i18n/I18nProvider';

export function ExpensePhotoStrip({ urls, size = 'md' }: { urls: string[]; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  if (urls.length === 0) return null;
  const box = size === 'sm' ? 'h-12 w-12' : 'h-16 w-16';
  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={t('photo.receipt')}
            className={`${box} rounded-lg border border-white/10 object-cover`}
          />
        </a>
      ))}
    </div>
  );
}