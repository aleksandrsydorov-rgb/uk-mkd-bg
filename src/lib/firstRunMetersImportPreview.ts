/**
 * Client-side clarify preview for water/electricity opening import.
 * Import/billing rules stay in SQL; this only shapes operator-facing copy.
 */

import type { FirstRunMeterUtility } from '@/lib/firstRun';

export type MeterClarifyKind =
  | 'missing_meter_number'
  | 'missing_reading'
  | 'missing_meter_and_reading'
  | 'missing_meter_keep_reading'
  | 'missing_day_reading'
  | 'missing_night_reading'
  | 'missing_day_and_night'
  | 'missing_meter_keep_zones'
  | 'missing_meter_and_zones'
  | 'needs_initial_internet_state';

export type MeterClarifyItem = {
  key: string;
  apartment: string;
  sectionCode: string;
  blockCode: string;
  excelRow: number | null;
  kind: MeterClarifyKind;
  /** Preserved water reading text (e.g. "0") when meter number is missing. */
  preservedReading?: string;
  preservedDay?: string;
  preservedNight?: string;
};

export type MeterClarifyEntranceGroup = {
  key: string;
  sectionCode: string;
  items: MeterClarifyItem[];
};

export type MetersOpeningClarifySummary = {
  rowCount: number;
  apartmentCount: number;
  completeApartments: number;
  deferredApartments: number;
  completeRows: number;
  deferredRows: number;
  items: MeterClarifyItem[];
  groups: MeterClarifyEntranceGroup[];
};

type T = (key: string, params?: Record<string, string | number>) => string;

