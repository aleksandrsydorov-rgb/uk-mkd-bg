'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useI18n } from '@/i18n/I18nProvider';

export function BrandMark({
  href = '/',
  compact = false,
  showTagline = true,
  prominent = false,
}: {
  href?: string;
  compact?: boolean;
  showTagline?: boolean;
  prominent?: boolean;
}) {
  const { t } = useI18n();
  const markBox = prominent
    ? 'h-11 px-1.5'
    : compact
      ? 'h-8 px-1'
      : 'h-9 px-1.5';
  const markImg = prominent ? 'h-9' : compact ? 'h-7' : 'h-8';
  const nameClass = prominent
    ? 'text-base font-bold tracking-[0.06em] sm:text-lg'
    : compact
      ? 'text-sm'
      : 'text-base sm:text-lg';

  return (
    <Link href={href} className="flex min-w-0 items-center gap-2.5">
      <span
        className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ${markBox}`}
      >
        <Image
          src="/brand/amadeus11-mark.png"
          alt=""
          width={580}
          height={350}
          className={`w-auto object-contain ${markImg}`}
        />
      </span>
      <span className="min-w-0">
        <span className={`block truncate font-bold tracking-[0.02em] text-foreground ${nameClass}`}>
          {t('brand.name')}
        </span>
        {showTagline && !compact && (
          <span className="block truncate text-[11px] font-normal text-secondary">
            {t('brand.tagline')}
          </span>
        )}
      </span>
    </Link>
  );
}

export function AmadeusFullLogo() {
  return (
    <div className="inline-flex max-w-[220px] rounded-xl bg-white p-2">
      <Image
        src="/brand/amadeus11-logo.png"
        alt="AMADEUS 11"
        width={785}
        height={615}
        className="h-auto w-full object-contain"
      />
    </div>
  );
}
