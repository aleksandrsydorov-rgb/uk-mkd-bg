/**
 * Presentation helpers for utility module registers (water / electricity / internet).
 * Enrichment is assembled client-side from existing tables — no new RPCs or formulas.
 */

import type { UtilityFinanceRegisterRow, UtilityFinanceStatusFilter } from '@/lib/utilityFinanceRegister';
import { compareApartmentNumbers } from '@/lib/supportFeeRegister';

export type UtilityRegisterSort =
  | 'section_apartment'
  | 'apartment'
  | 'balance_desc'
  | 'balance_asc'
  | 'section';

export type UtilityModuleRegisterFilters = {
  query: string;
  status: UtilityFinanceStatusFilter;
  section: string; // '' = all
  periodYm: string; // '' = latest overall; 'YYYY-MM' filters reading snapshot only
  connection: string; // '' = all; internet connection status
  sort: UtilityRegisterSort;
};

export const EMPTY_UTILITY_MODULE_FILTERS: UtilityModuleRegisterFilters = {
  query: '',
  status: 'all',
  section: '',
  periodYm: '',
  connection: '',
  sort: 'section_apartment',
};

const sectionCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Entrance labels on this complex mix Latin A with Cyrillic Б/В.
 * Default localeCompare can put Cyrillic before Latin; pin a readable A→Б→В order
 * without merging Latin/Cyrillic codes into one bucket.
 */
function sectionPrimaryRank(raw: string): number {
  const s = raw.trim();
  if (!s) return Number.POSITIVE_INFINITY;
  const ch = s[0] ?? '';
  const up = ch.toLocaleUpperCase();
  const latin = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const li = latin.indexOf(up);
  if (li >= 0) return li * 2;
  // Cyrillic counterparts sit just after the matching Latin letter when both exist.
  if (up === 'А') return 0 * 2 + 1;
  if (up === 'Б') return 1 * 2 + 1;
  if (up === 'В') return 21 * 2 + 1; // after Latin V
  const cyr = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЬЮЯ';
  const ci = cyr.indexOf(up);
  if (ci >= 0) return 200 + ci;
  return 1000 + (ch.codePointAt(0) ?? 0);
}

function compareSectionCodes(a: string, b: string): number {
  const as = String(a ?? '').trim();
  const bs = String(b ?? '').trim();
  const byRank = sectionPrimaryRank(as) - sectionPrimaryRank(bs);
  if (byRank !== 0) return byRank;
  return sectionCollator.compare(as, bs);
}

function compareSectionThenBlockThenApartment(
  a: UtilityFinanceRegisterRow & { sectionCode?: string; blockCode?: string },
  b: UtilityFinanceRegisterRow & { sectionCode?: string; blockCode?: string },
): number {
  const bySection = compareSectionCodes(String(a.sectionCode ?? ''), String(b.sectionCode ?? ''));
  if (bySection !== 0) return bySection;
  const byBlock = compareSectionCodes(String(a.blockCode ?? ''), String(b.blockCode ?? ''));
  if (byBlock !== 0) return byBlock;
  return compareApartmentNumbers(a.apartmentNumber, b.apartmentNumber);
}

export type WaterReadingSnap = {
  propertyId: number;
  previousValue: number | null;
  currentValue: number | null;
  consumptionM3: number | null;
  readingDate: string | null;
};

export type ElectricityChargeSnap = {
  propertyId: number;
  previousDay: number | null;
  currentDay: number | null;
  consumptionDay: number | null;
  previousNight: number | null;
  currentNight: number | null;
  consumptionNight: number | null;
  readingDate: string | null;
};

export type InternetSubSnap = {
  propertyId: number;
  status: string;
};

export type WaterRegisterRow = UtilityFinanceRegisterRow & {
  sectionCode: string;
  blockCode: string;
  previousM3: number | null;
  currentM3: number | null;
  consumptionM3: number | null;
};

export type ElectricityRegisterRow = UtilityFinanceRegisterRow & {
  sectionCode: string;
  blockCode: string;
  previousDay: number | null;
  currentDay: number | null;
  consumptionDay: number | null;
  previousNight: number | null;
  currentNight: number | null;
  consumptionNight: number | null;
};

export type InternetRegisterRow = UtilityFinanceRegisterRow & {
  sectionCode: string;
  blockCode: string;
  connectionStatus: string;
  tariffLabel: string | null;
};

