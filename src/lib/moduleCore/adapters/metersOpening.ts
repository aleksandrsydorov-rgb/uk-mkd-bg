/**
 * Phase IS-3 — Water / Electricity meter opening helpers.
 * Inventory via canonical assign_* only. Operational reading-row writes BLOCKED
 * (submit_water_reading / submit_electricity_reading create ledger charges).
 */

import * as XLSX from 'xlsx';
import type { ImportPreviewResult, ImportPreviewRow, ImportRowOperation } from '@/lib/moduleCore/types';
import { sanitizeSpreadsheetCell } from '@/lib/moduleCore/xlsxEngine';

export const WATER_MODULE_KEY = 'water';
export const ELECTRICITY_MODULE_KEY = 'electricity';
export const METERS_SETUP_SCHEMA_VERSION = '1.0';

/** Opening reading ROWS (water_readings / meter_readings) are not committed by IS-3. */
export const OPENING_READING_ROW_COMMIT = 'BLOCKED' as const;

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
] as const;

export const ELECTRICITY_METER_HEADERS = [
  'apartment_number',
  'meter_number',
  'initial_day_reading',
  'initial_night_reading',
  'installed_at',
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

export function validateWaterMeterRow(row: Record<string, string>): string[] {
  const errors: string[] = [];
  if (!row.apartment_number?.trim()) errors.push('required:apartment_number');
  if (!row.meter_number?.trim()) errors.push('required:meter_number');
  if (parseNonNegNumber(row.initial_reading) == null) errors.push('invalid:initial_reading');
  const date = parseInstalledAtDate(row.installed_at);
  if (!date.ok) errors.push(date.error);
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
  if (Object.prototype.hasOwnProperty.call(row, 'property_id') && String(row.property_id ?? '').trim()) {
    errors.push('untrusted_property_id');
  }
  return errors;
}

/**
 * Opening-reading *row* validation for preview notes only.
 * Commit of water_readings / meter_readings remains BLOCKED (charges).
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
  activePropertyIds: Set<number>;
  existingSerials: Set<string>; // normSerial of all meters (active+retired) for unique constraint
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

export function classifyWaterMeterOpeningRows(
  rows: Record<string, string>[],
  ctx: MeterClassifyContext,
): ImportPreviewResult {
  const policy = ctx.policy ?? DEFAULT_METER_OPENING_POLICY;
  const counters = { createCount: 0, updateCount: 0, skipCount: 0, errorCount: 0 };
  const previewRows: ImportPreviewRow[] = [];
  const serialsInFile = new Map<string, number>();
  const aptInFile = new Map<string, number>();

  rows.forEach((raw, idx) => {
    const rowNumber = idx + 2;
    const errors = validateWaterMeterRow(raw);
    const apt = normApt(raw.apartment_number);
    const serial = normSerial(raw.meter_number);
    const propertyId = apt ? ctx.apartmentsByNumber.get(apt) : undefined;

    if (apt && !propertyId) errors.push('unknown_apartment');
    if (serial) {
      if (serialsInFile.has(serial)) errors.push('duplicate_in_file:meter_number');
      else serialsInFile.set(serial, rowNumber);
      if (ctx.existingSerials.has(serial)) errors.push('duplicate_serial:meter_number');
    }
    if (apt) {
      if (aptInFile.has(apt)) errors.push('duplicate_in_file:apartment_number');
      else aptInFile.set(apt, rowNumber);
    }

    let operation: ImportRowOperation = 'error';
    if (errors.length === 0 && propertyId != null) {
      if (ctx.activePropertyIds.has(propertyId)) {
        operation = policy.allowReplace ? 'update' : 'skip';
      } else {
        operation = 'create';
      }
    }
    if (errors.length) operation = 'error';

    // Annotate blocked reading-row commit (inventarisation still may CREATE).
    const data: Record<string, string> = {
      ...raw,
      utility: 'water',
      opening_reading_row_commit: OPENING_READING_ROW_COMMIT,
      resolved_property_id: propertyId != null ? String(propertyId) : '',
    };

    bump(counters, operation);
    previewRows.push({
      rowNumber,
      operation,
      data,
      errors,
      matchKey: apt || undefined,
    });
  });

  return {
    schemaVersion: METERS_SETUP_SCHEMA_VERSION,
    rows: previewRows,
    ...counters,
  };
}

export function classifyElectricityMeterOpeningRows(
  rows: Record<string, string>[],
  ctx: MeterClassifyContext,
): ImportPreviewResult {
  const policy = ctx.policy ?? DEFAULT_METER_OPENING_POLICY;
  const counters = { createCount: 0, updateCount: 0, skipCount: 0, errorCount: 0 };
  const previewRows: ImportPreviewRow[] = [];
  const serialsInFile = new Map<string, number>();
  const aptInFile = new Map<string, number>();

  rows.forEach((raw, idx) => {
    const rowNumber = idx + 2;
    const errors = validateElectricityMeterRow(raw);
    const apt = normApt(raw.apartment_number);
    const serial = normSerial(raw.meter_number);
    const propertyId = apt ? ctx.apartmentsByNumber.get(apt) : undefined;

    if (apt && !propertyId) errors.push('unknown_apartment');
    if (serial) {
      if (serialsInFile.has(serial)) errors.push('duplicate_in_file:meter_number');
      else serialsInFile.set(serial, rowNumber);
      if (ctx.existingSerials.has(serial)) errors.push('duplicate_serial:meter_number');
    }
    if (apt) {
      if (aptInFile.has(apt)) errors.push('duplicate_in_file:apartment_number');
      else aptInFile.set(apt, rowNumber);
    }

    let operation: ImportRowOperation = 'error';
    if (errors.length === 0 && propertyId != null) {
      if (ctx.activePropertyIds.has(propertyId)) {
        operation = policy.allowReplace ? 'update' : 'skip';
      } else {
        operation = 'create';
      }
    }
    if (errors.length) operation = 'error';

    const data: Record<string, string> = {
      ...raw,
      utility: 'electricity',
      opening_reading_row_commit: OPENING_READING_ROW_COMMIT,
      resolved_property_id: propertyId != null ? String(propertyId) : '',
    };

    bump(counters, operation);
    previewRows.push({
      rowNumber,
      operation,
      data,
      errors,
      matchKey: apt || undefined,
    });
  });

  return {
    schemaVersion: METERS_SETUP_SCHEMA_VERSION,
    rows: previewRows,
    ...counters,
  };
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

export function serialSetFromMeters(meters: ExistingMeterRef[]): Set<string> {
  return new Set(meters.map((m) => normSerial(m.meterNumber)).filter(Boolean));
}

/** Assign payload for CREATE rows only — never replace, never submit readings. */
export type WaterAssignPayload = {
  propertyId: number;
  meterNumber: string;
  initialReading: number;
  installedAt: string;
};

export type ElectricityAssignPayload = {
  propertyId: number;
  meterNumber: string;
  initialDayReading: number;
  initialNightReading: number;
  installedAt: string;
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
    'Полета: apartment_number, meter_number, initial_reading, installed_at (YYYY-MM-DD).',
    'initial_reading + installed_at → assign_water_meter (инвентар).',
    'ЗАБРАНЕНО: submit_water_reading / редове във water_readings (създават такси).',
    'Съществуващ активен водомер → SKIP. Без replace/overwrite.',
    `opening_reading_row_commit=${OPENING_READING_ROW_COMMIT}`,
  ],
  ru: [
    'Водомеры — начальный импорт (IS-3)',
    `schema_version: ${METERS_SETUP_SCHEMA_VERSION}. Лист: meters.`,
    'Ключ квартиры: apartment_number (из Книги). property_id запрещён.',
    'Поля: apartment_number, meter_number, initial_reading, installed_at (YYYY-MM-DD).',
    'initial_reading + installed_at → assign_water_meter (инвентаризация).',
    'ЗАПРЕЩЕНО: submit_water_reading / строки water_readings (создают начисления).',
    'Существующий активный водомер → SKIP. Без replace/overwrite.',
    `opening_reading_row_commit=${OPENING_READING_ROW_COMMIT}`,
  ],
  en: [
    'Water meters — opening import (IS-3)',
    `schema_version: ${METERS_SETUP_SCHEMA_VERSION}. Sheet: meters.`,
    'Apartment key: apartment_number (from Property Book). property_id forbidden.',
    'Columns: apartment_number, meter_number, initial_reading, installed_at (YYYY-MM-DD).',
    'initial_reading + installed_at map to assign_water_meter (inventory only).',
    'FORBIDDEN: submit_water_reading / water_readings rows (they create charges).',
    'Existing active water meter → SKIP. No replace/overwrite.',
    `opening_reading_row_commit=${OPENING_READING_ROW_COMMIT}`,
  ],
};

