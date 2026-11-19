/**
 * Presentation helpers for the water history apartment register.
 * Source of truth = property book; readings/meters left-join (no fictitious history rows).
 */

import { compareApartmentNumbers } from '@/lib/supportFeeRegister';
import {
  calendarReadingDate,
  clampWaterPeriodRange,
  compareSectionCodes,
} from '@/lib/utilityModuleRegister';
import { apartmentQueryMatches } from '@/lib/waterMetersRegister';

export type WaterHistoryRegisterFilters = {
  query: string;
  section: string;
  block: string;
  periodFrom: string;
  periodTo: string;
};

export const EMPTY_WATER_HISTORY_FILTERS: WaterHistoryRegisterFilters = {
  query: '',
  section: '',
  block: '',
  periodFrom: '',
  periodTo: '',
};

export type WaterHistoryRegisterRow = {
  propertyId: number;
  apartmentNumber: string;
  sectionCode: string;
  blockCode: string;
  ownerName: string | null;
  /** Latest reading_date in the selected range; null = no history in range. */
  lastEventDate: string | null;
  /** Meter numbers for this property (active + retired) — search only. */
  meterNumbers: string[];
};

export function waterHistoryFiltersActive(f: WaterHistoryRegisterFilters): boolean {
  return (
    Boolean(String(f.query ?? '').trim()) ||
    Boolean(f.section) ||
    Boolean(f.block) ||
    Boolean(f.periodFrom) ||
    Boolean(f.periodTo)
  );
}

function readingInDateRange(
  readingDate: string | null | undefined,
  periodFrom: string,
  periodTo: string,
): boolean {
  const d = calendarReadingDate(readingDate);
  if (!d) return false;
  const { periodFrom: from, periodTo: to } = clampWaterPeriodRange(periodFrom, periodTo);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function sortHistoryRows(a: WaterHistoryRegisterRow, b: WaterHistoryRegisterRow): number {
  const bySection = compareSectionCodes(a.sectionCode, b.sectionCode);
  if (bySection !== 0) return bySection;
  const byBlock = compareSectionCodes(a.blockCode, b.blockCode);
  if (byBlock !== 0) return byBlock;
  return compareApartmentNumbers(a.apartmentNumber, b.apartmentNumber);
}

/**
 * One row per property (join by property id). Empty history → lastEventDate null, still listed.
 * Does not invent reading rows.
 */
export function buildWaterHistoryRegisterRows(
  meters: Array<{
    property_id: number;
    meter_number: string | null;
  }>,
  readings: Array<{
    property_id: number;
    reading_date: string;
  }>,
  properties: Array<{
    id: number;
    apartment_number: string | number | null;
    section_code?: string | null;
    block_code?: string | null;
    owner_name?: string | null;
  }>,
  periodFrom = '',
  periodTo = '',
): WaterHistoryRegisterRow[] {
  const metersByProp = new Map<number, string[]>();
  for (const m of meters) {
    const pid = Number(m.property_id);
    if (!Number.isFinite(pid)) continue;
    const num = m.meter_number != null ? String(m.meter_number).trim() : '';
    if (!num) continue;
    const list = metersByProp.get(pid);
    if (list) {
      if (!list.includes(num)) list.push(num);
    } else metersByProp.set(pid, [num]);
  }

  const lastByProp = new Map<number, string>();
  for (const r of readings) {
    const pid = Number(r.property_id);
    if (!Number.isFinite(pid)) continue;
    if (!readingInDateRange(r.reading_date, periodFrom, periodTo)) continue;
    const d = calendarReadingDate(r.reading_date);
    if (!d) continue;
    const prev = lastByProp.get(pid);
    if (!prev || d > prev) lastByProp.set(pid, d);
  }

  const rows: WaterHistoryRegisterRow[] = [];
  for (const prop of properties) {
    const pid = Number(prop.id);
    if (!Number.isFinite(pid)) continue;
    rows.push({
      propertyId: pid,
      apartmentNumber: prop.apartment_number != null ? String(prop.apartment_number) : '',
      sectionCode: String(prop.section_code ?? '').trim(),
      blockCode: String(prop.block_code ?? '').trim(),
      ownerName: prop.owner_name != null ? String(prop.owner_name) : null,
      lastEventDate: lastByProp.get(pid) ?? null,
      meterNumbers: metersByProp.get(pid) ?? [],
    });
  }
  return rows.sort(sortHistoryRows);
}

export function filterWaterHistoryRegisterRows(
  rows: WaterHistoryRegisterRow[],
  filters: WaterHistoryRegisterFilters,
): WaterHistoryRegisterRow[] {
  const q = String(filters.query ?? '').trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.section && row.sectionCode !== filters.section) return false;
    if (filters.block && row.blockCode !== filters.block) return false;
    if (!q) return true;
    const owner = String(row.ownerName ?? '').toLowerCase();
    const meterHit = row.meterNumbers.some((n) => n.toLowerCase().includes(q));
    return apartmentQueryMatches(row.apartmentNumber, q) || owner.includes(q) || meterHit;
  });
}

export {
  clampWaterPeriodRange,
  formatSectionBlock,
  listSectionsFromProperties,
} from '@/lib/utilityModuleRegister';
export { listBlocksFromProperties } from '@/lib/waterMetersRegister';
