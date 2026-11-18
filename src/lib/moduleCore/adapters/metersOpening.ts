/**
 * Phase IS-3 / MTR-3 — Water / Electricity meter opening helpers.
 * Inventory via canonical assign_* plus charge-free register_*_opening_reading.
 * Operational submit_* remain distinct (create ledger charges).
 */

import * as XLSX from 'xlsx';
import type { ImportPreviewResult, ImportPreviewRow, ImportRowOperation } from '@/lib/moduleCore/types';
import { sanitizeSpreadsheetCell } from '@/lib/moduleCore/xlsxEngine';
import {
  ELECTRICITY_METERS_IMPORT_SPEC,
  WATER_METERS_IMPORT_SPEC,
  buildLocalizedImportWorkbook,
  downloadImportTemplateBuffer,
  localizedTemplateFileName,
  toImportTemplateLocale,
  type ImportTemplateLocale,
} from '@/lib/importTemplates';
import {
  buildWaterMeterIs3TemplateBuffer as buildWaterMeterTemplateFromSpec,
  type WaterMeterIdentitySeed,
} from '@/lib/importTemplates/specs/waterMeters';
import {
  buildElectricityMeterIs3TemplateBuffer as buildElectricityMeterTemplateFromSpec,
  type ElectricityMeterIdentitySeed,
} from '@/lib/importTemplates/specs/electricityMeters';
import {
  apartmentScopeKeyFromRow,
  buildApartmentIdentityLookup,
  resolveApartmentPropertyId,
  sectionBlockFormatError,
  type ApartmentLookupBundle,
  type ApartmentLookupRow,
} from '@/lib/propertyBookIdentity';
import { sortPropertyBookOwnerIdentitySeeds } from '@/lib/propertyBookAdmin';

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

/** Canonical column keys (also accepted as spreadsheet headers). */
export const WATER_METER_HEADERS = [
  'apartment_number',
  'section_code',
  'block_code',
  'meter_number',
  'initial_reading',
  'installed_at',
  'opening_balance_kind',
  'opening_balance_eur',
] as const;

export const ELECTRICITY_METER_HEADERS = [
  'apartment_number',
  'section_code',
  'block_code',
  'meter_number',
  'initial_day_reading',
  'initial_night_reading',
  'installed_at',
  'opening_balance_kind',
  'opening_balance_eur',
] as const;

/** Human BG labels for new templates; parsers still accept snake_case keys. */
export const WATER_METER_HEADER_LABELS_BG: Record<(typeof WATER_METER_HEADERS)[number], string> = {
  apartment_number: 'Апартамент',
  section_code: 'Секция',
  block_code: 'Блок',
  meter_number: 'Номер на водомер',
  initial_reading: 'Начално показание',
  installed_at: 'Дата на монтаж',
  opening_balance_kind: 'Тип начален остатък',
  opening_balance_eur: 'Сума за плащане, EUR',
};

export const ELECTRICITY_METER_HEADER_LABELS_BG: Record<
  (typeof ELECTRICITY_METER_HEADERS)[number],
  string
> = {
  apartment_number: 'Апартамент',
  section_code: 'Секция',
  block_code: 'Блок',
  meter_number: 'Номер на електромер',
  initial_day_reading: 'Начално (ден)',
  initial_night_reading: 'Начално (нощ)',
  installed_at: 'Дата на монтаж',
  opening_balance_kind: 'Тип начален остатък',
  opening_balance_eur: 'Сума за плащане, EUR',
};

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

/** Map UI-localized balance kinds to canonical tokens. */
export function normalizeOpeningBalanceKind(raw: string | undefined | null): string {
  const kind = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!kind) return 'zero';
  if (['zero', '0', 'ноль', 'нула', 'none', 'empty'].includes(kind)) return 'zero';
  if (['debt', 'долг', 'дълг', 'due'].includes(kind)) return 'debt';
  if (
    ['overpayment', 'переплата', 'преплата', 'credit', 'overpay', 'кредит'].includes(kind)
  ) {
    return 'overpayment';
  }
  return kind;
}

/** Raw money cell text (keeps lone "-"). */
export function rawMeterOpeningAmountCell(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return String(raw).trim();
}

/**
 * Parse signed opening amount (Excel number or text with comma/dot).
 * Blank → null (unknown). Lone hyphen → hyphen error. Invalid → invalid.
 */
