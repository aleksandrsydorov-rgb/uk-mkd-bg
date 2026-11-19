/**
 * Presentation helpers for the water readings register (latest per current meter).
 * Client-side from existing water_meters + water_readings + properties — no new RPCs.
 */

import { compareApartmentNumbers } from '@/lib/supportFeeRegister';
import {
  presentMeterReadingStatus,
  type MeterReadingStatusCode,
} from '@/lib/meterReadingHistory';
import {
  calendarReadingDate,
  clampWaterPeriodRange,
  compareSectionCodes,
} from '@/lib/utilityModuleRegister';

export type WaterReadingRegisterFilters = {
  query: string;
  section: string;
  block: string;
  periodFrom: string;
  periodTo: string;
};

export const EMPTY_WATER_READING_FILTERS: WaterReadingRegisterFilters = {
  query: '',
  section: '',
  block: '',
  periodFrom: '',
  periodTo: '',
};

export type WaterReadingRegisterRow = {
  meterId: string;
  propertyId: number;
  apartmentNumber: string;
  sectionCode: string;
  blockCode: string;
  ownerName: string | null;
  meterNumber: string;
  readingId: string | null;
  previousValue: number | null;
  currentValue: number | null;
  readingDate: string | null;
  submittedByEmail: string | null;
  submittedVia: string | null;
  readingKind: string | null;
  rowStatus: string | null;
  reversedAt: string | null;
  statusCode: MeterReadingStatusCode | null;
};

export function waterReadingFiltersActive(f: WaterReadingRegisterFilters): boolean {
  return (
    Boolean(String(f.query ?? '').trim()) ||
    Boolean(f.section) ||
    Boolean(f.block) ||
    Boolean(f.periodFrom) ||
    Boolean(f.periodTo)
  );
}

function numOrNull(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

function compareReadingNewest(
  a: { reading_date: string; created_at?: string | null },
  b: { reading_date: string; created_at?: string | null },
): number {
  const byDate = calendarReadingDate(b.reading_date).localeCompare(calendarReadingDate(a.reading_date));
  if (byDate !== 0) return byDate;
  return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
}

/**
 * One row per current (non-retired) meter.
 * Latest reading inside the optional inclusive date range; meters without a match stay visible with nulls.
 */
export function buildWaterReadingRegisterRows(
  meters: Array<{
    id: string;
    property_id: number;
    meter_number: string | null;
    retired_at?: string | null;
  }>,
  readings: Array<{
    id: string;
    property_id: number;
    meter_id: string;
    reading_date: string;
    previous_value: number | string | null;
    current_value: number | string | null;
    submitted_by_email?: string | null;
    submitted_via?: string | null;
    status?: string | null;
    reading_kind?: string | null;
    reversed_at?: string | null;
    created_at?: string | null;
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
): WaterReadingRegisterRow[] {
  const byProp = new Map(properties.map((p) => [Number(p.id), p]));
  const readingsByMeter = new Map<string, typeof readings>();
  for (const r of readings) {
    const mid = String(r.meter_id);
    const list = readingsByMeter.get(mid);
    if (list) list.push(r);
    else readingsByMeter.set(mid, [r]);
  }

  const rows: WaterReadingRegisterRow[] = [];
  for (const m of meters) {
    if (m.retired_at) continue;
    const pid = Number(m.property_id);
    if (!Number.isFinite(pid)) continue;
    const prop = byProp.get(pid);
    const candidates = (readingsByMeter.get(String(m.id)) ?? [])
      .filter((r) => readingInDateRange(r.reading_date, periodFrom, periodTo))
      .sort(compareReadingNewest);
    const latest = candidates[0] ?? null;
    const statusCode = latest
      ? presentMeterReadingStatus({
          readingKind: latest.reading_kind,
          rowStatus: latest.reversed_at ? 'reversed' : latest.status,
        })
      : null;

    rows.push({
      meterId: String(m.id),
      propertyId: pid,
      apartmentNumber: prop?.apartment_number != null ? String(prop.apartment_number) : '',
      sectionCode: String(prop?.section_code ?? '').trim(),
      blockCode: String(prop?.block_code ?? '').trim(),
      ownerName: prop?.owner_name?.trim() ? String(prop.owner_name).trim() : null,
      meterNumber: m.meter_number != null ? String(m.meter_number) : '',
      readingId: latest ? String(latest.id) : null,
      previousValue: latest ? numOrNull(latest.previous_value) : null,
      currentValue: latest ? numOrNull(latest.current_value) : null,
      readingDate: latest?.reading_date ? calendarReadingDate(latest.reading_date) : null,
      submittedByEmail: latest?.submitted_by_email?.trim() || null,
      submittedVia: latest?.submitted_via ?? null,
      readingKind: latest?.reading_kind ?? null,
      rowStatus: latest?.status ?? null,
      reversedAt: latest?.reversed_at ?? null,
      statusCode,
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

export function filterWaterReadingRegisterRows(
  rows: WaterReadingRegisterRow[],
  filters: WaterReadingRegisterFilters,
): WaterReadingRegisterRow[] {
  const q = String(filters.query ?? '').trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.section && row.sectionCode !== filters.section) return false;
    if (filters.block && row.blockCode !== filters.block) return false;
    if (!q) return true;
    const apt = row.apartmentNumber.toLowerCase();
    const owner = String(row.ownerName ?? '').toLowerCase();
    const meter = row.meterNumber.toLowerCase();
    return apt.includes(q) || owner.includes(q) || meter.includes(q);
  });
}