export function readingInPeriod(readingDate: string | null | undefined, periodYm: string): boolean {
  if (!periodYm) return true;
  if (!readingDate) return false;
  return String(readingDate).slice(0, 7) === periodYm;
}

/** Latest water reading per property (optionally within YYYY-MM). */
export function pickLatestWaterSnaps(
  rows: Array<{
    property_id: number;
    previous_value: number | string | null;
    current_value: number | string | null;
    consumption_m3: number | string | null;
    reading_date: string;
    reversed_at?: string | null;
    status?: string | null;
  }>,
  periodYm = '',
): Map<number, WaterReadingSnap> {
  const map = new Map<number, WaterReadingSnap>();
  const sorted = [...rows].sort((a, b) => String(b.reading_date).localeCompare(String(a.reading_date)));
  for (const r of sorted) {
    if (r.reversed_at) continue;
    if (String(r.status ?? '').toLowerCase() === 'reversed') continue;
    if (!readingInPeriod(r.reading_date, periodYm)) continue;
    const pid = Number(r.property_id);
    if (!Number.isFinite(pid) || map.has(pid)) continue;
    map.set(pid, {
      propertyId: pid,
      previousValue: numOrNull(r.previous_value),
      currentValue: numOrNull(r.current_value),
      consumptionM3: numOrNull(r.consumption_m3),
      readingDate: r.reading_date ?? null,
    });
  }
  return map;
}

export function pickLatestElectricitySnaps(
  rows: Array<{
    property_id: number;
    previous_day: number | string | null;
    current_day: number | string | null;
    consumption_day: number | string | null;
    previous_night: number | string | null;
    current_night: number | string | null;
    consumption_night: number | string | null;
    reading_date: string;
  }>,
  periodYm = '',
): Map<number, ElectricityChargeSnap> {
  const map = new Map<number, ElectricityChargeSnap>();
  const sorted = [...rows].sort((a, b) => String(b.reading_date).localeCompare(String(a.reading_date)));
  for (const r of sorted) {
    if (!readingInPeriod(r.reading_date, periodYm)) continue;
    const pid = Number(r.property_id);
    if (!Number.isFinite(pid) || map.has(pid)) continue;
    map.set(pid, {
      propertyId: pid,
      previousDay: numOrNull(r.previous_day),
      currentDay: numOrNull(r.current_day),
      consumptionDay: numOrNull(r.consumption_day),
      previousNight: numOrNull(r.previous_night),
      currentNight: numOrNull(r.current_night),
      consumptionNight: numOrNull(r.consumption_night),
      readingDate: r.reading_date ?? null,
    });
  }
  return map;
}

export function indexInternetSubs(
  rows: Array<{ property_id: number; status: string }>,
): Map<number, InternetSubSnap> {
  const map = new Map<number, InternetSubSnap>();
  for (const r of rows) {
    const pid = Number(r.property_id);
    if (!Number.isFinite(pid)) continue;
    map.set(pid, { propertyId: pid, status: String(r.status ?? '') });
  }
  return map;
}

export function buildWaterRegisterRows(
  base: UtilityFinanceRegisterRow[],
  properties: Array<{
    id: number;
    section_code?: string | null;
    block_code?: string | null;
  }>,
  snaps: Map<number, WaterReadingSnap>,
): WaterRegisterRow[] {
  const byId = new Map(properties.map((p) => [p.id, p]));
  return base.map((row) => {
    const p = byId.get(row.propertyId);
    const snap = snaps.get(row.propertyId);
    return {
      ...row,
      sectionCode: String(p?.section_code ?? '').trim(),
      blockCode: String(p?.block_code ?? '').trim(),
      previousM3: snap?.previousValue ?? null,
      currentM3: snap?.currentValue ?? null,
      consumptionM3: snap?.consumptionM3 ?? null,
    };
  });
}

export function buildElectricityRegisterRows(
  base: UtilityFinanceRegisterRow[],
  properties: Array<{
    id: number;
    section_code?: string | null;
    block_code?: string | null;
  }>,
  snaps: Map<number, ElectricityChargeSnap>,
): ElectricityRegisterRow[] {
  const byId = new Map(properties.map((p) => [p.id, p]));
  return base.map((row) => {
    const p = byId.get(row.propertyId);
    const snap = snaps.get(row.propertyId);
    return {
      ...row,
      sectionCode: String(p?.section_code ?? '').trim(),
      blockCode: String(p?.block_code ?? '').trim(),
      previousDay: snap?.previousDay ?? null,
      currentDay: snap?.currentDay ?? null,
      consumptionDay: snap?.consumptionDay ?? null,
      previousNight: snap?.previousNight ?? null,
      currentNight: snap?.currentNight ?? null,
      consumptionNight: snap?.consumptionNight ?? null,
    };
  });
}