export function parseMeterOpeningAmount(
  raw: unknown,
): { ok: true; value: number | null } | { ok: false; reason: 'hyphen' | 'invalid' } {
  const text = rawMeterOpeningAmountCell(raw);
  if (!text) return { ok: true, value: null };
  if (text === '-' || text === '−' || text === '–') return { ok: false, reason: 'hyphen' };
  const normalized = text.replace(/\s/g, '').replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return { ok: false, reason: 'invalid' };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export function meterKindFromSignedAmount(amount: number): OpeningBalanceKind {
  if (amount < -0.0001) return 'overpayment';
  if (amount > 0.0001) return 'debt';
  return 'zero';
}

/**
 * Resolve opening balance from legacy kind column and/or signed amount.
 * Empty kind + empty amount → no claim (null). Explicit 0 → zero claim.
 */
export function resolveMeterOpeningBalance(row: Record<string, string>): {
  kind: OpeningBalanceKind | null;
  amountAbs: number;
  errors: string[];
} {
  const kindRaw = String(row.opening_balance_kind ?? '').trim();
  const amountParsed = parseMeterOpeningAmount(row.opening_balance_eur);
  if (!amountParsed.ok) {
    return {
      kind: null,
      amountAbs: 0,
      errors: [
        amountParsed.reason === 'hyphen'
          ? 'invalid:opening_balance_eur_hyphen'
          : 'invalid:opening_balance_eur',
      ],
    };
  }

  if (kindRaw) {
    const kind = normalizeOpeningBalanceKind(kindRaw);
    if (!(OPENING_BALANCE_KINDS as readonly string[]).includes(kind)) {
      return { kind: null, amountAbs: 0, errors: ['invalid:opening_balance_kind'] };
    }
    if (kind === 'zero') {
      if (amountParsed.value != null && amountParsed.value < 0) {
        return { kind: null, amountAbs: 0, errors: ['invalid:opening_balance_eur'] };
      }
      return { kind: 'zero', amountAbs: 0, errors: [] };
    }
    const amount = amountParsed.value;
    if (amount == null || amount <= 0) {
      return { kind: null, amountAbs: 0, errors: ['required:opening_balance_eur'] };
    }
    return { kind: kind as OpeningBalanceKind, amountAbs: amount, errors: [] };
  }

  // Signed-amount mode (no kind column).
  if (amountParsed.value == null) {
    return { kind: null, amountAbs: 0, errors: [] };
  }
  const kind = meterKindFromSignedAmount(amountParsed.value);
  return { kind, amountAbs: Math.abs(amountParsed.value), errors: [] };
}

/** Validate and normalize opening balance fields in-place for preview/RPC. */
export function validateOpeningBalanceFields(row: Record<string, string>): string[] {
  const resolved = resolveMeterOpeningBalance(row);
  if (resolved.errors.length) return resolved.errors;
  if (resolved.kind == null) {
    row.opening_balance_kind = '';
    row.opening_balance_eur = '';
    return [];
  }
  row.opening_balance_kind = resolved.kind;
  row.opening_balance_eur =
    resolved.kind === 'zero' ? '0' : String(resolved.amountAbs);
  return [];
}

/**
 * Opening balance is once per apartment. Empty amount = no claim (extra meters OK).
 * Any second non-empty claim (including zero) is rejected before write.
 */
export function collectApartmentOpeningBalanceConflicts(
  rows: Record<string, string>[],
): Map<number, string> {
  const claims = new Map<string, number>();
  const conflicts = new Map<number, string>();

  rows.forEach((row, idx) => {
    const scope = apartmentScopeKeyFromRow(row);
    if (!scope) return;
    const resolved = resolveMeterOpeningBalance(row);
    if (resolved.errors.length || resolved.kind == null) return;

    const prev = claims.get(scope);
    if (prev == null) {
      claims.set(scope, idx);
      return;
    }
    conflicts.set(idx, 'opening_balance_conflict_same_apartment');
  });

  return conflicts;
}

/** Soft opening: missing meter/readings → warnings (defer), not hard errors. */
export function validateWaterMeterRow(row: Record<string, string>): string[] {
  const errors: string[] = [];
  if (!row.apartment_number?.trim()) errors.push('required:apartment_number');
  const fmt = sectionBlockFormatError(row.section_code, row.block_code);
  if (fmt === 'section_block_fields_swapped') errors.push('section_block_fields_swapped');
  const hasMeter = Boolean(row.meter_number?.trim());
  const readingRaw = String(row.initial_reading ?? '').trim();
  const reading = readingRaw === '' ? null : parseNonNegNumber(row.initial_reading);
  if (readingRaw && reading == null) errors.push('invalid:initial_reading');
  const installedRaw = String(row.installed_at ?? '').trim();
  if (installedRaw) {
    const date = parseInstalledAtDate(row.installed_at);
    if (!date.ok) errors.push(date.error);
  } else if (hasMeter && reading != null) {
    errors.push('required:installed_at');
  }
  errors.push(...validateOpeningBalanceFields(row));
  if (Object.prototype.hasOwnProperty.call(row, 'property_id') && String(row.property_id ?? '').trim()) {
    errors.push('untrusted_property_id');
  }
  return errors;
}

export function waterMeterRowWarnings(row: Record<string, string>): string[] {
  const warnings: string[] = [];
  const hasMeter = Boolean(row.meter_number?.trim());
  const readingRaw = String(row.initial_reading ?? '').trim();
  const reading = readingRaw === '' ? null : parseNonNegNumber(row.initial_reading);
  if (!hasMeter || reading == null) warnings.push('needs_initial_readings');
  return warnings;
}

export function validateElectricityMeterRow(row: Record<string, string>): string[] {
  const errors: string[] = [];
  if (!row.apartment_number?.trim()) errors.push('required:apartment_number');
  const fmt = sectionBlockFormatError(row.section_code, row.block_code);
  if (fmt === 'section_block_fields_swapped') errors.push('section_block_fields_swapped');
  const hasMeter = Boolean(row.meter_number?.trim());
  const dayRaw = String(row.initial_day_reading ?? '').trim();
  const nightRaw = String(row.initial_night_reading ?? '').trim();
  const day = dayRaw === '' ? null : parseNonNegNumber(row.initial_day_reading);
  const night = nightRaw === '' ? null : parseNonNegNumber(row.initial_night_reading);
  if (dayRaw && day == null) errors.push('invalid:initial_day_reading');
  if (nightRaw && night == null) errors.push('invalid:initial_night_reading');
  const installedRaw = String(row.installed_at ?? '').trim();
  if (installedRaw) {
    const date = parseInstalledAtDate(row.installed_at);
    if (!date.ok) errors.push(date.error);
  } else if (hasMeter && day != null && night != null) {
    errors.push('required:installed_at');
  }
  errors.push(...validateOpeningBalanceFields(row));
  if (Object.prototype.hasOwnProperty.call(row, 'property_id') && String(row.property_id ?? '').trim()) {
    errors.push('untrusted_property_id');
  }
  return errors;
}

export function electricityMeterRowWarnings(row: Record<string, string>): string[] {
  const warnings: string[] = [];
  const hasMeter = Boolean(row.meter_number?.trim());
  const dayRaw = String(row.initial_day_reading ?? '').trim();
  const nightRaw = String(row.initial_night_reading ?? '').trim();
  const day = dayRaw === '' ? null : parseNonNegNumber(row.initial_day_reading);
  const night = nightRaw === '' ? null : parseNonNegNumber(row.initial_night_reading);
  if (!hasMeter || day == null || night == null) warnings.push('needs_initial_readings');
  return warnings;
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
  /** Apt-only Map (unique numbers) or identity bundle when entrances share numbers. */
  apartmentsByNumber: Map<string, number> | ApartmentLookupBundle;
  /** normSerial of ACTIVE meters (retired_at is null). */
  existingActiveSerials: Set<string>;
  /** normSerial → propertyId for ALL meters (active+retired) — serial is globally unique. */
  existingMetersBySerial: Map<string, number>;
  policy?: MeterOpeningPolicy;
};

function bump(
  counters: {
    createCount: number;
    updateCount: number;
    skipCount: number;
    errorCount: number;
    deferCount: number;
  },
  op: ImportRowOperation,
) {
  if (op === 'create') counters.createCount += 1;
  else if (op === 'update') counters.updateCount += 1;
  else if (op === 'skip') counters.skipCount += 1;
  else if (op === 'defer') counters.deferCount += 1;
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
  softWarnings: (row: Record<string, string>) => string[],
): ImportPreviewResult {
  const policy = ctx.policy ?? DEFAULT_METER_OPENING_POLICY;
  const counters = { createCount: 0, updateCount: 0, skipCount: 0, errorCount: 0, deferCount: 0 };
  const previewRows: ImportPreviewRow[] = [];
  const serialsInFile = new Map<string, number>();
  const balanceConflicts = collectApartmentOpeningBalanceConflicts(rows);

  rows.forEach((raw, idx) => {
    const rowNumber = idx + 2;
    // Fully blank identity+utility rows are skipped by parsers upstream; keep defensive no-op.
    const errors = validate(raw);
    const warnings = softWarnings(raw);
    const apt = normApt(raw.apartment_number);
    const serial = normSerial(raw.meter_number);
    const resolved = apt ? resolveApartmentPropertyId(ctx.apartmentsByNumber, raw) : {};
    const propertyId = resolved.propertyId;
    const balanceConflict = balanceConflicts.get(idx);
    if (balanceConflict) errors.push(balanceConflict);

    if (resolved.error) errors.push(resolved.error);
    else if (apt && propertyId == null) errors.push('unknown_apartment');
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
      if (serialOwner != null || (serial && ctx.existingActiveSerials.has(serial))) {
        operation = policy.allowReplace ? 'update' : 'skip';
      } else if (warnings.includes('needs_initial_readings')) {
        operation = 'defer';
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
      warnings: warnings.length ? warnings : undefined,
      matchKey: serial || apt || undefined,
    });
  });

  return {
    schemaVersion: METERS_SETUP_SCHEMA_VERSION,
    rows: previewRows,
    warningCount: counters.deferCount,
    ...counters,
  };
}

