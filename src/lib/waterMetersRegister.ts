/**
 * Presentation helpers for the water meters register.
 * Source of truth = property book apartments; meters left-join (no fictitious rows in DB).
 */

import { compareApartmentNumbers } from '@/lib/supportFeeRegister';
import {
  compareSectionCodes,
  formatSectionBlock,
  listSectionsFromProperties,
} from '@/lib/utilityModuleRegister';

export type WaterMeterRegisterRow = {
  /** Null when the apartment has no current (non-retired) meter. */
  meterId: string | null;
  propertyId: number;
  apartmentNumber: string;
  sectionCode: string;
  blockCode: string;
  meterNumber: string;
  installedAt: string | null;
};

export type WaterMeterRegisterFilters = {
  query: string;
  section: string;
  block: string;
};

export const EMPTY_WATER_METER_FILTERS: WaterMeterRegisterFilters = {
  query: '',
  section: '',
  block: '',
};

export function waterMeterFiltersActive(f: WaterMeterRegisterFilters): boolean {
  return Boolean(String(f.query ?? '').trim()) || Boolean(f.section) || Boolean(f.block);
}

function sortMeterRows(a: WaterMeterRegisterRow, b: WaterMeterRegisterRow): number {
  const bySection = compareSectionCodes(a.sectionCode, b.sectionCode);
  if (bySection !== 0) return bySection;
  const byBlock = compareSectionCodes(a.blockCode, b.blockCode);
  if (byBlock !== 0) return byBlock;
  const byApt = compareApartmentNumbers(a.apartmentNumber, b.apartmentNumber);
  if (byApt !== 0) return byApt;
  return String(a.meterNumber).localeCompare(String(b.meterNumber), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

/**
 * One row per current meter; apartments without a current meter get a single empty row (—).
 * Join key is property id — never apartment number alone.
 */
export function buildWaterMeterRegisterRows(
  meters: Array<{
    id: string;
    property_id: number;
    meter_number: string | null;
    installed_at: string | null;
    retired_at?: string | null;
  }>,
  properties: Array<{
    id: number;
    apartment_number: string | number | null;
    section_code?: string | null;
    block_code?: string | null;
  }>,
): WaterMeterRegisterRow[] {
  const metersByProp = new Map<number, typeof meters>();
  for (const m of meters) {
    if (m.retired_at) continue;
    const pid = Number(m.property_id);
    if (!Number.isFinite(pid)) continue;
    const list = metersByProp.get(pid);
    if (list) list.push(m);
    else metersByProp.set(pid, [m]);
  }

  const rows: WaterMeterRegisterRow[] = [];
  for (const prop of properties) {
    const pid = Number(prop.id);
    if (!Number.isFinite(pid)) continue;
    const apartmentNumber = prop.apartment_number != null ? String(prop.apartment_number) : '';
    const sectionCode = String(prop.section_code ?? '').trim();
    const blockCode = String(prop.block_code ?? '').trim();
    const propMeters = metersByProp.get(pid) ?? [];
    if (propMeters.length === 0) {
      rows.push({
        meterId: null,
        propertyId: pid,
        apartmentNumber,
        sectionCode,
        blockCode,
        meterNumber: '',
        installedAt: null,
      });
      continue;
    }
    for (const m of propMeters) {
      rows.push({
        meterId: String(m.id),
        propertyId: pid,
        apartmentNumber,
        sectionCode,
        blockCode,
        meterNumber: m.meter_number != null ? String(m.meter_number) : '',
        installedAt: m.installed_at ? String(m.installed_at) : null,
      });
    }
  }
  return rows.sort(sortMeterRows);
}

/** Match apartment number for search: numeric queries match the whole number (23 ≠ 123). */
export function apartmentQueryMatches(apartmentNumber: string, query: string): boolean {
  const apt = String(apartmentNumber ?? '').trim().toLowerCase();
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  if (!apt) return false;
  if (/^\d+$/.test(q) && /^\d+$/.test(apt)) {
    return apt.replace(/^0+/, '') === q.replace(/^0+/, '') || apt === q;
  }
  return apt.includes(q);
}

export function filterWaterMeterRegisterRows(
  rows: WaterMeterRegisterRow[],
  filters: WaterMeterRegisterFilters,
): WaterMeterRegisterRow[] {
  const q = String(filters.query ?? '').trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.section && row.sectionCode !== filters.section) return false;
    if (filters.block && row.blockCode !== filters.block) return false;
    if (!q) return true;
    const meter = row.meterNumber.toLowerCase();
    return apartmentQueryMatches(row.apartmentNumber, q) || meter.includes(q);
  });
}

export function countWaterMeterRegisterStats(rows: WaterMeterRegisterRow[]): {
  apartments: number;
  meters: number;
  rows: number;
} {
  const aptIds = new Set<number>();
  let meters = 0;
  for (const row of rows) {
    aptIds.add(row.propertyId);
    if (row.meterId) meters += 1;
  }
  return { apartments: aptIds.size, meters, rows: rows.length };
}

export function listBlocksFromProperties(
  properties: Array<{ section_code?: string | null; block_code?: string | null }>,
  section = '',
): string[] {
  const set = new Set<string>();
  for (const p of properties) {
    if (section && String(p.section_code ?? '').trim() !== section) continue;
    const b = String(p.block_code ?? '').trim();
    if (b) set.add(b);
  }
  return [...set].sort(compareSectionCodes);
}

export { formatSectionBlock, listSectionsFromProperties, compareApartmentNumbers };