function trim(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function parseNonNeg(raw: unknown): number | null {
  const s = trim(raw);
  if (!s) return null;
  const n = Number(String(s).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function identityKey(apartment: string, sectionCode: string, blockCode: string): string {
  return [apartment.toLowerCase(), sectionCode.toLowerCase(), blockCode.toLowerCase()].join('\u0001');
}

function slavicPluralForm(n: number): 'one' | 'few' | 'many' {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return 'one';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
  return 'many';
}

function aptPluralForm(n: number, locale?: string): 'one' | 'few' | 'many' {
  const abs = Math.abs(Math.trunc(n));
  // English: only exact 1 uses singular (41 → apartments).
  if ((locale || '').toLowerCase().startsWith('en')) {
    return abs === 1 ? 'one' : 'many';
  }
  return slavicPluralForm(abs);
}

/** «У N квартир(ы)» for the ready-summary sentence. */
export function formatAptCountAfterU(n: number, t: T, locale?: string): string {
  const form = aptPluralForm(n, locale);
  return t(`admin.firstRunMetersAptCountU_${form}`, { n: Math.abs(Math.trunc(n)) });
}

/** «По N квартире/квартирам» for the ready-summary sentence. */
export function formatAptCountAfterPo(n: number, t: T, locale?: string): string {
  const form = aptPluralForm(n, locale);
  return t(`admin.firstRunMetersAptCountPo_${form}`, { n: Math.abs(Math.trunc(n)) });
}

export function presentMeterClarifyMessage(item: MeterClarifyItem, t: T): string {
  switch (item.kind) {
    case 'missing_meter_number':
      return t('admin.firstRunMetersClarifyMissingMeter');
    case 'missing_reading':
      return t('admin.firstRunMetersClarifyMissingReading');
    case 'missing_meter_and_reading':
      return t('admin.firstRunMetersClarifyMissingMeterAndReading');
    case 'missing_meter_keep_reading':
      return t('admin.firstRunMetersClarifyKeepReadingAddMeter', {
        reading: item.preservedReading ?? '0',
      });
    case 'missing_day_reading':
      return t('admin.firstRunMetersClarifyMissingDay');
    case 'missing_night_reading':
      return t('admin.firstRunMetersClarifyMissingNight');
    case 'missing_day_and_night':
      return t('admin.firstRunMetersClarifyMissingDayAndNight');
    case 'missing_meter_keep_zones':
      return t('admin.firstRunMetersClarifyKeepZonesAddMeter', {
        day: item.preservedDay ?? '—',
        night: item.preservedNight ?? '—',
      });
    case 'missing_meter_and_zones':
      return t('admin.firstRunMetersClarifyMissingMeterAndZones');
    case 'needs_initial_internet_state':
      return t('admin.openingStatus_needs_initial_internet');
    default:
      return t('admin.importIssue_needs_initial_readings');
  }
}

function classifyWaterRow(
  row: Record<string, string>,
  excelRow: number | null,
): MeterClarifyItem | null {
  const apartment = trim(row.apartment_number);
  if (!apartment) return null;
  const sectionCode = trim(row.section_code);
  const blockCode = trim(row.block_code);
  const hasMeter = Boolean(trim(row.meter_number));
  const readingRaw = trim(row.initial_reading);
  const reading = readingRaw === '' ? null : parseNonNeg(row.initial_reading);
  if (hasMeter && reading != null) return null;

  let kind: MeterClarifyKind;
  let preservedReading: string | undefined;
  if (!hasMeter && reading == null) {
    kind = 'missing_meter_and_reading';
  } else if (!hasMeter && reading != null) {
    kind = 'missing_meter_keep_reading';
    preservedReading = readingRaw.includes(',') ? readingRaw : String(reading);
  } else {
    kind = 'missing_reading';
  }

  return {
    key: identityKey(apartment, sectionCode, blockCode),
    apartment,
    sectionCode,
    blockCode,
    excelRow,
    kind,
    preservedReading,
  };
}

function classifyElectricityRow(
  row: Record<string, string>,
  excelRow: number | null,
): MeterClarifyItem | null {
  const apartment = trim(row.apartment_number);
  if (!apartment) return null;
  const sectionCode = trim(row.section_code);
  const blockCode = trim(row.block_code);
  const hasMeter = Boolean(trim(row.meter_number));
  const dayRaw = trim(row.initial_day_reading);
  const nightRaw = trim(row.initial_night_reading);
  const day = dayRaw === '' ? null : parseNonNeg(row.initial_day_reading);
  const night = nightRaw === '' ? null : parseNonNeg(row.initial_night_reading);
  if (hasMeter && day != null && night != null) return null;

  let kind: MeterClarifyKind;
  let preservedDay: string | undefined;
  let preservedNight: string | undefined;
  if (!hasMeter && day == null && night == null) {
    kind = 'missing_meter_and_zones';
  } else if (!hasMeter && day != null && night != null) {
    kind = 'missing_meter_keep_zones';
    preservedDay = dayRaw;
    preservedNight = nightRaw;
  } else if (day == null && night == null) {
    kind = 'missing_day_and_night';
  } else if (day == null) {
    kind = 'missing_day_reading';
  } else if (night == null) {
    kind = 'missing_night_reading';
  } else {
    kind = 'missing_meter_number';
  }

  return {
    key: identityKey(apartment, sectionCode, blockCode),
    apartment,
    sectionCode,
    blockCode,
    excelRow,
    kind,
    preservedDay,
    preservedNight,
  };
}

function isElectricityComplete(row: Record<string, string>): boolean {
  if (!trim(row.apartment_number)) return false;
  if (!trim(row.meter_number)) return false;
  const dayOk = trim(row.initial_day_reading) !== '' && parseNonNeg(row.initial_day_reading) != null;
  const nightOk =
    trim(row.initial_night_reading) !== '' && parseNonNeg(row.initial_night_reading) != null;
  return dayOk && nightOk;
}

function isWaterRowComplete(row: Record<string, string>): boolean {
  if (!trim(row.apartment_number)) return false;
  const hasMeter = Boolean(trim(row.meter_number));
  const readingRaw = trim(row.initial_reading);
  const reading = readingRaw === '' ? null : parseNonNeg(row.initial_reading);
  return hasMeter && reading != null;
}

export function groupMeterClarifyByEntrance(items: MeterClarifyItem[]): MeterClarifyEntranceGroup[] {
  const map = new Map<string, MeterClarifyEntranceGroup>();
  for (const item of items) {
    const section = (item.sectionCode || '').trim();
    const key = section ? section.toLowerCase() : '\u0000';
    let group = map.get(key);
    if (!group) {
      group = { key, sectionCode: section, items: [] };
      map.set(key, group);
    }
    group.items.push(item);
  }
  const groups = [...map.values()].sort((a, b) => {
    if (!a.sectionCode && b.sectionCode) return 1;
    if (a.sectionCode && !b.sectionCode) return -1;
    return a.sectionCode.localeCompare(b.sectionCode, 'en', { sensitivity: 'base' });
  });
  for (const group of groups) {
    group.items.sort((a, b) => {
      const apt = a.apartment.localeCompare(b.apartment, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      if (apt !== 0) return apt;
      return (a.blockCode || '').localeCompare(b.blockCode || '', 'en', {
        sensitivity: 'base',
      });
    });
  }
  return groups;
}

export function formatMeterClarifyHeading(item: MeterClarifyItem, t: T): string {
  const apt = item.apartment || '—';
  if (item.blockCode) {
    return t('admin.bookPreviewAptCardTitleWithBlock', {
      apt,
      block: item.blockCode,
      status: '',
    }).replace(/\s*[—–-]\s*$/, '');
  }
  return t('admin.firstRunMetersClarifyAptHeading', { apt });
}

export function formatMeterEntranceGroupTitle(group: MeterClarifyEntranceGroup, t: T): string {
  const n = group.items.length;
  const form = slavicPluralForm(n);
  const countLabel = t(`admin.bookPreviewEntranceAptCount_${form}`, { n });
  const section = (group.sectionCode || '').trim();
  if (!section) return t('admin.bookPreviewEntranceGroupPlain', { countLabel });
  return t('admin.bookPreviewEntranceGroup', { section, countLabel });
}

/**
 * Build clarify summary from parsed opening rows (1-based data index → Excel row = index+2
 * when header is row 1; callers pass excelRow when known).
 */
export function buildMetersOpeningClarify(
  utility: FirstRunMeterUtility,
  rows: Record<string, string>[],
  opts?: { excelRowOffset?: number },
): MetersOpeningClarifySummary {
  const offset = opts?.excelRowOffset ?? 2; // header row 1, first data row 2
  const items: MeterClarifyItem[] = [];
  let completeRows = 0;
  const aptComplete = new Set<string>();
  const aptDeferred = new Set<string>();
  const aptAll = new Set<string>();

  rows.forEach((row, idx) => {
    const apartment = trim(row.apartment_number);
    if (!apartment) return;
    const key = identityKey(apartment, trim(row.section_code), trim(row.block_code));
    aptAll.add(key);
    const excelRow = offset + idx;
    const complete =
      utility === 'water' ? isWaterRowComplete(row) : isElectricityComplete(row);
    if (complete) {
      completeRows += 1;
      if (!aptDeferred.has(key)) aptComplete.add(key);
      return;
    }
    const item =
      utility === 'water' ? classifyWaterRow(row, excelRow) : classifyElectricityRow(row, excelRow);
    if (!item) return;
    items.push(item);
    aptDeferred.add(key);
    aptComplete.delete(key);
  });

  // If an apartment has both complete and incomplete meter rows, it stays deferred.
  for (const key of aptDeferred) aptComplete.delete(key);

  return {
    rowCount: rows.length,
    apartmentCount: aptAll.size,
    completeApartments: aptComplete.size,
    deferredApartments: aptDeferred.size,
    completeRows,
    deferredRows: items.length,
    items,
    groups: groupMeterClarifyByEntrance(items),
  };
}

/** Internet soft-defer rows: blank connection state only (explicit inactive is not a clarify). */
export function buildInternetOpeningClarify(
  previewRows: Array<Record<string, unknown>>,
): MetersOpeningClarifySummary {
  const items: MeterClarifyItem[] = [];
  const aptAll = new Set<string>();
  const aptDeferred = new Set<string>();
  const aptComplete = new Set<string>();
  let completeRows = 0;

  previewRows.forEach((raw, idx) => {
    const apartment = trim(raw.apartment_number);
    if (!apartment) return;
    const sectionCode = trim(raw.section_code);
    const blockCode = trim(raw.block_code);
    const key = identityKey(apartment, sectionCode, blockCode);
    aptAll.add(key);
    const status = trim(raw.status ?? raw.connection_state).toLowerCase();
    const warnings = Array.isArray(raw.warnings)
      ? raw.warnings.map((w) => String(w))
      : raw.warnings
        ? [String(raw.warnings)]
        : [];
    const explicitInactive =
      status === 'inactive' ||
      status === 'disconnected' ||
      status === 'не подключён' ||
      status === 'не подключен' ||
      status === 'not connected';
    const explicitActive =
      status === 'active' ||
      status === 'connected' ||
      status === 'подключён' ||
      status === 'подключен';
    const needsState =
      !explicitInactive &&
      !explicitActive &&
      (warnings.includes('needs_initial_internet_state') ||
        status === '' ||
        status === 'unknown' ||
        status === 'needs_initial');
    if (needsState) {
      items.push({
        key,
        apartment,
        sectionCode,
        blockCode,
        excelRow: idx + 2,
        kind: 'needs_initial_internet_state',
      });
      aptDeferred.add(key);
      aptComplete.delete(key);
      return;
    }
    completeRows += 1;
    if (!aptDeferred.has(key)) aptComplete.add(key);
  });

  for (const key of aptDeferred) aptComplete.delete(key);

  return {
    rowCount: previewRows.length,
    apartmentCount: aptAll.size,
    completeApartments: aptComplete.size,
    deferredApartments: aptDeferred.size,
    completeRows,
    deferredRows: items.length,
    items,
    groups: groupMeterClarifyByEntrance(items),
  };
}

export function presentMetersReadySummary(
  summary: MetersOpeningClarifySummary,
  t: T,
  locale?: string,
): string {
  const completeLabel = formatAptCountAfterU(summary.completeApartments, t, locale);
  const deferredLabel = formatAptCountAfterPo(summary.deferredApartments, t, locale);
  if (summary.deferredApartments <= 0) {
    return t('admin.firstRunMetersReadyAllComplete', { completeLabel });
  }
  let text = t('admin.firstRunMetersReadySummary', {
    completeLabel,
    deferredLabel,
  });
  if (
    summary.rowCount !== summary.apartmentCount ||
    summary.completeRows !== summary.completeApartments ||
    summary.deferredRows !== summary.deferredApartments
  ) {
    text +=
      ' ' +
      t('admin.firstRunMetersReadyMetersNote', {
        completeMeters: summary.completeRows,
        deferredMeters: summary.deferredRows,
      });
  }
  return text;
}

export function presentInternetReadySummary(
  summary: MetersOpeningClarifySummary,
  t: T,
  locale?: string,
): string {
  const completeLabel = formatAptCountAfterU(summary.completeApartments, t, locale);
  const deferredLabel = formatAptCountAfterPo(summary.deferredApartments, t, locale);
  if (summary.deferredApartments <= 0) {
    return t('admin.firstRunMetersReadyAllComplete', { completeLabel });
  }
  return t('admin.firstRunInternetReadySummary', { completeLabel, deferredLabel });
}