export function classifyWaterMeterOpeningRows(
  rows: Record<string, string>[],
  ctx: MeterClassifyContext,
): ImportPreviewResult {
  return classifyMeterOpeningRows('water', rows, ctx, validateWaterMeterRow, waterMeterRowWarnings);
}

export function classifyElectricityMeterOpeningRows(
  rows: Record<string, string>[],
  ctx: MeterClassifyContext,
): ImportPreviewResult {
  return classifyMeterOpeningRows(
    'electricity',
    rows,
    ctx,
    validateElectricityMeterRow,
    electricityMeterRowWarnings,
  );
}

/**
 * Apt-only lookup for unique apartment numbers (legacy tests / simple complexes).
 * Prefer {@link buildApartmentIdentityLookup} when section/block may repeat numbers —
 * that preserves ambiguous-number detection for clear row errors.
 */
export function buildApartmentLookup(
  apartments: Iterable<{
    property_id: number;
    apartment_number: string | number;
    section_code?: string | null;
    block_code?: string | null;
  }>,
): Map<string, number> | ApartmentLookupBundle {
  const rows = [...apartments] as ApartmentLookupRow[];
  const hasSectionOrBlock = rows.some(
    (a) => String(a.section_code ?? '').trim() || String(a.block_code ?? '').trim(),
  );
  if (hasSectionOrBlock) {
    return buildApartmentIdentityLookup(rows);
  }
  const map = new Map<string, number>();
  for (const a of rows) {
    const key = normApt(String(a.apartment_number));
    if (key) map.set(key, a.property_id);
  }
  return map;
}

