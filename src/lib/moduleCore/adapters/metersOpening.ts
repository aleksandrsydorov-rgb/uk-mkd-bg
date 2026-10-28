/**
 * Phase IS-3 / MTR-3 — Water / Electricity meter opening helpers.
 * Inventory via canonical assign_* plus charge-free register_*_opening_reading.
 * Operational submit_* remain distinct (create ledger charges).
 */

import * as XLSX from 'xlsx';
import type { ImportPreviewResult, ImportPreviewRow, ImportRowOperation } from '@/lib/moduleCore/types';
import { sanitizeSpreadsheetCell } from '@/lib/moduleCore/xlsxEngine';

export const WATER_MODULE_KEY = 'water';
export const ELECTRICITY_MODULE_KEY = 'electricity';
export const METERS_SETUP_SCHEMA_VERSION = '1.0';

/** Opening reading ROWS via register_*_opening_reading (charge-free). MTR-3 ENABLED. */
export type OpeningReadingRowCommitMode = 'BLOCKED' | 'ENABLED';
export const OPENING_READING_ROW_COMMIT: OpeningReadingRowCommitMode = 'ENABLED';

export type MeterUtility = 'water' | 'electricity';

export type ApartmentRef = {
  propertyId: number;
  apartmentNumber: string;
};

export type ExistingMeterRef = {
  propertyId: number;
  meterNumber: string;
  retiredAt: string | null;
};

export type MeterOpeningPolicy = {
  /** Always false in IS-3 — never call replace_*. */
  allowReplace: boolean;
};

export const DEFAULT_METER_OPENING_POLICY: MeterOpeningPolicy = {
  allowReplace: false,
};

export const WATER_METER_HEADERS = [
  'apartment_number',
  'meter_number',
  'initial_reading',
  'installed_at',
  'opening_balance_kind',
  'opening_balance_eur',
] as const;

export const ELECTRICITY_METER_HEADERS = [
  'apartment_number',
  'meter_number',
  'initial_day_reading',
  'initial_night_reading',
  'installed_at',
  'opening_balance_kind',
  'opening_balance_eur',
] as const;

function normApt(value: string | undefined | null): string {
  return String(value ?? '').trim().toLowerCase();
}

function normSerial(value: string | undefined | null): string {
  return String(value ?? '').trim().toLowerCase();
}