const ELECTRICITY_INSTRUCTIONS: Record<'bg' | 'ru' | 'en', string[]> = {
  bg: [
    'Електромери — начален импорт (IS-3)',
    `schema_version: ${METERS_SETUP_SCHEMA_VERSION}. Лист: meters.`,
    'Ключ апартамент: apartment_number (от Книгата). property_id е забранен.',
    'Полета: apartment_number, meter_number, initial_day_reading, initial_night_reading, installed_at.',
    'Базови показания ден/нощ → assign_electricity_meter (инвентар).',
    'ЗАБРАНЕНО: submit_electricity_reading / meter_readings (създават такси).',
    'Съществуващ активен електромер → SKIP. Без replace/overwrite.',
    `opening_reading_row_commit=${OPENING_READING_ROW_COMMIT}`,
  ],
  ru: [
    'Электросчётчики — начальный импорт (IS-3)',
    `schema_version: ${METERS_SETUP_SCHEMA_VERSION}. Лист: meters.`,
    'Ключ квартиры: apartment_number (из Книги). property_id запрещён.',
    'Поля: apartment_number, meter_number, initial_day_reading, initial_night_reading, installed_at.',
    'Базовые день/ночь → assign_electricity_meter (инвентаризация).',
    'ЗАПРЕЩЕНО: submit_electricity_reading / meter_readings (создают начисления).',
    'Существующий активный счётчик → SKIP. Без replace/overwrite.',
    `opening_reading_row_commit=${OPENING_READING_ROW_COMMIT}`,
  ],
  en: [
    'Electricity meters — opening import (IS-3)',
    `schema_version: ${METERS_SETUP_SCHEMA_VERSION}. Sheet: meters.`,
    'Apartment key: apartment_number (from Property Book). property_id forbidden.',
    'Columns: apartment_number, meter_number, initial_day_reading, initial_night_reading, installed_at.',
    'Day/night baselines map to assign_electricity_meter (inventory only).',
    'FORBIDDEN: submit_electricity_reading / meter_readings rows (they create charges).',
    'Existing active electricity meter → SKIP. No replace/overwrite.',
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
    },
    {
      apartment_number: '14',
      meter_number: 'W-14-001',
      initial_reading: '12.5',
      installed_at: '2026-01-15',
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
    },
    {
      apartment_number: '14',
      meter_number: 'E-14-001',
      initial_day_reading: '100.5',
      initial_night_reading: '40.2',
      installed_at: '2026-01-15',
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

/** True if preview commit would not call submit_* reading RPCs (always true for IS-3). */
export function isOpeningReadingRowCommitBlocked(): boolean {
  return OPENING_READING_ROW_COMMIT === 'BLOCKED';
}
