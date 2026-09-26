/** Per-browser admin overview card visibility (localStorage). */

export const OVERVIEW_CARD_KEYS = [
  'apartments',
  'active_requests',
  'internet_open_tasks',
  'service_lock',
  'support_debt',
  'open_polls',
] as const;

export type OverviewCardKey = (typeof OVERVIEW_CARD_KEYS)[number];

export type OverviewCardPrefs = Record<OverviewCardKey, boolean>;

const STORAGE_KEY = 'uk_overview_cards_v1';

export function defaultOverviewCardPrefs(): OverviewCardPrefs {
  return {
    apartments: true,
    active_requests: true,
    internet_open_tasks: true,
    service_lock: true,
    support_debt: true,
    open_polls: true,
  };
}

export function loadOverviewCardPrefs(): OverviewCardPrefs {
  const defaults = defaultOverviewCardPrefs();
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    if (!parsed || typeof parsed !== 'object') return defaults;
    const next = { ...defaults };
    for (const key of OVERVIEW_CARD_KEYS) {
      if (typeof parsed[key] === 'boolean') next[key] = parsed[key];
    }
    return next;
  } catch {
    return defaults;
  }
}

export function persistOverviewCardPrefs(prefs: OverviewCardPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota / private mode */
  }
}

export function isOverviewCardEnabled(
  prefs: OverviewCardPrefs,
  key: OverviewCardKey,
): boolean {
  return prefs[key] !== false;
}
