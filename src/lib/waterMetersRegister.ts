/**
 * Presentation helpers for the water meters register (current devices only).
 * Enrichment is client-side from existing water_meters + properties — no new RPCs.
 */

import { compareApartmentNumbers } from '@/lib/supportFeeRegister';
import {
  compareSectionCodes,
  formatSectionBlock,
  listSectionsFromProperties,
} from '@/lib/utilityModuleRegister';

export type WaterMeterRegisterRow = {
  meterId: string;
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
  const byId = new Map(properties.map((p) => [Number(p.id), p]));
  const rows: WaterMeterRegisterRow[] = [];
  for (const m of meters) {
    if (m.retired_at) continue;
    const pid = Number(m.property_id);
    if (!Number.isFinite(pid)) continue;
    const prop = byId.get(pid);
    rows.push({
      meterId: String(m.id),
      propertyId: pid,
      apartmentNumber: prop?.apartment_number != null ? String(prop.apartment_number) : '',
      sectionCode: String(prop?.section_code ?? '').trim(),
      blockCode: String(prop?.block_code ?? '').trim(),
      meterNumber: m.meter_number != null ? String(m.meter_number) : '',
      installedAt: m.installed_at ? String(m.installed_at) : null,
    });
  }
  return rows.sort((a, b) => {
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
  });
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
    const apt = row.apartmentNumber.toLowerCase();
    const meter = row.meterNumber.toLowerCase();
    return apt.includes(q) || meter.includes(q);
  });
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
