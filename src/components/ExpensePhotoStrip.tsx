'use client';

import { useI18n } from '@/i18n/I18nProvider';
import { SignedStorageImage, SignedStorageLink } from '@/components/SignedStorageMedia';
import { isExpenseReceiptPdfPath } from '@/lib/expenses';

export function ExpensePhotoStrip({ urls, size = 'md' }: { urls: string[]; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  if (urls.length === 0) return null;
  const box = size === 'sm' ? 'h-12 w-12' : 'h-16 w-16';
  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((url) =>
        isExpenseReceiptPdfPath(url) ? (
          <SignedStorageLink
            key={url}
            stored={url}
            className={`${box} inline-flex items-center justify-center rounded-lg border border-border bg-hover px-1 text-center text-[10px] font-semibold leading-tight text-accent`}
          >
            PDF
          </SignedStorageLink>
        ) : (
          <SignedStorageImage
            key={url}
            stored={url}
            alt={t('photo.receipt')}
            className={`${box} rounded-lg border border-border object-cover`}
          />
        ),
      )}
    </div>
  );
}
