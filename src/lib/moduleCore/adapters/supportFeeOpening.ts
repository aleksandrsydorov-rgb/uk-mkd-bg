/**
 * Phase IS-4 — Support Fee opening inventarisation helpers.
 * Commit via import_support_fee_opening_state only — never fabricate payments.
 */

import * as XLSX from 'xlsx';
import type { ImportPreviewResult, ImportPreviewRow, ImportRowOperation } from '@/lib/moduleCore/types';
import { sanitizeSpreadsheetCell } from '@/lib/moduleCore/xlsxEngine';

export const SUPPORT_FEE_MODULE_KEY = 'support_fee';
export const SUPPORT_FEE_SETUP_SCHEMA_VERSION = '1.0';
export const SUPPORT_FEE_OBLIGATION_TYPE = 'support_fee';

export const SUPPORT_FEE_OPENING_HEADERS = [
  'apartment_number',
  'billing_year',
  'obligation_type',
  'assessed_amount',
  'historically_paid_amount',
  'remaining_debt',
  'opening_overpayment',
  'transition_date',
  'source_reference',
  'notes',
] as const;

export type ExistingSfObligationRef = {
  propertyId: number;
  billingYear: number;
  openingImport: boolean;
  remainingDue: number;
  assessedAmount: number;
  historicallyPaid: number | null;
  status: string;
};

export type SfOpeningClassifyContext = {
  apartmentsByNumber: Map<string, number>;
  /** Active (non-void/corrected) assessments by property|year */
  existingByScope: Map<string, ExistingSfObligationRef>;
  /** Prior IS-4 opening imports by property|year */
  openingImportsByScope: Map<string, { assessed: number; paid: number; remaining: number; over: number }>;
  /**
   * IS-7a: published applicable support_fee tariff (Tariff Core).
   * Omit/undefined = treat as configured (legacy callers); explicit false blocks import.
   */
  supportFeeTariffConfigured?: boolean;
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
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return roundMoney(n);
}

export function parseBillingYear(raw: string | undefined): number | null {
  const t = String(raw ?? '').trim();
  if (!/^\d{4}$/.test(t)) return null;
  const y = Number(t);
  if (y < 2000 || y > 2100) return null;
  return y;
}

