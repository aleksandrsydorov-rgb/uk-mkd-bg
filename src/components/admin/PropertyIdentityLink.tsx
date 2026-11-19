'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { MouseEvent } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import {
  APARTMENT_CARD_SECTION,
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

function liveSearchString(fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return window.location.search.replace(/^\?/, '');
}

function sectionIsApartments(search: string): boolean {
  return (new URLSearchParams(search).get('section') ?? '') === APARTMENT_CARD_SECTION;
}

/**
 * Overlay open uses history.pushState + popstate.
 * Next.js Link no-ops when the App Router still thinks cardProperty is in the URL
 * after a replaceState close (same class of bug as water meter shells).
 */
function openOverlayFromClick(
  e: MouseEvent,
  opts: { propertyId: number; cardTab: ApartmentCardTab | string; pathname: string },
) {
  e.preventDefault();
  e.stopPropagation();
  if (typeof window === 'undefined') return;
  const href = buildApartmentCardHref({
    propertyId: opts.propertyId,
    cardTab: opts.cardTab,
    currentSearch: window.location.search.replace(/^\?/, ''),
    pathname: opts.pathname,
    mode: 'overlay',
  });
  const next = `${window.location.pathname}${href.includes('?') ? href.slice(href.indexOf('?')) : ''}`;
  // Prefer pathname from href when build returns full path.
  const target = href.startsWith('/') ? href : next;
  if (`${window.location.pathname}${window.location.search}` === target) {
    window.dispatchEvent(new PopStateEvent('popstate'));
    return;
  }
  window.history.pushState(window.history.state, '', target);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

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
  const path = pathname || '/admin';
  // Prefer the live browser query: register filters may be written via replaceState
  // without updating Next.js useSearchParams, and «return» must keep q/status/page.
  const liveSearch = liveSearchString(searchParams.toString());
  const onApartments = sectionIsApartments(liveSearch);
  const href = buildApartmentCardHref({
    propertyId: property.id,
    cardTab: tab,
    currentSearch: liveSearch,
    pathname: path,
    mode: onApartments ? 'navigate' : 'overlay',
  });

  if (!link || !property.id) {
    return <span className={className}>{label}</span>;
  }

  const linkClass =
    'min-w-0 break-words font-medium text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
  const actionClass =
    'shrink-0 text-xs font-medium text-secondary underline-offset-2 hover:text-accent hover:underline';

  const overlayClick = (e: MouseEvent) =>
    openOverlayFromClick(e, { propertyId: property.id, cardTab: tab, pathname: path });

  return (
    <span className={`inline-flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 ${className}`}>
      {onApartments ? (
        <Link
          href={href}
          className={linkClass}
          title={label}
          aria-label={t('property.openCardAria', { label })}
          onClick={(e) => e.stopPropagation()}
        >
          {label}
        </Link>
      ) : (
        <a
          href={href}
          className={linkClass}
          title={label}
          aria-label={t('property.openCardAria', { label })}
          data-apartment-card-overlay="true"
          onClick={overlayClick}
        >
          {label}
        </a>
      )}
      {showOpenAction ? (
        onApartments ? (
          <Link href={href} className={actionClass} onClick={(e) => e.stopPropagation()}>
            {t('property.openCard')}
          </Link>
        ) : (
          <a href={href} className={actionClass} data-apartment-card-overlay="true" onClick={overlayClick}>
            {t('property.openCard')}
          </a>
        )
      ) : null}
    </span>
  );
}