export { buildApartmentIdentityLookup, resolveApartmentPropertyId };

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

export function buildWaterMeterIs3TemplateBuffer(
  locale: ImportTemplateLocale | string = 'ru',
  identityRows?: WaterMeterIdentitySeed[],
): ArrayBuffer {
  if (identityRows?.length) {
    const sorted = sortPropertyBookOwnerIdentitySeeds(identityRows);
    return buildWaterMeterTemplateFromSpec(locale, sorted);
  }
  return buildWaterMeterTemplateFromSpec(locale);
}

export type { WaterMeterIdentitySeed };

export function buildElectricityMeterIs3TemplateBuffer(
  locale: ImportTemplateLocale | string = 'ru',
  identityRows?: ElectricityMeterIdentitySeed[],
): ArrayBuffer {
  if (identityRows?.length) {
    const sorted = sortPropertyBookOwnerIdentitySeeds(identityRows);
    return buildElectricityMeterTemplateFromSpec(locale, sorted);
  }
  return buildElectricityMeterTemplateFromSpec(locale);
}

export type { ElectricityMeterIdentitySeed };

function downloadBuf(buf: ArrayBuffer, fileName: string) {
  downloadImportTemplateBuffer(buf, fileName);
}

export function downloadWaterMeterIs3Template(
  localeOrFileName?: ImportTemplateLocale | string,
  fileName?: string,
) {
  const locale = toImportTemplateLocale(
    typeof localeOrFileName === 'string' && localeOrFileName.endsWith('.xlsx') ? 'ru' : localeOrFileName,
  );
  const name =
    fileName ??
    (typeof localeOrFileName === 'string' && localeOrFileName.endsWith('.xlsx')
      ? localeOrFileName
      : localizedTemplateFileName(WATER_METERS_IMPORT_SPEC, locale));
  downloadBuf(buildWaterMeterIs3TemplateBuffer(locale), name);
}

export function downloadElectricityMeterIs3Template(
  localeOrFileName?: ImportTemplateLocale | string,
  fileName?: string,
) {
  const locale = toImportTemplateLocale(
    typeof localeOrFileName === 'string' && localeOrFileName.endsWith('.xlsx') ? 'ru' : localeOrFileName,
  );
  const name =
    fileName ??
    (typeof localeOrFileName === 'string' && localeOrFileName.endsWith('.xlsx')
      ? localeOrFileName
      : localizedTemplateFileName(ELECTRICITY_METERS_IMPORT_SPEC, locale));
  downloadBuf(buildElectricityMeterIs3TemplateBuffer(locale), name);
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
