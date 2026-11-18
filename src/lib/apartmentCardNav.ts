/**
 * Deep-link helpers for the single apartment workplace card (Admin → Квартиры).
 * Actions always use property id; labels use formatPropertyIdentity separately.
 */

export const APARTMENT_CARD_SECTION = 'квартиры';

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
  /** Current location search (without leading ?) to restore after closing the card. */
  returnSearch?: string | null;
  pathname?: string;
};

/**
 * Build `/admin?section=квартиры&property=<id>&cardTab=…&return=…`
 * `return` holds the previous query string so Back / «к модулю» can restore filters.
 */
export function buildApartmentCardHref(opts: ApartmentCardHrefOpts): string {
  const pathname = opts.pathname ?? '/admin';
  const params = new URLSearchParams();
  params.set('section', APARTMENT_CARD_SECTION);
  params.set('property', String(opts.propertyId));
  const tab = parseApartmentCardTab(opts.cardTab ?? null);
  if (tab !== 'инфо') params.set('cardTab', tab);
  const ret = (opts.returnSearch ?? '').replace(/^\?/, '').trim();
  if (ret) params.set('return', ret);
  return `${pathname}?${params.toString()}`;
}

export function parsePropertyIdParam(raw: string | null | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
