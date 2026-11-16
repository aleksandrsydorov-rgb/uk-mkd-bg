/**
 * Phase IS-5 — Internet opening inventarisation helpers.
 * Commit via import_internet_opening_state only — never request_internet_connect / payments.
 */

import * as XLSX from 'xlsx';
import type { ImportPreviewResult, ImportPreviewRow, ImportRowOperation } from '@/lib/moduleCore/types';
import { sanitizeSpreadsheetCell } from '@/lib/moduleCore/xlsxEngine';
import {
  INTERNET_IMPORT_SPEC,
  buildLocalizedImportWorkbook,
  downloadImportTemplateBuffer,
  localizedTemplateFileName,
  toImportTemplateLocale,
  type ImportTemplateLocale,
} from '@/lib/importTemplates';
import {
  apartmentScopeKeyFromRow,
  resolveApartmentPropertyId,
  type ApartmentLookupBundle,
} from '@/lib/propertyBookIdentity';

export const INTERNET_MODULE_KEY = 'internet';
export const INTERNET_SETUP_SCHEMA_VERSION = '1.1';
export const INTERNET_TARIFF_KEY = 'internet';
export const INTERNET_OPENING_STATUSES = ['active', 'inactive'] as const;

/** User-facing first-run template columns (v1.1). Legacy aliases still accepted when parsing. */
export const INTERNET_OPENING_HEADERS = [
  'apartment_number',
  'section_code',
  'block_code',
  'connection_state',
  'connection_date',
  'paid_period_start',
  'paid_period_end',
  'opening_debt',
  'opening_credit',
  'comment',
] as const;

/** Legacy IS-5 headers kept for older workbooks / Initial Setup. */
export const INTERNET_OPENING_HEADERS_LEGACY = [
  'apartment_number',
  'section_code',
  'tariff_code',
  'status',
  'connection_date',
  'transition_date',
  'paid_through',
  'opening_debt',
  'opening_credit',
  'source_reference',
  'notes',
] as const;

export type ExistingInternetSubRef = {
  propertyId: number;
  status: string;
  billingDay: number | null;
  nextChargeOn: string | null;
  paidThrough: string | null;
  openingImport: boolean;
  openingDebt: number;
  openingCredit: number;
  periodStart: string | null;
};

export type InternetOpeningClassifyContext = {
  apartmentsByNumber: Map<string, number> | ApartmentLookupBundle;
  existingByProperty: Map<number, ExistingInternetSubRef>;
  openingImportsByProperty: Map<
    number,
    {
      status: string;
      paidThrough: string | null;
      nextChargeOn: string | null;
      debt: number;
      credit: number;
    }
  >;
  /** Properties with unfinished internet work orders */
  pendingWoPropertyIds: Set<number>;
  /** Published internet tariff present for transition window */
  internetTariffConfigured: boolean;
  /** YYYY-MM-DD Sofia/local today for cron safety checks */
  sofiaTodayIso: string;
};

function normApt(value: string | undefined | null): string {
  return String(value ?? '').trim().toLowerCase();
}

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function parseNonNegMoney(raw: string | undefined): number | null {
  const t = String(raw ?? '')
    .trim()
    .replace(',', '.');
  if (!t) return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return roundMoney(n);
}