function parseNonNegNumber(raw: string | undefined): number | null {
  const t = String(raw ?? '')
    .trim()
    .replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** YYYY-MM-DD; rejects empty / unparsable / future (UTC calendar date). */
export function parseInstalledAtDate(raw: string | undefined): { ok: true; iso: string } | { ok: false; error: string } {
  const t = String(raw ?? '').trim();
  if (!t) return { ok: false, error: 'required:installed_at' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return { ok: false, error: 'invalid:installed_at' };
  const d = new Date(`${t}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return { ok: false, error: 'invalid:installed_at' };
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  if (t > todayIso) return { ok: false, error: 'invalid:installed_at_future' };
  return { ok: true, iso: t };
}

export const OPENING_BALANCE_KINDS = ['zero', 'debt', 'overpayment'] as const;
export type OpeningBalanceKind = (typeof OPENING_BALANCE_KINDS)[number];

/** Empty kind ⇒ zero (RC8 first-run). debt/overpayment require amount > 0. */
export function validateOpeningBalanceFields(row: Record<string, string>): string[] {
  const kind = String(row.opening_balance_kind ?? '')
    .trim()
    .toLowerCase();
  const effectiveKind = kind || 'zero';
  if (!(OPENING_BALANCE_KINDS as readonly string[]).includes(effectiveKind)) {
    return ['invalid:opening_balance_kind'];
  }
  const rawAmount = String(row.opening_balance_eur ?? '').trim();
  if (effectiveKind === 'zero') {
    if (rawAmount && parseNonNegNumber(rawAmount) == null) return ['invalid:opening_balance_eur'];
    return [];
  }
  const amount = parseNonNegNumber(rawAmount);
  if (amount == null || amount <= 0) return ['required:opening_balance_eur'];
  return [];
}

export function validateWaterMeterRow(row: Record<string, string>): string[] {
  const errors: string[] = [];
  if (!row.apartment_number?.trim()) errors.push('required:apartment_number');
  if (!row.meter_number?.trim()) errors.push('required:meter_number');
  if (parseNonNegNumber(row.initial_reading) == null) errors.push('invalid:initial_reading');
  const date = parseInstalledAtDate(row.installed_at);
  if (!date.ok) errors.push(date.error);
  errors.push(...validateOpeningBalanceFields(row));
  if (Object.prototype.hasOwnProperty.call(row, 'property_id') && String(row.property_id ?? '').trim()) {
    errors.push('untrusted_property_id');
  }
  return errors;
}

export function validateElectricityMeterRow(row: Record<string, string>): string[] {
  const errors: string[] = [];
  if (!row.apartment_number?.trim()) errors.push('required:apartment_number');
  if (!row.meter_number?.trim()) errors.push('required:meter_number');
  if (parseNonNegNumber(row.initial_day_reading) == null) errors.push('invalid:initial_day_reading');
  if (parseNonNegNumber(row.initial_night_reading) == null) {
    errors.push('invalid:initial_night_reading');
  }
  const date = parseInstalledAtDate(row.installed_at);
  if (!date.ok) errors.push(date.error);
  errors.push(...validateOpeningBalanceFields(row));
  if (Object.prototype.hasOwnProperty.call(row, 'property_id') && String(row.property_id ?? '').trim()) {
    errors.push('untrusted_property_id');
  }
  return errors;
}

/**
 * Opening-reading *row* validation for preview notes.
 * Commit uses register_*_opening_reading (not submit_*).
 */
export function validateOpeningReadingPreviewFields(
  utility: MeterUtility,
  row: Record<string, string>,
): string[] {
  // Same fields as inventarisation baselines — preview must still reject bad values.
  if (utility === 'water') return validateWaterMeterRow(row).filter((e) => e.includes('initial') || e.includes('installed'));
  return validateElectricityMeterRow(row).filter(
    (e) => e.includes('initial') || e.includes('installed'),
  );
}

export type MeterClassifyContext = {
  apartmentsByNumber: Map<string, number>; // normApt → propertyId
  /** normSerial of ACTIVE meters (retired_at is null). */
  existingActiveSerials: Set<string>;
  /** normSerial → propertyId for ALL meters (active+retired) — serial is globally unique. */
  existingMetersBySerial: Map<string, number>;
  policy?: MeterOpeningPolicy;
};

function bump(
  counters: { createCount: number; updateCount: number; skipCount: number; errorCount: number },
  op: ImportRowOperation,
) {
  if (op === 'create') counters.createCount += 1;
  else if (op === 'update') counters.updateCount += 1;
  else if (op === 'skip') counters.skipCount += 1;
  else counters.errorCount += 1;
}

/**
 * R1-RC8: multi-meter per apartment. Classification is by meter_number:
 * existing serial on same apartment → skip; unknown serial → create (even if apartment
 * already has an active meter); serial owned by another apartment → error.
 */
function classifyMeterOpeningRows(
  utility: MeterUtility,
  rows: Record<string, string>[],
  ctx: MeterClassifyContext,
  validate: (row: Record<string, string>) => string[],
): ImportPreviewResult {
  const policy = ctx.policy ?? DEFAULT_METER_OPENING_POLICY;
  const counters = { createCount: 0, updateCount: 0, skipCount: 0, errorCount: 0 };
  const previewRows: ImportPreviewRow[] = [];
  const serialsInFile = new Map<string, number>();

  rows.forEach((raw, idx) => {
    const rowNumber = idx + 2;
    const errors = validate(raw);
    const apt = normApt(raw.apartment_number);
    const serial = normSerial(raw.meter_number);
    const propertyId = apt ? ctx.apartmentsByNumber.get(apt) : undefined;

    if (apt && !propertyId) errors.push('unknown_apartment');
    if (serial) {
      if (serialsInFile.has(serial)) errors.push('duplicate_in_file:meter_number');
      else serialsInFile.set(serial, rowNumber);
    }
    const serialOwner = serial ? ctx.existingMetersBySerial.get(serial) : undefined;
    if (serialOwner != null && propertyId != null && serialOwner !== propertyId) {
      errors.push('duplicate_serial:meter_number');
    }

    let operation: ImportRowOperation = 'error';
    if (errors.length === 0 && propertyId != null) {
      if (serialOwner != null || ctx.existingActiveSerials.has(serial)) {
        operation = policy.allowReplace ? 'update' : 'skip';
      } else {
        operation = 'create';
      }
    }
    if (errors.length) operation = 'error';

    const data: Record<string, string> = {
      ...raw,
      utility,
      opening_reading_row_commit: OPENING_READING_ROW_COMMIT,
      resolved_property_id: propertyId != null ? String(propertyId) : '',
    };

    bump(counters, operation);
    previewRows.push({
      rowNumber,
      operation,
      data,
      errors,
      matchKey: serial || apt || undefined,
    });
  });

  return {
    schemaVersion: METERS_SETUP_SCHEMA_VERSION,
    rows: previewRows,
    ...counters,
  };
}

export function classifyWaterMeterOpeningRows(
  rows: Record<string, string>[],
  ctx: MeterClassifyContext,
): ImportPreviewResult {
  return classifyMeterOpeningRows('water', rows, ctx, validateWaterMeterRow);
}

export function classifyElectricityMeterOpeningRows(
  rows: Record<string, string>[],
  ctx: MeterClassifyContext,
): ImportPreviewResult {
  return classifyMeterOpeningRows('electricity', rows, ctx, validateElectricityMeterRow);
}

export function buildApartmentLookup(
  apartments: Iterable<{ property_id: number; apartment_number: string | number }>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of apartments) {
    const key = normApt(String(a.apartment_number));
    if (key) map.set(key, a.property_id);
  }
  return map;
}

export function activePropertyIdsFromMeters(meters: ExistingMeterRef[]): Set<number> {
  const set = new Set<number>();
  for (const m of meters) {
    if (m.retiredAt == null || m.retiredAt === '') set.add(m.propertyId);
  }
  return set;
}

export function existingActiveSerialsFromMeters(meters: ExistingMeterRef[]): Set<string> {
  const set = new Set<string>();
  for (const m of meters) {
    if (m.retiredAt == null || m.retiredAt === '') {
      const s = normSerial(m.meterNumber);
      if (s) set.add(s);
    }
  }
  return set;
}

export function existingMetersBySerialFromMeters(meters: ExistingMeterRef[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of meters) {
    const s = normSerial(m.meterNumber);
    if (s) map.set(s, m.propertyId);
  }
  return map;
}

export function serialSetFromMeters(meters: ExistingMeterRef[]): Set<string> {
  return new Set(meters.map((m) => normSerial(m.meterNumber)).filter(Boolean));
}

/** Assign payload for CREATE rows only — never replace, never submit readings. */
export type WaterAssignPayload = {
  propertyId: number;
  meterNumber: string;
  initialReading: number;
  installedAt: string;
  openingBalanceKind?: OpeningBalanceKind;
  openingBalanceEur?: number;
};

export type ElectricityAssignPayload = {
  propertyId: number;
  meterNumber: string;
  initialDayReading: number;
  initialNightReading: number;
  installedAt: string;
  openingBalanceKind?: OpeningBalanceKind;
  openingBalanceEur?: number;
};

export function waterAssignPayloadsFromPreview(preview: ImportPreviewResult): WaterAssignPayload[] {
  const out: WaterAssignPayload[] = [];
  for (const row of preview.rows) {
    if (row.operation !== 'create') continue;
    const propertyId = Number(row.data.resolved_property_id);
    const initialReading = parseNonNegNumber(row.data.initial_reading);
    const date = parseInstalledAtDate(row.data.installed_at);
    if (!propertyId || initialReading == null || !date.ok) continue;
    out.push({
      propertyId,
      meterNumber: String(row.data.meter_number ?? '').trim(),
      initialReading,
      installedAt: date.iso,
    });
  }
  return out;
}

export function electricityAssignPayloadsFromPreview(
  preview: ImportPreviewResult,
): ElectricityAssignPayload[] {
  const out: ElectricityAssignPayload[] = [];
  for (const row of preview.rows) {
    if (row.operation !== 'create') continue;
    const propertyId = Number(row.data.resolved_property_id);
    const day = parseNonNegNumber(row.data.initial_day_reading);
    const night = parseNonNegNumber(row.data.initial_night_reading);
    const date = parseInstalledAtDate(row.data.installed_at);
    if (!propertyId || day == null || night == null || !date.ok) continue;
    out.push({
      propertyId,
      meterNumber: String(row.data.meter_number ?? '').trim(),
      initialDayReading: day,
      initialNightReading: night,
      installedAt: date.iso,
    });
  }
  return out;
}

const WATER_INSTRUCTIONS: Record<'bg' | 'ru' | 'en', string[]> = {
  bg: [
    'Водомери — начален импорт (IS-3)',
    `schema_version: ${METERS_SETUP_SCHEMA_VERSION}. Лист: meters.`,
    'Ключ апартамент: apartment_number (от Книгата). property_id е забранен.',
    'Полета: apartment_number, meter_number, initial_reading, installed_at (YYYY-MM-DD), opening_balance_kind (zero|debt|overpayment), opening_balance_eur.',
    'Няколко водомера на апартамент: отделен ред за всеки meter_number. Начално салдо — веднъж на апартамент.',
    'initial_reading + installed_at → assign_water_meter (инвентар).',
    'ЗАБРАНЕНО: submit_water_reading / редове във water_readings (създават такси).',
    'Съществуващ meter_number → SKIP. Без replace/overwrite.',
    `opening_reading_row_commit=${OPENING_READING_ROW_COMMIT}`,
  ],
  ru: [
    'Водомеры — начальный импорт (IS-3)',
    `schema_version: ${METERS_SETUP_SCHEMA_VERSION}. Лист: meters.`,
    'Ключ квартиры: apartment_number (из Книги). property_id запрещён.',
    'Поля: apartment_number, meter_number, initial_reading, installed_at (YYYY-MM-DD), opening_balance_kind (zero|debt|overpayment), opening_balance_eur.',
    'Несколько счётчиков на квартиру: отдельная строка на каждый meter_number. Начальное сальдо — один раз на квартиру.',
    'initial_reading + installed_at → assign_water_meter (инвентаризация).',
    'ЗАПРЕЩЕНО: submit_water_reading / строки water_readings (создают начисления).',
    'Существующий meter_number → SKIP. Без replace/overwrite.',
    `opening_reading_row_commit=${OPENING_READING_ROW_COMMIT}`,
  ],
  en: [
    'Water meters — opening import (IS-3)',
    `schema_version: ${METERS_SETUP_SCHEMA_VERSION}. Sheet: meters.`,
    'Apartment key: apartment_number (from Property Book). property_id forbidden.',
    'Columns: apartment_number, meter_number, initial_reading, installed_at (YYYY-MM-DD), opening_balance_kind (zero|debt|overpayment), opening_balance_eur.',
    'Multiple meters per apartment: one row per meter_number. Opening balance applies once per apartment.',
    'initial_reading + installed_at map to assign_water_meter (inventory only).',
    'FORBIDDEN: submit_water_reading / water_readings rows (they create charges).',
    'Existing meter_number → SKIP. No replace/overwrite.',
    `opening_reading_row_commit=${OPENING_READING_ROW_COMMIT}`,
  ],
};

const ELECTRICITY_INSTRUCTIONS: Record<'bg' | 'ru' | 'en', string[]> = {
  bg: [
    'Електромери — начален импорт (IS-3)',
    `schema_version: ${METERS_SETUP_SCHEMA_VERSION}. Лист: meters.`,
    'Ключ апартамент: apartment_number (от Книгата). property_id е забранен.',
    'Полета: apartment_number, meter_number, initial_day_reading, initial_night_reading, installed_at, opening_balance_kind, opening_balance_eur.',
    'Базови показания ден/нощ → assign_electricity_meter (инвентар).',
    'ЗАБРАНЕНО: submit_electricity_reading / meter_readings (създават такси).',
    'Съществуващ meter_number → SKIP. Без replace/overwrite.',
    `opening_reading_row_commit=${OPENING_READING_ROW_COMMIT}`,
  ],
  ru: [
    'Электросчётчики — начальный импорт (IS-3)',
    `schema_version: ${METERS_SETUP_SCHEMA_VERSION}. Лист: meters.`,
    'Ключ квартиры: apartment_number (из Книги). property_id запрещён.',
    'Поля: apartment_number, meter_number, initial_day_reading, initial_night_reading, installed_at, opening_balance_kind, opening_balance_eur.',
    'Базовые день/ночь → assign_electricity_meter (инвентаризация).',
    'ЗАПРЕЩЕНО: submit_electricity_reading / meter_readings (создают начисления).',
    'Существующий meter_number → SKIP. Без replace/overwrite.',
    `opening_reading_row_commit=${OPENING_READING_ROW_COMMIT}`,
  ],
  en: [
    'Electricity meters — opening import (IS-3)',
    `schema_version: ${METERS_SETUP_SCHEMA_VERSION}. Sheet: meters.`,
    'Apartment key: apartment_number (from Property Book). property_id forbidden.',
    'Columns: apartment_number, meter_number, initial_day_reading, initial_night_reading, installed_at, opening_balance_kind, opening_balance_eur.',
    'Day/night baselines map to assign_electricity_meter (inventory only).',
    'FORBIDDEN: submit_electricity_reading / meter_readings rows (they create charges).',
    'Existing meter_number → SKIP. No replace/overwrite.',
    `opening_reading_row_commit=${OPENING_READING_ROW_COMMIT}`,
  ],
};

function appendInstructionSheets(
  wb: XLSX.WorkBook,
  instructions: Record<'bg' | 'ru' | 'en', string[]>,
) {
  for (const lang of ['bg', 'ru', 'en'] as const) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(instructions[lang].map((line) => [line])),
      `instructions_${lang}`,
    );
  }
}

export function buildWaterMeterIs3TemplateBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const example = [
    {
      apartment_number: '12',
      meter_number: 'W-12-001',
      initial_reading: '0',
      installed_at: '2026-01-15',
      opening_balance_kind: 'zero',
      opening_balance_eur: '',
    },
    {
      apartment_number: '14',
      meter_number: 'W-14-001',
      initial_reading: '12.5',
      installed_at: '2026-01-15',
      opening_balance_kind: 'debt',
      opening_balance_eur: '25.00',
    },
  ].map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, sanitizeSpreadsheetCell(String(v))]),
    ),
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(example, { header: [...WATER_METER_HEADERS] }),
    'meters',
  );
  appendInstructionSheets(wb, WATER_INSTRUCTIONS);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export function buildElectricityMeterIs3TemplateBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const example = [
    {
      apartment_number: '12',
      meter_number: 'E-12-001',
      initial_day_reading: '0',
      initial_night_reading: '0',
      installed_at: '2026-01-15',
      opening_balance_kind: 'zero',
      opening_balance_eur: '',
    },
    {
      apartment_number: '14',
      meter_number: 'E-14-001',
      initial_day_reading: '100.5',
      initial_night_reading: '40.2',
      installed_at: '2026-01-15',
      opening_balance_kind: 'overpayment',
      opening_balance_eur: '10.00',
    },
  ].map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, sanitizeSpreadsheetCell(String(v))]),
    ),
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(example, { header: [...ELECTRICITY_METER_HEADERS] }),
    'meters',
  );
  appendInstructionSheets(wb, ELECTRICITY_INSTRUCTIONS);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

function downloadBuf(buf: ArrayBuffer, fileName: string) {
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadWaterMeterIs3Template(fileName = 'water_meters_opening_template.xlsx') {
  downloadBuf(buildWaterMeterIs3TemplateBuffer(), fileName);
}

export function downloadElectricityMeterIs3Template(
  fileName = 'electricity_meters_opening_template.xlsx',
) {
  downloadBuf(buildElectricityMeterIs3TemplateBuffer(), fileName);
}

export function buildMeterErrorReportXlsx(preview: ImportPreviewResult): ArrayBuffer {
  const aoa: string[][] = [['rowNumber', 'operation', 'matchKey', 'errors', 'data']];
  for (const row of preview.rows.filter((r) => r.errors.length || r.operation === 'error')) {
    aoa.push([
      String(row.rowNumber),
      row.operation,
      sanitizeSpreadsheetCell(row.matchKey ?? ''),
      sanitizeSpreadsheetCell(row.errors.join('; ')),
      sanitizeSpreadsheetCell(JSON.stringify(row.data)),
    ]);
  }
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'errors');
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export function downloadMeterErrorReport(
  preview: ImportPreviewResult,
  fileName = 'meter_import_errors.xlsx',
) {
  downloadBuf(buildMeterErrorReportXlsx(preview), fileName);
}

/** True when opening reading-row commit is disabled (legacy IS-3). MTR-3 → false. */
export function isOpeningReadingRowCommitBlocked(): boolean {
  return OPENING_READING_ROW_COMMIT === 'BLOCKED';
}

/** True when charge-free opening reading rows are committed after assign_*. */
export function isOpeningReadingRowCommitEnabled(): boolean {
  return OPENING_READING_ROW_COMMIT === 'ENABLED';
}
