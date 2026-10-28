/**
 * Phase IS-8 — Capital Repair opening inventarisation helpers.
 * Commit via import_capital_repair_opening_state only — never fabricate payments/charges.
 */

import * as XLSX from 'xlsx';
import type { ImportPreviewResult, ImportPreviewRow, ImportRowOperation } from '@/lib/moduleCore/types';
import { sanitizeSpreadsheetCell } from '@/lib/moduleCore/xlsxEngine';
import {
  openingAmountsConsistent,
  parseBillingYear,
  parseNonNegMoney,
  parseTransitionDate,
  scopeKey,
} from '@/lib/moduleCore/adapters/supportFeeOpening';

export const CAPITAL_REPAIR_MODULE_KEY = 'capital_repair';
export const CAPITAL_REPAIR_SETUP_SCHEMA_VERSION = '1.0';
export const CAPITAL_REPAIR_OBLIGATION_TYPE = 'capital_repair';

export const CAPITAL_REPAIR_OPENING_HEADERS = [
  'apartment_number',
  'billing_year',
  'obligation_type',
  'assessment_title',
  'assessed_amount',
  'historically_paid_amount',
  'remaining_debt',
  'opening_overpayment',
  'transition_date',
  'source_reference',
  'notes',
] as const;

export type CapitalAssessmentRef = {
  id: string;
  title: string;
  status: string;
  billingYear: number | null;
};

export type CapitalOpeningClassifyContext = {
  apartmentsByNumber: Map<string, number>;
  /** Prior IS-8 opening imports by property|year */
  openingImportsByScope: Map<
    string,
    { assessed: number; paid: number; remaining: number; over: number; assessmentId: string }
  >;
  /** Assessments keyed by exact title (active/non-cancelled). */
  assessmentsByTitle: Map<string, CapitalAssessmentRef>;
  /** Assessments keyed by parsed year from title «Капитальный ремонт {year}». */
  assessmentsByYear: Map<number, CapitalAssessmentRef>;
  /** propertyId|assessmentId pairs with operational charge ledger rows. */
  operationalChargeScopes: Set<string>;
  /** propertyId|assessmentId pairs with opening_obligation ledger rows. */
  openingObligationScopes: Set<string>;
};

function normApt(value: string | undefined | null): string {
  return String(value ?? '').trim().toLowerCase();
}

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function defaultCapitalAssessmentTitle(year: number): string {
  return `Капитальный ремонт ${year}`;
}

/** Parse billing year from canonical Capital Repair assessment title. */
export function parseYearFromCapitalAssessmentTitle(title: string): number | null {
  const m = String(title ?? '')
    .trim()
    .match(/^Капитальный ремонт\s+(\d{4})$/i);
  if (!m) return null;
  return parseBillingYear(m[1] ?? '');
}

export function ledgerScopeKey(propertyId: number, assessmentId: string): string {
  return `${propertyId}|${assessmentId}`;
}

