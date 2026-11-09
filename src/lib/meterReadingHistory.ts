/** Shared meter reading history presenters (water + electricity). */

export type MeterReadingUtility = 'water' | 'electricity';

export type MeterReadingSourceCode = 'owner' | 'staff' | 'system';

export type MeterReadingStatusCode =
  | 'opening'
  | 'pending_review'
  | 'accepted'
  | 'rejected';

export type MeterReadingHistoryEntry = {
  id: string;
  utility: MeterReadingUtility;
  readingDate: string;
  createdAt: string;
  meterId: string | null;
  meterNumber: string | null;
  /** Water: single register. Electricity: day register. */
  valuePrimary: number | null;
  /** Electricity night register. */
  valueSecondary: number | null;
  /** Consumption vs previous on the same meter; null → show "—". */
  consumptionPrimary: number | null;
  consumptionSecondary: number | null;
  source: MeterReadingSourceCode | null;
  status: MeterReadingStatusCode;
  readingKind: string | null;
  rowStatus: string | null;
  reason: string | null;
  photoUrl: string | null;
  /** Admin correction action target key (electricity pair key or water reading id). */
  actionKey?: string;
};

export type WaterHistoryInput = {
  id: string;
  meter_id: string;
  reading_date: string;
  created_at?: string | null;
  previous_value: number;
  current_value: number;
  consumption_m3?: number | null;
  status?: string | null;
  reading_kind?: string | null;
  submitted_via?: string | null;
  reversal_reason?: string | null;
  source_reference?: string | null;
  photo_url?: string | null;
  photo_path?: string | null;
};

export type ElectricityHistoryPairInput = {
  key: string;
  reading_date: string;
  created_at: string;
  day: number | null;
  night: number | null;
  consumptionDay: number | null;
  consumptionNight: number | null;
  source: string | null;
  electricity_meter_id: string | null;
  meter_number: string | null;
  day_reading_id: number | null;
  status: string | null;
  reading_kind: string | null;
  reversal_reason?: string | null;
  photo_url?: string | null;
};

function sourceFromRaw(raw: string | null | undefined, readingKind: string | null | undefined): MeterReadingSourceCode | null {
  // Opening / wizard seed rows are always «initial data», even if submitted_via was staff.
  if (readingKind === 'opening') return 'system';
  if (raw === 'owner' || raw === 'staff' || raw === 'system') return raw;
  return null;
}

/** Human rejection/correction note only — skip technical source_reference keys. */
function humanReason(...candidates: Array<string | null | undefined>): string | null {
  for (const raw of candidates) {
    const value = raw?.trim();
    if (!value) continue;
    if (/^[a-z][a-z0-9_]*$/i.test(value) && value.includes('_')) continue;
    return value;
  }
  return null;
}

export function presentMeterReadingStatus(args: {
  readingKind?: string | null;
  rowStatus?: string | null;
  pendingReview?: boolean;
}): MeterReadingStatusCode {
  if (args.rowStatus === 'reversed') return 'rejected';
  if (args.readingKind === 'opening') return 'opening';
  if (args.pendingReview) return 'pending_review';
  return 'accepted';
}

/** Water: opening and missing previous → no consumption display. */
export function waterHistoryConsumption(row: WaterHistoryInput): number | null {
  if (row.reading_kind === 'opening') return null;
  if (row.previous_value == null || row.current_value == null) return null;
  // Opening inventarisation uses previous === current; treat as non-consumption.
  if (Number(row.previous_value) === Number(row.current_value) && row.reading_kind !== 'correction') {
    if (row.submitted_via === 'system') return null;
  }
  const cons =
    row.consumption_m3 != null
      ? Number(row.consumption_m3)
      : Number(row.current_value) - Number(row.previous_value);
  if (!Number.isFinite(cons)) return null;
  return cons;
}

export function buildWaterHistoryEntries(
  rows: WaterHistoryInput[],
  meterNumberById: Map<string, string>,
  opts?: { meterId?: string | null },
): MeterReadingHistoryEntry[] {
  const filtered = opts?.meterId
    ? rows.filter((r) => r.meter_id === opts.meterId)
    : rows;
  return filtered.map((row) => ({
    id: String(row.id),
    utility: 'water' as const,
    readingDate: row.reading_date,
    createdAt: String(row.created_at ?? row.reading_date),
    meterId: row.meter_id,
    meterNumber: meterNumberById.get(row.meter_id) ?? null,
    valuePrimary: Number(row.current_value),
    valueSecondary: null,
    consumptionPrimary: waterHistoryConsumption(row),
    consumptionSecondary: null,
    source: sourceFromRaw(row.submitted_via, row.reading_kind),
    status: presentMeterReadingStatus({
      readingKind: row.reading_kind,
      rowStatus: row.status,
    }),
    readingKind: row.reading_kind ?? null,
    rowStatus: row.status ?? null,
    reason: humanReason(row.reversal_reason, row.source_reference),
    photoUrl: row.photo_url?.trim() || row.photo_path?.trim() || null,
    actionKey: String(row.id),
  }));
}

export function buildElectricityHistoryEntries(
  pairs: ElectricityHistoryPairInput[],
  opts?: { meterId?: string | null; pendingDayReadingIds?: ReadonlySet<number> | readonly number[] },
): MeterReadingHistoryEntry[] {
  const pending = opts?.pendingDayReadingIds
    ? opts.pendingDayReadingIds instanceof Set
      ? opts.pendingDayReadingIds
      : new Set(opts.pendingDayReadingIds)
    : null;
  const filtered = opts?.meterId
    ? pairs.filter((p) => p.electricity_meter_id === opts.meterId)
    : pairs;
  return filtered.map((pair) => {
    const pendingReview =
      pair.day_reading_id != null && pending != null && pending.has(pair.day_reading_id);
    const kind = pair.reading_kind;
    const isOpening = kind === 'opening';
    return {
      id: pair.key,
      utility: 'electricity' as const,
      readingDate: pair.reading_date,
      createdAt: pair.created_at,
      meterId: pair.electricity_meter_id,
      meterNumber: pair.meter_number,
      valuePrimary: pair.day,
      valueSecondary: pair.night,
      consumptionPrimary: isOpening ? null : pair.consumptionDay,
      consumptionSecondary: isOpening ? null : pair.consumptionNight,
      source: sourceFromRaw(pair.source, pair.reading_kind),
      status: presentMeterReadingStatus({
        readingKind: pair.reading_kind,
        rowStatus: pair.status,
        pendingReview,
      }),
      readingKind: pair.reading_kind,
      rowStatus: pair.status,
      reason: pair.reversal_reason?.trim() || null,
      photoUrl: pair.photo_url?.trim() || null,
      actionKey: pair.key,
    };
  });
}

export function filterHistoryByPeriod(
  entries: MeterReadingHistoryEntry[],
  from: string,
  to: string,
): MeterReadingHistoryEntry[] {
  const fromOk = from.trim();
  const toOk = to.trim();
  return entries.filter((e) => {
    if (fromOk && e.readingDate < fromOk) return false;
    if (toOk && e.readingDate > toOk) return false;
    return true;
  });
}

/** Sort newest first (date desc, then created_at desc). */
export function sortHistoryNewestFirst(entries: MeterReadingHistoryEntry[]): MeterReadingHistoryEntry[] {
  return [...entries].sort((a, b) => {
    const d = String(b.readingDate).localeCompare(String(a.readingDate));
    if (d !== 0) return d;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
}