/** YYYY-MM-DD transition date (no future). */
export function parseTransitionDate(
  raw: string | undefined,
): { ok: true; iso: string } | { ok: false; error: string } {
  const t = String(raw ?? '').trim();
  if (!t) return { ok: false, error: 'required:transition_date' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return { ok: false, error: 'invalid:transition_date' };
  const d = new Date(`${t}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return { ok: false, error: 'invalid:transition_date' };
  const todayIso = new Date().toISOString().slice(0, 10);
  if (t > todayIso) return { ok: false, error: 'invalid:transition_date_future' };
  return { ok: true, iso: t };
}

export function scopeKey(propertyId: number, billingYear: number): string {
  return `${propertyId}|${billingYear}`;
}

export function validateSupportFeeOpeningRow(row: Record<string, string>): string[] {
  const errors: string[] = [];
  if (!row.apartment_number?.trim()) errors.push('required:apartment_number');
  const year = parseBillingYear(row.billing_year);
  if (year == null) errors.push('invalid:billing_year');
  const obl = String(row.obligation_type ?? '')
    .trim()
    .toLowerCase();
  if (!obl) errors.push('required:obligation_type');
  else if (obl !== SUPPORT_FEE_OBLIGATION_TYPE) errors.push('unsupported:obligation_type');

  const assessed = parseNonNegMoney(row.assessed_amount);
  const paid = parseNonNegMoney(row.historically_paid_amount);
  const remaining = parseNonNegMoney(row.remaining_debt);
  if (assessed == null) errors.push('invalid:assessed_amount');
  if (paid == null) errors.push('invalid:historically_paid_amount');
  if (remaining == null) errors.push('invalid:remaining_debt');
  if (assessed != null && paid != null && remaining != null) {
    if (roundMoney(assessed) !== roundMoney(paid + remaining)) {
      errors.push('inconsistent:assessed_ne_paid_plus_remaining');
    }
  }

  const overRaw = String(row.opening_overpayment ?? '').trim();
  if (overRaw) {
    const over = parseNonNegMoney(overRaw);
    if (over == null) errors.push('invalid:opening_overpayment');
  }

  const td = parseTransitionDate(row.transition_date);
  if (!td.ok) errors.push(td.error);

  if (Object.prototype.hasOwnProperty.call(row, 'property_id') && String(row.property_id ?? '').trim()) {
    errors.push('untrusted_property_id');
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

/**
 * Classify opening rows. Conflict → operation error + preview_class CONFLICT (Q5).
 * Matching prior opening import → skip (idempotent).
 */
export function classifySupportFeeOpeningRows(
  rows: Record<string, string>[],
  ctx: SfOpeningClassifyContext,
): ImportPreviewResult & { conflictCount: number } {
  const counters = {
    createCount: 0,
    updateCount: 0,
    skipCount: 0,
    errorCount: 0,
    conflictCount: 0,
  };
  const previewRows: ImportPreviewRow[] = [];
  const scopeInFile = new Map<string, number>();
  const overpayAptInFile = new Map<string, number>();

  rows.forEach((raw, idx) => {
    const rowNumber = idx + 2;
    const errors = validateSupportFeeOpeningRow(raw);
    const apt = normApt(raw.apartment_number);
    const propertyId = apt ? ctx.apartmentsByNumber.get(apt) : undefined;
    const year = parseBillingYear(raw.billing_year);
    const assessed = parseNonNegMoney(raw.assessed_amount);
    const paid = parseNonNegMoney(raw.historically_paid_amount);
    const remaining = parseNonNegMoney(raw.remaining_debt);
    const over = parseNonNegMoney(String(raw.opening_overpayment ?? '').trim() || '0') ?? 0;

    if (apt && propertyId == null) errors.push('unknown_apartment');
    if (ctx.supportFeeTariffConfigured === false) errors.push('tariff_not_configured');

    if (propertyId != null && year != null) {
      const sk = scopeKey(propertyId, year);
      if (scopeInFile.has(sk)) errors.push('duplicate_in_file:apartment_year');
      else scopeInFile.set(sk, rowNumber);
    }

    if (over > 0 && apt) {
      if (overpayAptInFile.has(apt)) errors.push('duplicate_in_file:opening_overpayment_per_apartment');
      else overpayAptInFile.set(apt, rowNumber);
    }

    let operation: ImportRowOperation = 'error';
    let previewClass = 'ERROR';

    if (errors.length === 0 && propertyId != null && year != null && assessed != null && paid != null && remaining != null) {
      const sk = scopeKey(propertyId, year);
      const existing = ctx.existingByScope.get(sk);
      const priorOpening = ctx.openingImportsByScope.get(sk);

      if (priorOpening) {
        const same =
          priorOpening.assessed === assessed &&
          priorOpening.paid === paid &&
          priorOpening.remaining === remaining &&
          priorOpening.over === over;
        if (same) {
          operation = 'skip';
          previewClass = 'SKIP';
        } else {
          operation = 'error';
          previewClass = 'CONFLICT';
          errors.push('conflict:existing_opening_import_mismatch');
        }
      } else if (existing) {
        operation = 'error';
        previewClass = 'CONFLICT';
        errors.push(
          existing.openingImport
            ? 'conflict:existing_opening_assessment'
            : 'conflict:existing_obligation',
        );
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

    const td = parseTransitionDate(raw.transition_date);
    previewRows.push({
      rowNumber,
      operation,
      data: {
        ...raw,
        obligation_type: SUPPORT_FEE_OBLIGATION_TYPE,
        opening_overpayment: String(over),
        resolved_property_id: propertyId != null ? String(propertyId) : '',
        preview_class: previewClass,
        transition_date: td.ok ? td.iso : String(raw.transition_date ?? ''),
        assessed_amount: assessed != null ? String(assessed) : String(raw.assessed_amount ?? ''),
        historically_paid_amount: paid != null ? String(paid) : String(raw.historically_paid_amount ?? ''),
        remaining_debt: remaining != null ? String(remaining) : String(raw.remaining_debt ?? ''),
        no_synthetic_payments: 'true',
        early_late_recalc: 'forbidden',
      },
      errors,
      matchKey: apt || undefined,
    });
  });

  return {
    schemaVersion: SUPPORT_FEE_SETUP_SCHEMA_VERSION,
    rows: previewRows,
    createCount: counters.createCount,
    updateCount: counters.updateCount,
    skipCount: counters.skipCount,
    errorCount: counters.errorCount + counters.conflictCount,
    conflictCount: counters.conflictCount,
  };
}

export function buildExistingSfScopeMap(
  rows: Iterable<{
    property_id: number;
    billing_year: number;
    opening_import?: boolean | null;
    remaining_due?: number | null;
    base_amount?: number | null;
    final_amount?: number | null;
    opening_historically_paid_amount?: number | null;
    status?: string | null;
  }>,
): Map<string, ExistingSfObligationRef> {
  const map = new Map<string, ExistingSfObligationRef>();
  for (const r of rows) {
    const status = (r.status ?? 'open').toLowerCase();
    if (status === 'void' || status === 'corrected') continue;
    map.set(scopeKey(r.property_id, r.billing_year), {
      propertyId: r.property_id,
      billingYear: r.billing_year,
      openingImport: Boolean(r.opening_import),
      remainingDue: Number(r.remaining_due ?? 0),
      assessedAmount: Number(r.final_amount ?? r.base_amount ?? 0),
      historicallyPaid:
        r.opening_historically_paid_amount == null
          ? null
          : Number(r.opening_historically_paid_amount),
      status,
    });
  }
  return map;
}

export type SupportFeeOpeningRpcPayload = {
  propertyId: number;
  billingYear: number;
  obligationType: string;
  assessedAmount: number;
  historicallyPaidAmount: number;
  remainingDebt: number;
  openingOverpayment: number;
  transitionDate: string;
  sourceReference: string;
  notes: string;
  rowNumber: number;
  apartmentNumber: string;
};

export function supportFeeOpeningPayloadsFromPreview(
  preview: ImportPreviewResult,
): SupportFeeOpeningRpcPayload[] {
  const out: SupportFeeOpeningRpcPayload[] = [];
  for (const row of preview.rows) {
    if (row.operation !== 'create') continue;
    const propertyId = Number(row.data.resolved_property_id);
    const billingYear = parseBillingYear(row.data.billing_year);
    const assessed = parseNonNegMoney(row.data.assessed_amount);
    const paid = parseNonNegMoney(row.data.historically_paid_amount);
    const remaining = parseNonNegMoney(row.data.remaining_debt);
    const over = parseNonNegMoney(row.data.opening_overpayment) ?? 0;
    const td = parseTransitionDate(row.data.transition_date);
    if (
      !propertyId ||
      billingYear == null ||
      assessed == null ||
      paid == null ||
      remaining == null ||
      !td.ok
    ) {
      continue;
    }
    out.push({
      propertyId,
      billingYear,
      obligationType: SUPPORT_FEE_OBLIGATION_TYPE,
      assessedAmount: assessed,
      historicallyPaidAmount: paid,
      remainingDebt: remaining,
      openingOverpayment: over,
      transitionDate: td.iso,
      sourceReference: String(row.data.source_reference ?? '').trim(),
      notes: String(row.data.notes ?? '').trim(),
      rowNumber: row.rowNumber,
      apartmentNumber: String(row.data.apartment_number ?? '').trim(),
    });
  }
  return out;
}

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

const SF_INSTRUCTIONS: Record<'bg' | 'ru' | 'en', string[]> = {
  bg: [
    'Такса поддръжка — начален импорт (IS-4)',
    `schema_version: ${SUPPORT_FEE_SETUP_SCHEMA_VERSION}. Лист: opening_balances.`,
    'Ключ апартамент: apartment_number (от Книгата). property_id е забранен.',
    'Полета: apartment_number, billing_year, obligation_type=support_fee,',
    'assessed_amount, historically_paid_amount, remaining_debt, opening_overpayment,',
    'transition_date, source_reference, notes.',
    'Правило: assessed = historically_paid + remaining_debt.',
    'historically_paid НЕ създава payment / allocation.',
    'Без early/late преизчисление. Без фиктивни плащания.',
    'Съществуващо задължение → CONFLICT (без overwrite). Повторен идентичен импорт → SKIP.',
    'opening_overpayment: най-много един ненулев ред на апартамент в файла.',
  ],
  ru: [
    'Плата за содержание — начальный импорт (IS-4)',
    `schema_version: ${SUPPORT_FEE_SETUP_SCHEMA_VERSION}. Лист: opening_balances.`,
    'Ключ квартиры: apartment_number (из Книги). property_id запрещён.',
    'Поля: apartment_number, billing_year, obligation_type=support_fee,',
    'assessed_amount, historically_paid_amount, remaining_debt, opening_overpayment,',
    'transition_date, source_reference, notes.',
    'Правило: assessed = historically_paid + remaining_debt.',
    'historically_paid НЕ создаёт payment / allocation.',
    'Без early/late пересчёта. Без фиктивных платежей.',
    'Существующее обязательство → CONFLICT (без overwrite). Повтор идентичного → SKIP.',
    'opening_overpayment: не более одной ненулевой строки на квартиру в файле.',
  ],
  en: [
    'Support Fee — opening import (IS-4)',
    `schema_version: ${SUPPORT_FEE_SETUP_SCHEMA_VERSION}. Sheet: opening_balances.`,
    'Apartment key: apartment_number (from Property Book). property_id forbidden.',
    'Columns: apartment_number, billing_year, obligation_type=support_fee,',
    'assessed_amount, historically_paid_amount, remaining_debt, opening_overpayment,',
    'transition_date, source_reference, notes.',
    'Rule: assessed = historically_paid + remaining_debt.',
    'historically_paid does NOT create payment / allocation rows.',
    'No early/late recalculation. No synthetic payments.',
    'Existing obligation → CONFLICT (no overwrite). Identical re-import → SKIP.',
    'opening_overpayment: at most one non-zero row per apartment in the file.',
  ],
};

export function buildSupportFeeIs4TemplateBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const example = [
    {
      apartment_number: '101',
      billing_year: '2024',
      obligation_type: 'support_fee',
      assessed_amount: '400',
      historically_paid_amount: '400',
      remaining_debt: '0',
      opening_overpayment: '0',
      transition_date: '2026-01-01',
      source_reference: 'OPENING-LEDGER-2026',
      notes: 'fully paid historical year',
    },
    {
      apartment_number: '101',
      billing_year: '2025',
      obligation_type: 'support_fee',
      assessed_amount: '400',
      historically_paid_amount: '250',
      remaining_debt: '150',
      opening_overpayment: '0',
      transition_date: '2026-01-01',
      source_reference: 'OPENING-LEDGER-2026',
      notes: 'partially paid',
    },
    {
      apartment_number: '101',
      billing_year: '2026',
      obligation_type: 'support_fee',
      assessed_amount: '400',
      historically_paid_amount: '0',
      remaining_debt: '400',
      opening_overpayment: '25',
      transition_date: '2026-01-01',
      source_reference: 'OPENING-LEDGER-2026',
      notes: 'unpaid + opening credit once per apt',
    },
  ].map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, sanitizeSpreadsheetCell(String(v))]),
    ),
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(example, { header: [...SUPPORT_FEE_OPENING_HEADERS] }),
    'opening_balances',
  );
  appendInstructionSheets(wb, SF_INSTRUCTIONS);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export function downloadSupportFeeIs4Template(
  fileName = 'support_fee_opening_template.xlsx',
): void {
  const buf = buildSupportFeeIs4TemplateBuffer();
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

export function buildSupportFeeErrorReportXlsx(preview: ImportPreviewResult): ArrayBuffer {
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

export function downloadSupportFeeErrorReport(preview: ImportPreviewResult): void {
  const buf = buildSupportFeeErrorReportXlsx(preview);
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'support_fee_opening_errors.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}

/** Pure money identity for tests / preview effect. */
export function openingAmountsConsistent(input: {
  assessed: number;
  historicallyPaid: number;
  remainingDebt: number;
}): boolean {
  return (
    roundMoney(input.assessed) ===
    roundMoney(input.historicallyPaid + input.remainingDebt)
  );
}