/** YYYY-MM-DD; optional empty → null. */
export function parseOptionalIsoDate(
  raw: string | undefined,
): { ok: true; iso: string | null } | { ok: false; error: string } {
  const t = String(raw ?? '').trim();
  if (!t) return { ok: true, iso: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return { ok: false, error: 'invalid:date' };
  const d = new Date(`${t}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return { ok: false, error: 'invalid:date' };
  return { ok: true, iso: t };
}

export function parseRequiredIsoDate(
  raw: string | undefined,
  requiredKey: string,
): { ok: true; iso: string } | { ok: false; error: string } {
  const t = String(raw ?? '').trim();
  if (!t) return { ok: false, error: `required:${requiredKey}` };
  const p = parseOptionalIsoDate(t);
  if (!p.ok) return { ok: false, error: `invalid:${requiredKey}` };
  if (p.iso == null) return { ok: false, error: `required:${requiredKey}` };
  return { ok: true, iso: p.iso };
}

/** Mirror SQL internet_billing_day_from_date */
export function internetBillingDayFromDate(iso: string): number {
  const day = Number(iso.slice(8, 10));
  return Math.min(28, Math.max(1, day));
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function makeDate(year: number, month1: number, day: number): string {
  const dim = daysInMonth(year, month1);
  const d = Math.min(day, dim);
  return `${String(year).padStart(4, '0')}-${String(month1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Mirror SQL internet_add_one_month */
export function internetAddOneMonth(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const day = Math.min(28, Number(iso.slice(8, 10)));
  let ny = y;
  let nm = m + 1;
  if (nm > 12) {
    nm = 1;
    ny += 1;
  }
  return makeDate(ny, nm, day);
}

/** Mirror SQL internet_next_charge_on(p_from, billing_day) */
export function internetNextChargeOn(fromIso: string, billingDay: number): string {
  const y = Number(fromIso.slice(0, 4));
  const m = Number(fromIso.slice(5, 7));
  const vDay = Math.min(28, Math.max(1, billingDay));
  const candidate = makeDate(y, m, vDay);
  if (candidate <= fromIso) return internetAddOneMonth(candidate);
  return candidate;
}

/**
 * Paid-through → first unpaid charge date; must be strictly after sofiaToday
 * to prevent immediate cron charge (Q2).
 */
export function nextChargeAfterPaidThrough(args: {
  paidThrough: string;
  billingDay: number;
  sofiaTodayIso: string;
}): { ok: true; nextChargeOn: string } | { ok: false; error: string } {
  const next = internetNextChargeOn(args.paidThrough, args.billingDay);
  if (next <= args.sofiaTodayIso) {
    return {
      ok: false,
      error: 'blocked:next_charge_on_not_after_today',
    };
  }
  return { ok: true, nextChargeOn: next };
}

export function internetOpeningBalanceEffect(debt: number, credit: number): number {
  return roundMoney(debt - credit);
}

/** Map user-facing connection labels to canonical active|inactive. Suspended is not in the model. */
export function normalizeInternetConnectionState(raw: string | undefined | null): string | null {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (!v) return null;
  if (
    v === 'active' ||
    v === 'connected' ||
    v === 'подключен' ||
    v === 'подключён' ||
    v === 'включен' ||
    v === 'активен'
  ) {
    return 'active';
  }
  if (
    v === 'inactive' ||
    v === 'disconnected' ||
    v === 'not connected' ||
    v === 'отключен' ||
    v === 'отключён' ||
    v === 'изключен' ||
    v === 'неактивен' ||
    v === 'не подключен' ||
    v === 'не подключён' ||
    v === 'не е свързан' ||
    v === 'несвързан'
  ) {
    return 'inactive';
  }
  return null;
}

/**
 * Normalize a spreadsheet row to a canonical opening shape.
 * Accepts v1.1 columns and legacy IS-5 aliases.
 */
export function normalizeInternetOpeningRow(row: Record<string, string>): Record<string, string> {
  const rawState = String(row.connection_state ?? row.status ?? '').trim();
  const canonical = normalizeInternetConnectionState(rawState);
  const status = canonical ?? (rawState ? rawState.toLowerCase() : '');
  const paidEnd = String(row.paid_period_end ?? row.paid_through ?? '').trim();
  const paidStart = String(row.paid_period_start ?? '').trim();
  const credit = String(row.opening_credit ?? row.opening_overpayment ?? '').trim();
  const comment = String(row.comment ?? row.notes ?? '').trim();
  const tariff = String(row.tariff_code ?? '').trim().toLowerCase() || INTERNET_TARIFF_KEY;
  return {
    ...row,
    apartment_number: String(row.apartment_number ?? '').trim(),
    connection_state: status,
    status,
    tariff_code: tariff,
    connection_date: String(row.connection_date ?? '').trim(),
    transition_date: String(row.transition_date ?? '').trim(),
    paid_period_start: paidStart,
    paid_period_end: paidEnd,
    paid_through: paidEnd,
    opening_debt: String(row.opening_debt ?? '').trim(),
    opening_credit: credit,
    comment,
    notes: comment,
    source_reference: String(row.source_reference ?? '').trim(),
  };
}

export function validateInternetOpeningRow(row: Record<string, string>): string[] {
  const errors: string[] = [];
  const n = normalizeInternetOpeningRow(row);
  if (!n.apartment_number) errors.push('required:apartment_number');

  const tariff = n.tariff_code.toLowerCase();
  if (tariff && tariff !== INTERNET_TARIFF_KEY) errors.push('unsupported:tariff_code');

  const rawState = String(row.connection_state ?? row.status ?? '').trim();
  const status = n.status;
  if (rawState && !INTERNET_OPENING_STATUSES.includes(status as (typeof INTERNET_OPENING_STATUSES)[number])) {
    errors.push('unsupported:connection_state');
  }

  const tdRaw = n.transition_date;
  if (tdRaw) {
    const td = parseOptionalIsoDate(tdRaw);
    if (!td.ok) errors.push('invalid:transition_date');
    else if (td.iso) {
      const todayIso = new Date().toISOString().slice(0, 10);
      if (td.iso > todayIso) errors.push('invalid:transition_date_future');
    }
  }

  const conn = parseOptionalIsoDate(n.connection_date);
  if (!conn.ok) errors.push('invalid:connection_date');

  const paidStart = parseOptionalIsoDate(n.paid_period_start);
  const paidEnd = parseOptionalIsoDate(n.paid_period_end);
  if (!paidStart.ok) errors.push('invalid:paid_period_start');
  if (!paidEnd.ok) errors.push('invalid:paid_period_end');
  if (paidStart.ok && paidStart.iso && paidEnd.ok && !paidEnd.iso) {
    errors.push('required:paid_period_end');
  }
  if (paidStart.ok && paidStart.iso && paidEnd.ok && paidEnd.iso && paidStart.iso > paidEnd.iso) {
    errors.push('invalid:paid_period_order');
  }
  if (
    conn.ok &&
    conn.iso &&
    paidEnd.ok &&
    paidEnd.iso &&
    paidEnd.iso < conn.iso
  ) {
    errors.push('invalid:paid_through_before_connection');
  }

  const debt = parseNonNegMoney(n.opening_debt);
  const credit = parseNonNegMoney(n.opening_credit);
  if (debt == null) errors.push('invalid:opening_debt');
  if (credit == null) errors.push('invalid:opening_credit');
  // Debt and overpayment may both be present: separate opening_debit / opening_credit (no netting).

  if (Object.prototype.hasOwnProperty.call(row, 'property_id') && String(row.property_id ?? '').trim()) {
    errors.push('untrusted_property_id');
  }
  if (Object.prototype.hasOwnProperty.call(row, 'tariff_version_id') && String(row.tariff_version_id ?? '').trim()) {
    errors.push('untrusted_tariff_version_id');
  }

  return errors;
}

/** Soft opening: missing connection state → warning (defer), not a hard error. */
export function internetOpeningRowWarnings(row: Record<string, string>): string[] {
  const warnings: string[] = [];
  const rawState = String(row.connection_state ?? row.status ?? '').trim();
  if (!rawState) warnings.push('needs_initial_internet_state');
  return warnings;
}

function bump(
  counters: {
    createCount: number;
    updateCount: number;
    skipCount: number;
    errorCount: number;
    conflictCount: number;
    deferCount: number;
  },
  op: ImportRowOperation | 'conflict',
) {
  if (op === 'create') counters.createCount += 1;
  else if (op === 'update') counters.updateCount += 1;
  else if (op === 'skip') counters.skipCount += 1;
  else if (op === 'defer') counters.deferCount += 1;
  else if (op === 'conflict') counters.conflictCount += 1;
  else counters.errorCount += 1;
}

export function classifyInternetOpeningRows(
  rows: Record<string, string>[],
  ctx: InternetOpeningClassifyContext,
): ImportPreviewResult & { conflictCount: number } {
  const counters = {
    createCount: 0,
    updateCount: 0,
    skipCount: 0,
    errorCount: 0,
    conflictCount: 0,
    deferCount: 0,
  };
  const previewRows: ImportPreviewRow[] = [];
  /** First row per apartment carries subscription fields; later rows may add paid periods. */
  const aptPrimary = new Map<string, { rowNumber: number; status: string; debt: number; credit: number }>();

  rows.forEach((rawIn, idx) => {
    const raw = normalizeInternetOpeningRow(rawIn);
    const rowNumber = idx + 2;
    const errors = validateInternetOpeningRow(rawIn);
    const warnings = internetOpeningRowWarnings(rawIn);
    const apt = normApt(raw.apartment_number);
    const resolved = apt ? resolveApartmentPropertyId(ctx.apartmentsByNumber, raw) : {};
    const propertyId = resolved.propertyId;
    const status = String(raw.status ?? '')
      .trim()
      .toLowerCase();
    const debt = parseNonNegMoney(raw.opening_debt) ?? 0;
    const credit = parseNonNegMoney(raw.opening_credit) ?? 0;
    const td = raw.transition_date
      ? parseOptionalIsoDate(raw.transition_date)
      : ({ ok: true, iso: ctx.sofiaTodayIso } as const);
    const conn = parseOptionalIsoDate(raw.connection_date);
    const paid = parseOptionalIsoDate(raw.paid_through);
    const paidStart = parseOptionalIsoDate(raw.paid_period_start);
    const aptScope = apartmentScopeKeyFromRow(raw);

    if (resolved.error) errors.push(resolved.error);
    else if (apt && propertyId == null) errors.push('unknown_apartment');
    if (aptScope) {
      const prior = aptPrimary.get(aptScope);
      if (!prior) {
        aptPrimary.set(aptScope, { rowNumber, status, debt, credit });
      } else if (
        (status && prior.status && status !== prior.status) ||
        debt !== prior.debt ||
        credit !== prior.credit
      ) {
        errors.push('conflict:same_apartment_rows');
      }
    }

    if (!ctx.internetTariffConfigured) errors.push('tariff_not_configured');

    let nextChargeOn = '';
    let billingDay: number | null = null;
    if (errors.length === 0 && td.ok && propertyId != null) {
      const connIso = conn.ok && conn.iso ? conn.iso : null;
      if (connIso) billingDay = internetBillingDayFromDate(connIso);
      else if (paid.ok && paid.iso) billingDay = internetBillingDayFromDate(paid.iso);
      if (status === 'active' && paid.ok && paid.iso && billingDay != null) {
        if (connIso && paid.iso < connIso) errors.push('invalid:paid_through_before_connection');
        else {
          const n = nextChargeAfterPaidThrough({
            paidThrough: paid.iso,
            billingDay,
            sofiaTodayIso: ctx.sofiaTodayIso,
          });
          // Expired paid-through is a warning path on server (next_charge null), not a hard client block.
          if (n.ok) nextChargeOn = n.nextChargeOn;
        }
      }
    }
    void paidStart;

    if (propertyId != null && ctx.pendingWoPropertyIds.has(propertyId)) {
      errors.push('blocked:pending_internet_work_order');
    }

    let operation: ImportRowOperation = 'error';
    let previewClass = 'ERROR';

    if (errors.length === 0 && propertyId != null) {
      const priorOpening = ctx.openingImportsByProperty.get(propertyId);
      const existing = ctx.existingByProperty.get(propertyId);

      if (priorOpening) {
        const same =
          priorOpening.status === status &&
          (priorOpening.paidThrough ?? '') === (paid.ok && paid.iso ? paid.iso : '') &&
          (priorOpening.nextChargeOn ?? '') === nextChargeOn &&
          priorOpening.debt === debt &&
          priorOpening.credit === credit;
        if (same) {
          operation = 'skip';
          previewClass = 'SKIP';
        } else {
          operation = 'error';
          previewClass = 'CONFLICT';
          errors.push('conflict:existing_opening_import_mismatch');
        }
      } else if (existing) {
        // Q4: identical operational+opening snapshot → SKIP only when opening_import and amounts match
        if (
          existing.openingImport &&
          existing.status === status &&
          (existing.paidThrough ?? '') === (paid.ok && paid.iso ? paid.iso : '') &&
          (existing.nextChargeOn ?? '') === nextChargeOn &&
          existing.openingDebt === debt &&
          existing.openingCredit === credit
        ) {
          operation = 'skip';
          previewClass = 'SKIP';
        } else {
          operation = 'error';
          previewClass = 'CONFLICT';
          errors.push('conflict:existing_subscription');
        }
      } else if (warnings.includes('needs_initial_internet_state')) {
        operation = 'defer';
        previewClass = 'DEFER';
      } else {
        operation = 'create';
        previewClass = 'CREATE';
      }
    }

    if (errors.length && previewClass !== 'CONFLICT' && operation !== 'skip') {
      operation = 'error';
      previewClass = 'ERROR';
    }

    if (previewClass === 'CONFLICT') bump(counters, 'conflict');
    else bump(counters, operation);

    previewRows.push({
      rowNumber,
      operation,
      data: {
        ...raw,
        tariff_code: INTERNET_TARIFF_KEY,
        status,
        opening_debt: String(debt),
        opening_credit: String(credit),
        resolved_property_id: propertyId != null ? String(propertyId) : '',
        preview_class: previewClass,
        transition_date: td.ok && td.iso ? td.iso : String(raw.transition_date ?? ''),
        connection_date: conn.ok && conn.iso ? conn.iso : String(raw.connection_date ?? ''),
        paid_period_start: paidStart.ok && paidStart.iso ? paidStart.iso : String(raw.paid_period_start ?? ''),
        paid_period_end: paid.ok && paid.iso ? paid.iso : String(raw.paid_period_end ?? ''),
        paid_through: paid.ok && paid.iso ? paid.iso : String(raw.paid_through ?? ''),
        next_charge_on: nextChargeOn,
        billing_day: billingDay != null ? String(billingDay) : '',
        balance_effect: String(internetOpeningBalanceEffect(debt, credit)),
        no_synthetic_payments: 'true',
        no_connect_workflow: 'true',
        no_work_orders: 'true',
      },
      errors,
      warnings: warnings.length ? warnings : undefined,
      matchKey: apt || undefined,
    });
  });

  return {
    schemaVersion: INTERNET_SETUP_SCHEMA_VERSION,
    rows: previewRows,
    createCount: counters.createCount,
    updateCount: counters.updateCount,
    skipCount: counters.skipCount,
    errorCount: counters.errorCount + counters.conflictCount,
    warningCount: counters.deferCount,
    conflictCount: counters.conflictCount,
  };
}

export function buildExistingInternetSubMap(
  rows: Iterable<{
    property_id: number;
    status: string;
    billing_day?: number | null;
    next_charge_on?: string | null;
    period_start?: string | null;
    opening_import?: boolean | null;
    opening_paid_through?: string | null;
    opening_debt?: number | null;
    opening_credit?: number | null;
  }>,
): Map<number, ExistingInternetSubRef> {
  const map = new Map<number, ExistingInternetSubRef>();
  for (const r of rows) {
    map.set(r.property_id, {
      propertyId: r.property_id,
      status: String(r.status ?? '').toLowerCase(),
      billingDay: r.billing_day == null ? null : Number(r.billing_day),
      nextChargeOn: r.next_charge_on ?? null,
      paidThrough: r.opening_paid_through ?? null,
      openingImport: Boolean(r.opening_import),
      openingDebt: Number(r.opening_debt ?? 0),
      openingCredit: Number(r.opening_credit ?? 0),
      periodStart: r.period_start ?? null,
    });
  }
  return map;
}

export type InternetOpeningRpcPayload = {
  propertyId: number;
  status: string;
  tariffKey: string;
  connectionDate: string | null;
  transitionDate: string;
  paidThrough: string | null;
  openingDebt: number;
  openingCredit: number;
  sourceReference: string;
  notes: string;
  rowNumber: number;
  apartmentNumber: string;
  nextChargeOn: string | null;
};

export function internetOpeningPayloadsFromPreview(
  preview: ImportPreviewResult,
): InternetOpeningRpcPayload[] {
  const out: InternetOpeningRpcPayload[] = [];
  for (const row of preview.rows) {
    if (row.operation !== 'create') continue;
    const propertyId = Number(row.data.resolved_property_id);
    if (!Number.isFinite(propertyId) || propertyId <= 0) continue;
    out.push({
      propertyId,
      status: String(row.data.status ?? '').toLowerCase(),
      tariffKey: INTERNET_TARIFF_KEY,
      connectionDate: String(row.data.connection_date ?? '').trim() || null,
      transitionDate: String(row.data.transition_date ?? ''),
      paidThrough: String(row.data.paid_through ?? '').trim() || null,
      openingDebt: Number(row.data.opening_debt ?? 0),
      openingCredit: Number(row.data.opening_credit ?? 0),
      sourceReference: String(row.data.source_reference ?? ''),
      notes: String(row.data.notes ?? ''),
      rowNumber: row.rowNumber,
      apartmentNumber: String(row.data.apartment_number ?? '').trim(),
      nextChargeOn: String(row.data.next_charge_on ?? '').trim() || null,
    });
  }
  return out;
}

export function buildInternetIs5TemplateBuffer(
  locale: ImportTemplateLocale | string = 'ru',
): ArrayBuffer {
  return buildLocalizedImportWorkbook(INTERNET_IMPORT_SPEC, toImportTemplateLocale(locale));
}

export function downloadInternetIs5Template(
  localeOrFileName?: ImportTemplateLocale | string,
  fileName?: string,
): void {
  const isFileName = typeof localeOrFileName === 'string' && localeOrFileName.endsWith('.xlsx');
  const locale = toImportTemplateLocale(isFileName ? 'ru' : localeOrFileName);
  const name =
    fileName ??
    (isFileName ? (localeOrFileName as string) : localizedTemplateFileName(INTERNET_IMPORT_SPEC, locale));
  downloadImportTemplateBuffer(buildInternetIs5TemplateBuffer(locale), name);
}

export function buildInternetErrorReportXlsx(preview: ImportPreviewResult): ArrayBuffer {
  const aoa: string[][] = [
    ['rowNumber', 'operation', 'preview_class', 'matchKey', 'errors', 'data'],
  ];
  for (const row of preview.rows.filter((r) => r.errors.length || r.operation === 'error')) {
    aoa.push([
      String(row.rowNumber),
      row.operation,
      sanitizeSpreadsheetCell(row.data.preview_class ?? ''),
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

export function downloadInternetErrorReport(preview: ImportPreviewResult): void {
  const buf = buildInternetErrorReportXlsx(preview);
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'internet_opening_errors.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}