export function buildInternetRegisterRows(
  base: UtilityFinanceRegisterRow[],
  properties: Array<{
    id: number;
    section_code?: string | null;
    block_code?: string | null;
  }>,
  subs: Map<number, InternetSubSnap>,
  tariffLabel: string | null,
): InternetRegisterRow[] {
  const byId = new Map(properties.map((p) => [p.id, p]));
  return base.map((row) => {
    const p = byId.get(row.propertyId);
    const sub = subs.get(row.propertyId);
    return {
      ...row,
      sectionCode: String(p?.section_code ?? '').trim(),
      blockCode: String(p?.block_code ?? '').trim(),
      connectionStatus: sub?.status || 'none',
      tariffLabel,
    };
  });
}

export function listSectionsFromProperties(
  properties: Array<{ section_code?: string | null }>,
): string[] {
  const set = new Set<string>();
  for (const p of properties) {
    const s = String(p.section_code ?? '').trim();
    if (s) set.add(s);
  }
  return [...set].sort(compareSectionCodes);
}

export function filterUtilityModuleRows<T extends UtilityFinanceRegisterRow & { sectionCode?: string }>(
  rows: T[],
  filters: UtilityModuleRegisterFilters,
): T[] {
  const q = String(filters.query ?? '').trim().toLowerCase();
  return rows.filter((row) => {
    if (q) {
      const apt = String(row.apartmentNumber ?? '').toLowerCase();
      const owner = String(row.ownerName ?? '').toLowerCase();
      const section = String(row.sectionCode ?? '').toLowerCase();
      if (!apt.includes(q) && !owner.includes(q) && !section.includes(q)) return false;
    }
    if (filters.status === 'debt' && row.status !== 'debt') return false;
    if (filters.status === 'credit' && row.status !== 'credit') return false;
    if (filters.status === 'settled' && row.status !== 'settled') return false;
    if (filters.section && String(row.sectionCode ?? '') !== filters.section) return false;
    return true;
  });
}

export function sortUtilityModuleRows<
  T extends UtilityFinanceRegisterRow & { sectionCode?: string; blockCode?: string },
>(rows: T[], sort: UtilityRegisterSort): T[] {
  const copy = [...rows];
  if (sort === 'balance_desc') {
    return copy.sort((a, b) => b.balanceEur - a.balanceEur);
  }
  if (sort === 'balance_asc') {
    return copy.sort((a, b) => a.balanceEur - b.balanceEur);
  }
  if (sort === 'section_apartment') {
    return copy.sort(compareSectionThenBlockThenApartment);
  }
  if (sort === 'section') {
    return copy.sort((a, b) => {
      const s = compareSectionCodes(String(a.sectionCode ?? ''), String(b.sectionCode ?? ''));
      if (s !== 0) return s;
      return compareApartmentNumbers(a.apartmentNumber, b.apartmentNumber);
    });
  }
  return copy.sort((a, b) => compareApartmentNumbers(a.apartmentNumber, b.apartmentNumber));
}

export function utilityModuleFiltersActive(f: UtilityModuleRegisterFilters): boolean {
  return (
    f.status !== 'all' ||
    Boolean(String(f.query ?? '').trim()) ||
    Boolean(f.section) ||
    Boolean(f.periodYm) ||
    Boolean(f.connection) ||
    f.sort !== 'section_apartment'
  );
}

export function parseUtilityRegisterSort(raw: string | null | undefined): UtilityRegisterSort {
  if (
    raw === 'balance_desc' ||
    raw === 'balance_asc' ||
    raw === 'section' ||
    raw === 'apartment' ||
    raw === 'section_apartment'
  ) {
    return raw;
  }
  return 'section_apartment';}

export function formatSectionBlock(sectionCode: string, blockCode: string): string {
  const s = sectionCode.trim();
  const b = blockCode.trim();
  if (s && b) return `${s} / ${b}`;
  if (s) return s;
  if (b) return b;
  return '—';
}

function numOrNull(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
