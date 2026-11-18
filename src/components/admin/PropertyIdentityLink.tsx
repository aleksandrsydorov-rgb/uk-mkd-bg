'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useI18n } from '@/i18n/I18nProvider';
import {
  buildApartmentCardHref,
  cardTabForModule,
  type ApartmentCardTab,
} from '@/lib/apartmentCardNav';
import {
  formatPropertyIdentity,
  formatPropertyIdentityCompact,
  type PropertyIdentityFields,
} from '@/lib/propertyIdentity';

export type PropertyIdentityLinkProps = {
  property: PropertyIdentityFields & { id: number };
  /** Prefer compact in dense tables. */
  compact?: boolean;
  /** Open this card tab (or module alias). */
  cardTab?: ApartmentCardTab | string | null;
  module?: Parameters<typeof cardTabForModule>[0];
  /** Show explicit «Открыть карточку» control beside the label. */
  showOpenAction?: boolean;
  className?: string;
  /** When false, render plain text (no link) — e.g. missing id. */
  link?: boolean;
};

/**
 * Human apartment identity as an explicit link into the single apartment card.
 * Does not wrap the whole table row — safe next to other row actions.
 */
export function PropertyIdentityLink({
  property,
  compact = false,
  cardTab,
  module,
  showOpenAction = false,
  className = '',
  link = true,
}: PropertyIdentityLinkProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const label = compact
    ? formatPropertyIdentityCompact(property, t)
    : formatPropertyIdentity(property, t);
  const tab = cardTab ?? (module ? cardTabForModule(module) : 'инфо');
  const href = buildApartmentCardHref({
    propertyId: property.id,
    cardTab: tab,
    returnSearch: searchParams.toString(),
    pathname: pathname || '/admin',
  });

  if (!link || !property.id) {
    return <span className={className}>{label}</span>;
  }

  return (
    <span className={`inline-flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 ${className}`}>
      <Link
        href={href}
        className="min-w-0 break-words font-medium text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        title={label}
        aria-label={t('property.openCardAria', { label })}
        onClick={(e) => e.stopPropagation()}
      >
        {label}
      </Link>
      {showOpenAction ? (
        <Link
          href={href}
          className="shrink-0 text-xs font-medium text-secondary underline-offset-2 hover:text-accent hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {t('property.openCard')}
        </Link>
      ) : null}
    </span>
  );
}
