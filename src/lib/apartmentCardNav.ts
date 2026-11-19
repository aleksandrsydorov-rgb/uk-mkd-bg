/**
 * Deep-link helpers for the single apartment workplace card.
 * Actions always use property id; labels use formatPropertyIdentity separately.
 *
 * Two open modes:
 * - navigate: section=квартиры&property=… (apartments register + legacy deep links)
 * - overlay: keep current section/tab/filters, set cardProperty=… (card over current module)
 */

export const APARTMENT_CARD_SECTION = 'квартиры';

/** Overlay param — must not collide with module shells that already use `property`. */
export const APARTMENT_CARD_PROPERTY_PARAM = 'cardProperty';

export type ApartmentCardTab =
  | 'инфо'
  | 'финансы'
  | 'счётчики'
  | 'заявки'
  | 'жильцы'
  | 'чат';

const CARD_TABS: readonly ApartmentCardTab[] = [
  'инфо',
  'финансы',
  'счётчики',
  'заявки',
  'жильцы',
  'чат',
] as const;

export function isApartmentCardTab(value: string | null | undefined): value is ApartmentCardTab {
  return Boolean(value && (CARD_TABS as readonly string[]).includes(value));
}

export function parseApartmentCardTab(value: string | null | undefined): ApartmentCardTab {
  return isApartmentCardTab(value) ? value : 'инфо';
}

/** Map a related module context to the card tab that should open. */
export function cardTabForModule(
  module:
    | 'finance'
    | 'support'
    | 'capital'
    | 'water'
    | 'electricity'
    | 'internet'
    | 'requests'
    | 'meters'
    | 'occupancy'
    | 'chat'
    | 'info'
): ApartmentCardTab {
  switch (module) {
    case 'finance':
    case 'support':
    case 'capital':
    case 'internet':
      return 'финансы';
    case 'water':
    case 'electricity':
    case 'meters':
      return 'счётчики';
    case 'requests':
      return 'заявки';
    case 'occupancy':
      return 'жильцы';
    case 'chat':
      return 'чат';
    default:
      return 'инфо';
  }
}

export type ApartmentCardHrefOpts = {
  propertyId: number;
  cardTab?: ApartmentCardTab | string | null;
  /**
   * Current location search (without leading ?).
   * Overlay mode preserves it; navigate mode stores it as `return`.
   */
  currentSearch?: string | null;
  /** @deprecated Prefer currentSearch — kept for call-site compatibility. */
  returnSearch?: string | null;
  pathname?: string;
  /** auto: overlay unless already on apartments section. */
  mode?: 'auto' | 'overlay' | 'navigate';
};

function readCurrentSearch(opts: ApartmentCardHrefOpts): string {
  return (opts.currentSearch ?? opts.returnSearch ?? '').replace(/^\?/, '').trim();
}

/**
 * Resolve which property id the apartment card should show from the URL.
 * Overlay (`cardProperty`) wins; apartments section also accepts `property`.
 */
export function parseApartmentCardPropertyId(
  search: URLSearchParams | { get(name: string): string | null },
  section: string | null | undefined,
): number | null {
  const overlay = parsePropertyIdParam(search.get(APARTMENT_CARD_PROPERTY_PARAM));
  if (overlay) return overlay;
  if (section === APARTMENT_CARD_SECTION) {
    return parsePropertyIdParam(search.get('property'));
  }
  return null;
}

export function isApartmentCardOverlayOpen(
  search: URLSearchParams | { get(name: string): string | null },
): boolean {
  return parsePropertyIdParam(search.get(APARTMENT_CARD_PROPERTY_PARAM)) != null;
}

/**
 * Build apartment-card href.
 * Overlay: keep section/tab/filters, set cardProperty (+ cardTab).
 * Navigate: section=квартиры&property=…&return=…
 */
export function buildApartmentCardHref(opts: ApartmentCardHrefOpts): string {
  const pathname = opts.pathname ?? '/admin';
  const raw = readCurrentSearch(opts);
  const current = new URLSearchParams(raw);
  const section = current.get('section') ?? '';
  const mode =
    opts.mode === 'overlay' || opts.mode === 'navigate'
      ? opts.mode
      : section === APARTMENT_CARD_SECTION
        ? 'navigate'
        : 'overlay';

  const tab = parseApartmentCardTab(opts.cardTab ?? null);

  if (mode === 'overlay') {
    const params = new URLSearchParams(raw);
    params.set(APARTMENT_CARD_PROPERTY_PARAM, String(opts.propertyId));
    if (tab !== 'инфо') params.set('cardTab', tab);
    else params.delete('cardTab');
    // Drop navigate-mode crumbs; module `property` stays for water/finance shells.
    params.delete('return');
    return `${pathname}?${params.toString()}`;
  }

  const params = new URLSearchParams();
  params.set('section', APARTMENT_CARD_SECTION);
  params.set('property', String(opts.propertyId));
  if (tab !== 'инфо') params.set('cardTab', tab);
  if (raw) params.set('return', raw);
  return `${pathname}?${params.toString()}`;
}

/** Strip apartment-card URL params without touching module section/tab/filters. */
export function clearApartmentCardParams(params: URLSearchParams): void {
  params.delete(APARTMENT_CARD_PROPERTY_PARAM);
  params.delete('cardTab');
  params.delete('return');
}

export function parsePropertyIdParam(raw: string | null | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
