'use client';

import { useI18n } from '@/i18n/I18nProvider';
import { SignedStorageImage } from '@/components/SignedStorageMedia';

export function ExpensePhotoStrip({ urls, size = 'md' }: { urls: string[]; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  if (urls.length === 0) return null;
  const box = size === 'sm' ? 'h-12 w-12' : 'h-16 w-16';
  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((url) => (
        <SignedStorageImage
          key={url}
          stored={url}
          alt={t('photo.receipt')}
          className={`${box} rounded-lg border border-border object-cover`}
        />
      ))}
    </div>
  );
}