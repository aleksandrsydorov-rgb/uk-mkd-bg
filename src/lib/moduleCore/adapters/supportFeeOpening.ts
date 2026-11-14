/**
 * Phase IS-4 — Support Fee opening inventarisation helpers.
 * Commit via import_support_fee_opening_state only — never fabricate payments.
 */

import * as XLSX from 'xlsx';
import type { ImportPreviewResult, ImportPreviewRow, ImportRowOperation } from '@/lib/moduleCore/types';
import { sanitizeSpreadsheetCell } from '@/lib/moduleCore/xlsxEngine';
import {
  SUPPORT_FEE_IMPORT_SPEC,
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

export const SUPPORT_FEE_MODULE_KEY = 'support_fee';
export const SUPPORT_FEE_SETUP_SCHEMA_VERSION = '1.0';
export const SUPPORT_FEE_OBLIGATION_TYPE = 'support_fee';

export const SUPPORT_FEE_OPENING_HEADERS = [
  'apartment_number',
  'section_code',
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
  apartmentsByNumber: Map<string, number> | ApartmentLookupBundle;
  /** Active (non-void/corrected) assessments by property|year */
  existingByScope: Map<string, ExistingSfObligationRef>;
  /** Prior IS-4 opening imports by property|year */
  openingImportsByScope: Map<string, { assessed: number; paid: number; remaining: number; over: number }>;
  /**
   * Historical SF opening inventarisation does NOT require a published tariff
   * (R1-RC8 first-run order: Book → meters → SF → CR → tariffs).
   * Kept optional for legacy callers; ignored by classify (never blocks).
   * @deprecated No longer gates opening import.
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
  const over = overRaw ? parseNonNegMoney(overRaw) : 0;
  if (overRaw && over == null) errors.push('invalid:opening_overpayment');
  if (over != null && over > 0 && remaining != null && remaining > 0) {
    errors.push('mutually_exclusive:debt_and_overpayment');
  }

  const td = parseTransitionDate(row.transition_date);
  if (!td.ok) errors.push(td.error);

  if (!String(row.source_reference ?? '').trim()) {
    errors.push('required:source_reference');
  }

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
    const resolved = apt ? resolveApartmentPropertyId(ctx.apartmentsByNumber, raw) : {};
    const propertyId = resolved.propertyId;
    const year = parseBillingYear(raw.billing_year);
    const assessed = parseNonNegMoney(raw.assessed_amount);
    const paid = parseNonNegMoney(raw.historically_paid_amount);
    const remaining = parseNonNegMoney(raw.remaining_debt);
    const over = parseNonNegMoney(String(raw.opening_overpayment ?? '').trim() || '0') ?? 0;
    const aptScope = apartmentScopeKeyFromRow(raw);

    if (resolved.error) errors.push(resolved.error);
    else if (apt && propertyId == null) errors.push('unknown_apartment');
    // R1-RC8: do not require published SF tariff for historical opening inventarisation.
    // source_reference + debt/overpayment XOR are enforced in validateSupportFeeOpeningRow.

    if (propertyId != null && year != null) {
      const sk = scopeKey(propertyId, year);
      if (scopeInFile.has(sk)) errors.push('duplicate_in_file:apartment_year');
      else scopeInFile.set(sk, rowNumber);
    }

    if (over > 0 && aptScope) {
      if (overpayAptInFile.has(aptScope)) errors.push('duplicate_in_file:opening_overpayment_per_apartment');
      else overpayAptInFile.set(aptScope, rowNumber);
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

export function buildSupportFeeIs4TemplateBuffer(
  locale: ImportTemplateLocale | string = 'ru',
): ArrayBuffer {
  return buildLocalizedImportWorkbook(SUPPORT_FEE_IMPORT_SPEC, toImportTemplateLocale(locale));
}

export function downloadSupportFeeIs4Template(
  localeOrFileName?: ImportTemplateLocale | string,
  fileName?: string,
): void {
  const isFileName = typeof localeOrFileName === 'string' && localeOrFileName.endsWith('.xlsx');
  const locale = toImportTemplateLocale(isFileName ? 'ru' : localeOrFileName);
  const name =
    fileName ??
    (isFileName ? (localeOrFileName as string) : localizedTemplateFileName(SUPPORT_FEE_IMPORT_SPEC, locale));
  downloadImportTemplateBuffer(buildSupportFeeIs4TemplateBuffer(locale), name);
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
