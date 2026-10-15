/**
 * Phase IS-5 — Internet opening inventarisation helpers.
 * Commit via import_internet_opening_state only — never request_internet_connect / payments.
 */

import * as XLSX from 'xlsx';
import type { ImportPreviewResult, ImportPreviewRow, ImportRowOperation } from '@/lib/moduleCore/types';
import { sanitizeSpreadsheetCell } from '@/lib/moduleCore/xlsxEngine';

export const INTERNET_MODULE_KEY = 'internet';
export const INTERNET_SETUP_SCHEMA_VERSION = '1.0';
export const INTERNET_TARIFF_KEY = 'internet';
export const INTERNET_OPENING_STATUSES = ['active', 'inactive'] as const;

export const INTERNET_OPENING_HEADERS = [
  'apartment_number',
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
  apartmentsByNumber: Map<string, number>;
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

export function validateInternetOpeningRow(row: Record<string, string>): string[] {
  const errors: string[] = [];
  if (!row.apartment_number?.trim()) errors.push('required:apartment_number');

  const tariff = String(row.tariff_code ?? '')
    .trim()
    .toLowerCase();
  if (!tariff) errors.push('required:tariff_code');
  else if (tariff !== INTERNET_TARIFF_KEY) errors.push('unsupported:tariff_code');

  const status = String(row.status ?? '')
    .trim()
    .toLowerCase();
  if (!status) errors.push('required:status');
  else if (!INTERNET_OPENING_STATUSES.includes(status as (typeof INTERNET_OPENING_STATUSES)[number])) {
    errors.push('unsupported:status');
  }

  const td = parseRequiredIsoDate(row.transition_date, 'transition_date');
  if (!td.ok) errors.push(td.error);
  else {
    const todayIso = new Date().toISOString().slice(0, 10);
    if (td.iso > todayIso) errors.push('invalid:transition_date_future');
  }

  const conn = parseOptionalIsoDate(row.connection_date);
  if (!conn.ok) errors.push('invalid:connection_date');
  else if (conn.iso && td.ok && conn.iso > td.iso) {
    errors.push('invalid:connection_date_after_transition');
  }

  const paid = parseOptionalIsoDate(row.paid_through);
  if (!paid.ok) errors.push('invalid:paid_through');

  if (status === 'active') {
    if (!paid.ok || paid.iso == null) errors.push('required:paid_through');
  }

  const debt = parseNonNegMoney(row.opening_debt);
  const credit = parseNonNegMoney(row.opening_credit);
  if (debt == null) errors.push('invalid:opening_debt');
  if (credit == null) errors.push('invalid:opening_credit');

  if (Object.prototype.hasOwnProperty.call(row, 'property_id') && String(row.property_id ?? '').trim()) {
    errors.push('untrusted_property_id');
  }
  if (Object.prototype.hasOwnProperty.call(row, 'tariff_version_id') && String(row.tariff_version_id ?? '').trim()) {
    errors.push('untrusted_tariff_version_id');
  }

  return errors;
}

function bump(
  counters: {
    createCount: number;
    updateCount: number;
    skipCount: number;
    errorCount: number;
    conflictCount: number;
  },
  op: ImportRowOperation | 'conflict',
) {
  if (op === 'create') counters.createCount += 1;
  else if (op === 'update') counters.updateCount += 1;
  else if (op === 'skip') counters.skipCount += 1;
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
  };
  const previewRows: ImportPreviewRow[] = [];
  const aptInFile = new Map<string, number>();

  rows.forEach((raw, idx) => {
    const rowNumber = idx + 2;
    const errors = validateInternetOpeningRow(raw);
    const apt = normApt(raw.apartment_number);
    const propertyId = apt ? ctx.apartmentsByNumber.get(apt) : undefined;
    const status = String(raw.status ?? '')
      .trim()
      .toLowerCase();
    const debt = parseNonNegMoney(raw.opening_debt) ?? 0;
    const credit = parseNonNegMoney(raw.opening_credit) ?? 0;
    const td = parseRequiredIsoDate(raw.transition_date, 'transition_date');
    const conn = parseOptionalIsoDate(raw.connection_date);
    const paid = parseOptionalIsoDate(raw.paid_through);

    if (apt && propertyId == null) errors.push('unknown_apartment');
    if (apt && aptInFile.has(apt)) errors.push('duplicate_in_file:apartment');
    else if (apt) aptInFile.set(apt, rowNumber);

    if (!ctx.internetTariffConfigured) errors.push('tariff_not_configured');

    let nextChargeOn = '';
    let billingDay: number | null = null;
    if (errors.length === 0 && td.ok && propertyId != null) {
      const connIso = conn.ok && conn.iso ? conn.iso : td.iso;
      billingDay = internetBillingDayFromDate(connIso);
      if (status === 'active' && paid.ok && paid.iso) {
        if (paid.iso < connIso) errors.push('invalid:paid_through_before_connection');
        else {
          const n = nextChargeAfterPaidThrough({
            paidThrough: paid.iso,
            billingDay,
            sofiaTodayIso: ctx.sofiaTodayIso,
          });
          if (!n.ok) errors.push(n.error);
          else nextChargeOn = n.nextChargeOn;
        }
      }
    }

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
        transition_date: td.ok ? td.iso : String(raw.transition_date ?? ''),
        connection_date: conn.ok && conn.iso ? conn.iso : String(raw.connection_date ?? ''),
        paid_through: paid.ok && paid.iso ? paid.iso : String(raw.paid_through ?? ''),
        next_charge_on: nextChargeOn,
        billing_day: billingDay != null ? String(billingDay) : '',
        balance_effect: String(internetOpeningBalanceEffect(debt, credit)),
        no_synthetic_payments: 'true',
        no_connect_workflow: 'true',
        no_work_orders: 'true',
      },
      errors,
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

const INSTRUCTIONS: Record<'bg' | 'ru' | 'en', string[]> = {
  bg: [
    'Интернет — начален импорт (IS-5)',
    `schema_version: ${INTERNET_SETUP_SCHEMA_VERSION}. Лист: subscriptions.`,
    'Ключ апартамент: apartment_number (от Книгата). property_id е забранен.',
    'tariff_code трябва да е internet (каноничен Tariff Core ключ).',
    'status: active | inactive. pending_* са забранени.',
    'active изисква paid_through. next_charge_on се изчислява от месечните правила.',
    'paid_through НЕ създава payment. Без request_internet_connect / work orders.',
    'Съществуващ абонамент → CONFLICT. Идентичен opening → SKIP.',
    'Незавършена internet work order → BLOCKED.',
  ],
  ru: [
    'Интернет — начальный импорт (IS-5)',
    `schema_version: ${INTERNET_SETUP_SCHEMA_VERSION}. Лист: subscriptions.`,
    'Ключ квартиры: apartment_number (из Книги). property_id запрещён.',
    'tariff_code должен быть internet (канонический ключ Tariff Core).',
    'status: active | inactive. pending_* запрещены.',
    'active требует paid_through. next_charge_on считается по месячным правилам.',
    'paid_through НЕ создаёт payment. Без request_internet_connect / work orders.',
    'Существующая подписка → CONFLICT. Идентичный opening → SKIP.',
    'Незавершённый internet work order → BLOCKED.',
  ],
  en: [
    'Internet — opening import (IS-5)',
    `schema_version: ${INTERNET_SETUP_SCHEMA_VERSION}. Sheet: subscriptions.`,
    'Apartment key: apartment_number (from Property Book). property_id forbidden.',
    'tariff_code must be internet (canonical Tariff Core key).',
    'status: active | inactive. pending_* forbidden.',
    'active requires paid_through. next_charge_on follows monthly billing rules.',
    'paid_through does NOT create payment rows. No request_internet_connect / work orders.',
    'Existing subscription → CONFLICT. Identical opening → SKIP.',
    'Unfinished internet work order → BLOCKED.',
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

export function buildInternetIs5TemplateBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const example = [
    {
      apartment_number: '101',
      tariff_code: 'internet',
      status: 'active',
      connection_date: '2025-06-01',
      transition_date: '2026-01-01',
      paid_through: '2026-10-31',
      opening_debt: '0',
      opening_credit: '0',
      source_reference: 'ISP-LEDGER-2026',
      notes: 'paid through Oct 2026 — next_charge after today',
    },
    {
      apartment_number: '102',
      tariff_code: 'internet',
      status: 'active',
      connection_date: '2024-03-15',
      transition_date: '2026-01-01',
      paid_through: '2026-11-30',
      opening_debt: '25.00',
      opening_credit: '0',
      source_reference: 'ISP-LEDGER-2026',
      notes: 'opening debt',
    },
    {
      apartment_number: '103',
      tariff_code: 'internet',
      status: 'inactive',
      connection_date: '',
      transition_date: '2026-01-01',
      paid_through: '',
      opening_debt: '0',
      opening_credit: '10.00',
      source_reference: 'ISP-LEDGER-2026',
      notes: 'inactive with opening credit',
    },
  ].map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, sanitizeSpreadsheetCell(String(v))]),
    ),
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(example, { header: [...INTERNET_OPENING_HEADERS] }),
    'subscriptions',
  );
  appendInstructionSheets(wb, INSTRUCTIONS);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export function downloadInternetIs5Template(
  fileName = 'internet_opening_template.xlsx',
): void {
  const buf = buildInternetIs5TemplateBuffer();
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