export function validateCapitalRepairOpeningRow(row: Record<string, string>): string[] {
  const errors: string[] = [];
  if (!row.apartment_number?.trim()) errors.push('required:apartment_number');
  const year = parseBillingYear(row.billing_year);
  if (year == null) errors.push('invalid:billing_year');
  const obl = String(row.obligation_type ?? '')
    .trim()
    .toLowerCase();
  if (!obl) errors.push('required:obligation_type');
  else if (obl !== CAPITAL_REPAIR_OBLIGATION_TYPE) errors.push('unsupported:obligation_type');

  const assessed = parseNonNegMoney(row.assessed_amount);
  const paid = parseNonNegMoney(row.historically_paid_amount);
  const remaining = parseNonNegMoney(row.remaining_debt);
  if (assessed == null) errors.push('invalid:assessed_amount');
  if (paid == null) errors.push('invalid:historically_paid_amount');
  if (remaining == null) errors.push('invalid:remaining_debt');
  if (assessed != null && paid != null && remaining != null) {
    if (!openingAmountsConsistent({ assessed, historicallyPaid: paid, remainingDebt: remaining })) {
      errors.push('inconsistent:assessed_ne_paid_plus_remaining');
    }
  }

  const overRaw = String(row.opening_overpayment ?? '').trim();
  const over = overRaw ? parseNonNegMoney(overRaw) : 0;
  if (overRaw && over == null) errors.push('invalid:opening_overpayment');
  if (over != null && over > 0 && remaining != null && remaining > 0) {
    errors.push('inconsistent:credit_and_debt_mutual_exclusive');
  }

  const td = parseTransitionDate(row.transition_date);
  if (!td.ok) errors.push(td.error);

  if (!String(row.source_reference ?? '').trim()) {
    errors.push('required:source_reference');
  }

  if (Object.prototype.hasOwnProperty.call(row, 'property_id') && String(row.property_id ?? '').trim()) {
    errors.push('untrusted_property_id');
  }
  if (
    Object.prototype.hasOwnProperty.call(row, 'assessment_id') &&
    String(row.assessment_id ?? '').trim()
  ) {
    errors.push('untrusted_assessment_id');
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

function resolveAssessment(
  year: number,
  assessmentTitleRaw: string | undefined,
  ctx: CapitalOpeningClassifyContext,
): { ref: CapitalAssessmentRef | null; title: string; willCreateShell: boolean } {
  const title =
    String(assessmentTitleRaw ?? '').trim() || defaultCapitalAssessmentTitle(year);
  const byTitle = ctx.assessmentsByTitle.get(title);
  if (byTitle) return { ref: byTitle, title, willCreateShell: false };
  if (!String(assessmentTitleRaw ?? '').trim()) {
    const byYear = ctx.assessmentsByYear.get(year);
    if (byYear) return { ref: byYear, title: byYear.title, willCreateShell: false };
  }
  return { ref: null, title, willCreateShell: true };
}

/**
 * Classify Capital Repair opening rows.
 * Conflict → operation error + preview_class CONFLICT.
 * Matching prior opening import → skip (idempotent).
 * Operational charge for same apt×assessment → CONFLICT (never overwrite).
 */
export function classifyCapitalRepairOpeningRows(
  rows: Record<string, string>[],
  ctx: CapitalOpeningClassifyContext,
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

  rows.forEach((raw, idx) => {
    const rowNumber = idx + 2;
    const errors = validateCapitalRepairOpeningRow(raw);
    const apt = normApt(raw.apartment_number);
    const propertyId = apt ? ctx.apartmentsByNumber.get(apt) : undefined;
    const year = parseBillingYear(raw.billing_year);
    const assessed = parseNonNegMoney(raw.assessed_amount);
    const paid = parseNonNegMoney(raw.historically_paid_amount);
    const remaining = parseNonNegMoney(raw.remaining_debt);
    const over = parseNonNegMoney(String(raw.opening_overpayment ?? '').trim() || '0') ?? 0;

    if (apt && propertyId == null) errors.push('unknown_apartment');

    if (propertyId != null && year != null) {
      const sk = scopeKey(propertyId, year);
      if (scopeInFile.has(sk)) errors.push('duplicate_in_file:apartment_year');
      else scopeInFile.set(sk, rowNumber);
    }

    let operation: ImportRowOperation = 'error';
    let previewClass = 'ERROR';
    let resolvedAssessmentId = '';
    let resolvedAssessmentTitle = '';
    let assessmentWillCreate = 'false';

    if (
      errors.length === 0 &&
      propertyId != null &&
      year != null &&
      assessed != null &&
      paid != null &&
      remaining != null
    ) {
      const sk = scopeKey(propertyId, year);
      const priorOpening = ctx.openingImportsByScope.get(sk);
      const resolved = resolveAssessment(year, raw.assessment_title, ctx);
      resolvedAssessmentTitle = resolved.title;
      assessmentWillCreate = resolved.willCreateShell ? 'true' : 'false';
      if (resolved.ref) resolvedAssessmentId = resolved.ref.id;

      if (priorOpening) {
        const same =
          priorOpening.assessed === assessed &&
          priorOpening.paid === paid &&
          priorOpening.remaining === remaining &&
          priorOpening.over === over;
        if (same) {
          operation = 'skip';
          previewClass = 'SKIP';
          resolvedAssessmentId = priorOpening.assessmentId;
        } else {
          operation = 'error';
          previewClass = 'CONFLICT';
          errors.push('conflict:existing_opening_import_mismatch');
        }
      } else if (resolved.ref) {
        const ls = ledgerScopeKey(propertyId, resolved.ref.id);
        if (ctx.operationalChargeScopes.has(ls)) {
          operation = 'error';
          previewClass = 'CONFLICT';
          errors.push('conflict:existing_operational_charge');
        } else if (ctx.openingObligationScopes.has(ls)) {
          operation = 'error';
          previewClass = 'CONFLICT';
          errors.push('conflict:existing_opening_obligation');
        } else {
          operation = 'create';
          previewClass = 'CREATE';
        }
      } else {
        // Shell assessment will be created by RPC — no orphan ledger without assessment_id.
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
    const effectBalance = roundMoney(assessed != null && paid != null ? assessed - paid - over : 0);

    previewRows.push({
      rowNumber,
      operation,
      data: {
        ...raw,
        obligation_type: CAPITAL_REPAIR_OBLIGATION_TYPE,
        assessment_title: resolvedAssessmentTitle || String(raw.assessment_title ?? ''),
        opening_overpayment: String(over),
        resolved_property_id: propertyId != null ? String(propertyId) : '',
        resolved_assessment_id: resolvedAssessmentId,
        assessment_will_create: assessmentWillCreate,
        preview_class: previewClass,
        transition_date: td.ok ? td.iso : String(raw.transition_date ?? ''),
        assessed_amount: assessed != null ? String(assessed) : String(raw.assessed_amount ?? ''),
        historically_paid_amount: paid != null ? String(paid) : String(raw.historically_paid_amount ?? ''),
        remaining_debt: remaining != null ? String(remaining) : String(raw.remaining_debt ?? ''),
        preview_balance_effect_eur: String(effectBalance),
        no_synthetic_payments: 'true',
        no_operational_charges: 'true',
        fund_vs_cash_note: 'apartment_obligation_not_bank_cash',
      },
      errors,
      matchKey: apt || undefined,
    });
  });

  return {
    schemaVersion: CAPITAL_REPAIR_SETUP_SCHEMA_VERSION,
    rows: previewRows,
    createCount: counters.createCount,
    updateCount: counters.updateCount,
    skipCount: counters.skipCount,
    errorCount: counters.errorCount + counters.conflictCount,
    conflictCount: counters.conflictCount,
  };
}

export function buildCapitalAssessmentsMaps(
  rows: Iterable<{
    id: string;
    title: string | null;
    status?: string | null;
  }>,
): {
  assessmentsByTitle: Map<string, CapitalAssessmentRef>;
  assessmentsByYear: Map<number, CapitalAssessmentRef>;
} {
  const assessmentsByTitle = new Map<string, CapitalAssessmentRef>();
  const assessmentsByYear = new Map<number, CapitalAssessmentRef>();
  for (const r of rows) {
    const status = String(r.status ?? 'active').toLowerCase();
    if (status === 'cancelled' || status === 'void') continue;
    const title = String(r.title ?? '').trim();
    if (!title) continue;
    const year = parseYearFromCapitalAssessmentTitle(title);
    const ref: CapitalAssessmentRef = {
      id: String(r.id),
      title,
      status,
      billingYear: year,
    };
    if (!assessmentsByTitle.has(title)) assessmentsByTitle.set(title, ref);
    if (year != null && !assessmentsByYear.has(year)) assessmentsByYear.set(year, ref);
  }
  return { assessmentsByTitle, assessmentsByYear };
}

export function buildCapitalLedgerConflictSets(
  rows: Iterable<{
    property_id: number;
    assessment_id: string | null;
    kind: string;
  }>,
): { operationalChargeScopes: Set<string>; openingObligationScopes: Set<string> } {
  const operationalChargeScopes = new Set<string>();
  const openingObligationScopes = new Set<string>();
  for (const r of rows) {
    if (!r.assessment_id) continue;
    const key = ledgerScopeKey(Number(r.property_id), String(r.assessment_id));
    if (r.kind === 'charge') operationalChargeScopes.add(key);
    if (r.kind === 'opening_obligation') openingObligationScopes.add(key);
  }
  return { operationalChargeScopes, openingObligationScopes };
}

/** Canonical Capital Repair balance effect for opening kinds (tests / preview). */
export function capitalOpeningBalanceEffect(input: {
  assessed: number;
  historicallyPaid: number;
  openingOverpayment: number;
}): number {
  return roundMoney(input.assessed - input.historicallyPaid - input.openingOverpayment);
}

export type CapitalRepairOpeningRpcPayload = {
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
  assessmentTitle: string;
  rowNumber: number;
  apartmentNumber: string;
};

export function capitalRepairOpeningPayloadsFromPreview(
  preview: ImportPreviewResult,
): CapitalRepairOpeningRpcPayload[] {
  const out: CapitalRepairOpeningRpcPayload[] = [];
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
    const assessmentTitle =
      String(row.data.assessment_title ?? '').trim() ||
      defaultCapitalAssessmentTitle(billingYear);
    out.push({
      propertyId,
      billingYear,
      obligationType: CAPITAL_REPAIR_OBLIGATION_TYPE,
      assessedAmount: assessed,
      historicallyPaidAmount: paid,
      remainingDebt: remaining,
      openingOverpayment: over,
      transitionDate: td.iso,
      sourceReference: String(row.data.source_reference ?? '').trim(),
      notes: String(row.data.notes ?? '').trim(),
      assessmentTitle,
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

const CR_INSTRUCTIONS: Record<'bg' | 'ru' | 'en', string[]> = {
  bg: [
    'Капитален ремонт — начален импорт (IS-8)',
    `schema_version: ${CAPITAL_REPAIR_SETUP_SCHEMA_VERSION}. Лист: opening_balances.`,
    'Ключ апартамент: apartment_number (от Книгата). property_id и assessment_id са забранени.',
    'Полета: apartment_number, billing_year, obligation_type=capital_repair,',
    'assessment_title (опционално; по подразбиране «Капитальный ремонт {year}»),',
    'assessed_amount, historically_paid_amount, remaining_debt, opening_overpayment,',
    'transition_date, source_reference (задължителен), notes.',
    'Правило: assessed = historically_paid + remaining_debt.',
    'opening_overpayment и remaining_debt са взаимно изключващи се; и двете 0 = явен нула.',
    'historically_paid НЕ създава payment. Без operational charge RPC.',
    'Всеки ред се връзва към каноничен assessment (създава се shell при нужда).',
    'Съществуващ charge/opening → CONFLICT. Идентичен импорт → SKIP.',
    'Това са задължения на апартаменти, НЕ банкови/касови резерви (остатъкът на фонда е отделно).',
  ],
  ru: [
    'Капитальный ремонт — начальный импорт (IS-8)',
    `schema_version: ${CAPITAL_REPAIR_SETUP_SCHEMA_VERSION}. Лист: opening_balances.`,
    'Ключ квартиры: apartment_number (из Книги). property_id и assessment_id запрещены.',
    'Поля: apartment_number, billing_year, obligation_type=capital_repair,',
    'assessment_title (опционально; по умолчанию «Капитальный ремонт {year}»),',
    'assessed_amount, historically_paid_amount, remaining_debt, opening_overpayment,',
    'transition_date, source_reference (обязателен), notes.',
    'Правило: assessed = historically_paid + remaining_debt.',
    'opening_overpayment и remaining_debt взаимно исключают друг друга; оба 0 = явный ноль.',
    'historically_paid НЕ создаёт payment. Без operational charge RPC.',
    'Каждая строка привязана к каноническому assessment (shell при необходимости).',
    'Существующий charge/opening → CONFLICT. Идентичный импорт → SKIP.',
    'Это обязательства квартир, НЕ банковские/кассовые резервы фонда (остаток фонда — отдельно).',
  ],
  en: [
    'Capital Repair — opening import (IS-8 / R1-RC8)',
    `schema_version: ${CAPITAL_REPAIR_SETUP_SCHEMA_VERSION}. Sheet: opening_balances.`,
    'Apartment key: apartment_number (from Property Book). property_id and assessment_id forbidden.',
    'Columns: apartment_number, billing_year, obligation_type=capital_repair,',
    'assessment_title (optional; default «Капитальный ремонт {year}»),',
    'assessed_amount, historically_paid_amount, remaining_debt, opening_overpayment,',
    'transition_date, source_reference (required), notes.',
    'Rule: assessed = historically_paid + remaining_debt.',
    'opening_overpayment and remaining_debt are mutually exclusive; both 0 = explicit zero.',
    'historically_paid does NOT create payment. No operational charge RPC.',
    'Every row links to a canonical assessment (shell created if missing).',
    'Existing charge/opening → CONFLICT. Identical re-import → SKIP.',
    'These are apartment obligations, NOT bank/cash fund reserves (fund cash is separate).',
  ],
};

export function buildCapitalRepairIs8TemplateBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const example = [
    {
      apartment_number: '101',
      billing_year: '2023',
      obligation_type: 'capital_repair',
      assessment_title: '',
      assessed_amount: '120',
      historically_paid_amount: '120',
      remaining_debt: '0',
      opening_overpayment: '0',
      transition_date: '2026-01-01',
      source_reference: 'CR-OPENING-2026',
      notes: 'fully paid historical year',
    },
    {
      apartment_number: '101',
      billing_year: '2024',
      obligation_type: 'capital_repair',
      assessment_title: '',
      assessed_amount: '120',
      historically_paid_amount: '70',
      remaining_debt: '50',
      opening_overpayment: '0',
      transition_date: '2026-01-01',
      source_reference: 'CR-OPENING-2026',
      notes: 'partially paid',
    },
    {
      apartment_number: '101',
      billing_year: '2025',
      obligation_type: 'capital_repair',
      assessment_title: '',
      assessed_amount: '120',
      historically_paid_amount: '0',
      remaining_debt: '120',
      opening_overpayment: '0',
      transition_date: '2026-01-01',
      source_reference: 'CR-OPENING-2026',
      notes: 'opening debt',
    },
    {
      apartment_number: '102',
      billing_year: '2025',
      obligation_type: 'capital_repair',
      assessment_title: '',
      assessed_amount: '120',
      historically_paid_amount: '120',
      remaining_debt: '0',
      opening_overpayment: '15',
      transition_date: '2026-01-01',
      source_reference: 'CR-OPENING-2026-102',
      notes: 'fully settled + opening credit',
    },
  ].map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, sanitizeSpreadsheetCell(String(v))]),
    ),
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(example, { header: [...CAPITAL_REPAIR_OPENING_HEADERS] }),
    'opening_balances',
  );
  appendInstructionSheets(wb, CR_INSTRUCTIONS);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export function downloadCapitalRepairIs8Template(
  fileName = 'capital_repair_opening_template.xlsx',
): void {
  const buf = buildCapitalRepairIs8TemplateBuffer();
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

export function buildCapitalRepairErrorReportXlsx(preview: ImportPreviewResult): ArrayBuffer {
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

export function downloadCapitalRepairErrorReport(preview: ImportPreviewResult): void {
  const buf = buildCapitalRepairErrorReportXlsx(preview);
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'capital_repair_opening_errors.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}
