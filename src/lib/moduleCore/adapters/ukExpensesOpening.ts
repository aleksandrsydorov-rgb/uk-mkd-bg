/**
 * Phase IS-6a — Historical UK expenses inventarisation helpers.
 * Commit via import_uk_expense_opening_row only — never publish, never AP/payments.
 */

import * as XLSX from 'xlsx';
import { EXPENSE_PENDING } from '@/lib/expenses';
import type { ImportPreviewResult, ImportPreviewRow, ImportRowOperation } from '@/lib/moduleCore/types';
import { sanitizeSpreadsheetCell } from '@/lib/moduleCore/xlsxEngine';

/** Platform-service setup key (not a UX toggle module). */
export const UK_EXPENSES_SETUP_KEY = 'uk_expenses';
export const UK_EXPENSES_SETUP_SCHEMA_VERSION = '1.0';

export const UK_EXPENSE_OPENING_HEADERS = [
  'source_ref',
  'title',
  'expense_date',
  'amount_eur',
  'category_code',
  'transition_date',
  'source_document',
  'notes',
] as const;

export type ExistingUkExpenseOpeningRef = {
  id: number;
  sourceRef: string;
  title: string;
  expenseDate: string;
  amount: number;
  transitionDate: string | null;
  budgetCategoryId: string | null;
  categoryCode: string | null;
  status: string;
  openingImport: boolean;
};

export type UkExpenseOpeningClassifyContext = {
  /** lower(source_ref) → existing opening expense */
  existingBySourceRef: Map<string, ExistingUkExpenseOpeningRef>;
  /** lower(category_code) → category id (active only) */
  categoriesByCode: Map<string, string>;
  /** YYYY-MM-DD Sofia/local today */
  sofiaTodayIso: string;
};

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function parsePositiveMoney(raw: string | undefined): number | null {
  const t = String(raw ?? '')
    .trim()
    .replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
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

/** Mirror SQL budget_expense_counts_in_operational_execution */
export function expenseCountsInOperationalBudgetExecution(openingImport: boolean): boolean {
  return openingImport !== true;
}

export function openingExpenseIdentical(
  existing: ExistingUkExpenseOpeningRef,
  args: {
    title: string;
    expenseDate: string;
    amount: number;
    transitionDate: string;
    categoryId: string | null;
  },
): boolean {
  return (
    existing.openingImport &&
    (existing.title ?? '') === args.title &&
    existing.expenseDate === args.expenseDate &&
    roundMoney(existing.amount) === args.amount &&
    (existing.transitionDate ?? '') === args.transitionDate &&
    (existing.budgetCategoryId ?? null) === args.categoryId
  );
}

export function validateUkExpenseOpeningRow(row: Record<string, string>): string[] {
  const errors: string[] = [];
  if (!row.source_ref?.trim()) errors.push('required:source_ref');
  if (!row.title?.trim()) errors.push('required:title');

  const amount = parsePositiveMoney(row.amount_eur);
  if (amount == null) errors.push('invalid:amount_eur');

  const ed = parseRequiredIsoDate(row.expense_date, 'expense_date');
  if (!ed.ok) errors.push(ed.error);

  const td = parseRequiredIsoDate(row.transition_date, 'transition_date');
  if (!td.ok) errors.push(td.error);
  else {
    const todayIso = new Date().toISOString().slice(0, 10);
    if (td.iso > todayIso) errors.push('invalid:transition_date_future');
  }

  if (ed.ok && td.ok && ed.iso > td.iso) {
    errors.push('invalid:expense_date_after_transition');
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

export function classifyUkExpenseOpeningRows(
  rows: Record<string, string>[],
  ctx: UkExpenseOpeningClassifyContext,
): ImportPreviewResult & { conflictCount: number } {
  const counters = {
    createCount: 0,
    updateCount: 0,
    skipCount: 0,
    errorCount: 0,
    conflictCount: 0,
  };
  const previewRows: ImportPreviewRow[] = [];
  const refInFile = new Map<string, number>();

  rows.forEach((raw, idx) => {
    const rowNumber = idx + 2;
    const errors = validateUkExpenseOpeningRow(raw);
    const sourceRef = String(raw.source_ref ?? '').trim();
    const sourceKey = sourceRef.toLowerCase();
    const title = String(raw.title ?? '').trim();
    const amount = parsePositiveMoney(raw.amount_eur) ?? 0;
    const ed = parseRequiredIsoDate(raw.expense_date, 'expense_date');
    const td = parseRequiredIsoDate(raw.transition_date, 'transition_date');
    const catCode = String(raw.category_code ?? '')
      .trim()
      .toLowerCase();
    let categoryId: string | null = null;

    if (sourceKey) {
      if (refInFile.has(sourceKey)) errors.push('duplicate_in_file:source_ref');
      else refInFile.set(sourceKey, rowNumber);
    }

    if (catCode) {
      categoryId = ctx.categoriesByCode.get(catCode) ?? null;
      if (categoryId == null) errors.push('unknown:category_code');
    }

    if (td.ok && td.iso > ctx.sofiaTodayIso) {
      if (!errors.includes('invalid:transition_date_future')) {
        errors.push('invalid:transition_date_future');
      }
    }

    let operation: ImportRowOperation = 'error';
    let previewClass = 'ERROR';

    if (errors.length === 0 && ed.ok && td.ok) {
      const existing = ctx.existingBySourceRef.get(sourceKey);
      if (existing) {
        if (
          openingExpenseIdentical(existing, {
            title,
            expenseDate: ed.iso,
            amount,
            transitionDate: td.iso,
            categoryId,
          })
        ) {
          operation = 'skip';
          previewClass = 'SKIP';
        } else {
          operation = 'error';
          previewClass = 'CONFLICT';
          errors.push('conflict:existing_source_ref_mismatch');
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
        source_ref: sourceRef,
        title,
        amount_eur: String(amount),
        expense_date: ed.ok ? ed.iso : String(raw.expense_date ?? ''),
        transition_date: td.ok ? td.iso : String(raw.transition_date ?? ''),
        category_code: catCode,
        resolved_category_id: categoryId ?? '',
        preview_class: previewClass,
        pending_status: EXPENSE_PENDING,
        opening_import: 'true',
        no_auto_publish: 'true',
        no_ap: 'true',
        no_payment: 'true',
        budget_execution_excluded: 'true',
      },
      errors,
      matchKey: sourceKey || undefined,
    });
  });

  return {
    schemaVersion: UK_EXPENSES_SETUP_SCHEMA_VERSION,
    rows: previewRows,
    createCount: counters.createCount,
    updateCount: counters.updateCount,
    skipCount: counters.skipCount,
    errorCount: counters.errorCount + counters.conflictCount,
    conflictCount: counters.conflictCount,
  };
}

export function buildExistingUkExpenseOpeningMap(
  rows: Iterable<{
    id: number;
    source_ref?: string | null;
    title?: string | null;
    expense_date: string;
    amount: number;
    opening_transition_date?: string | null;
    budget_category_id?: string | null;
    category_code?: string | null;
    status?: string | null;
    opening_import?: boolean | null;
  }>,
): Map<string, ExistingUkExpenseOpeningRef> {
  const map = new Map<string, ExistingUkExpenseOpeningRef>();
  for (const r of rows) {
    if (!r.opening_import) continue;
    const ref = String(r.source_ref ?? '')
      .trim()
      .toLowerCase();
    if (!ref) continue;
    map.set(ref, {
      id: r.id,
      sourceRef: String(r.source_ref ?? '').trim(),
      title: String(r.title ?? ''),
      expenseDate: String(r.expense_date).slice(0, 10),
      amount: Number(r.amount),
      transitionDate: r.opening_transition_date
        ? String(r.opening_transition_date).slice(0, 10)
        : null,
      budgetCategoryId: r.budget_category_id ?? null,
      categoryCode: r.category_code ?? null,
      status: String(r.status ?? ''),
      openingImport: true,
    });
  }
  return map;
}

export function buildCategoryCodeMap(
  rows: Iterable<{ id: string; code: string; active?: boolean | null }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.active === false) continue;
    map.set(String(r.code).trim().toLowerCase(), r.id);
  }
  return map;
}

export type UkExpenseOpeningRpcPayload = {
  sourceRef: string;
  title: string;
  expenseDate: string;
  amount: number;
  transitionDate: string;
  categoryCode: string;
  sourceDocument: string;
  notes: string;
  rowNumber: number;
};

export function ukExpenseOpeningPayloadsFromPreview(
  preview: ImportPreviewResult,
): UkExpenseOpeningRpcPayload[] {
  const out: UkExpenseOpeningRpcPayload[] = [];
  for (const row of preview.rows) {
    if (row.operation !== 'create') continue;
    out.push({
      sourceRef: String(row.data.source_ref ?? '').trim(),
      title: String(row.data.title ?? '').trim(),
      expenseDate: String(row.data.expense_date ?? ''),
      amount: Number(row.data.amount_eur ?? 0),
      transitionDate: String(row.data.transition_date ?? ''),
      categoryCode: String(row.data.category_code ?? '').trim(),
      sourceDocument: String(row.data.source_document ?? '').trim(),
      notes: String(row.data.notes ?? '').trim(),
      rowNumber: row.rowNumber,
    });
  }
  return out;
}

const INSTRUCTIONS: Record<'bg' | 'ru' | 'en', string[]> = {
  bg: [
    'Разходи на УС — начален исторически импорт (IS-6a)',
    `schema_version: ${UK_EXPENSES_SETUP_SCHEMA_VERSION}. Лист: expenses.`,
    'source_ref е задължителен уникален ключ. Не използвайте само title+date+amount.',
    'Редовете се създават само като „на проверке“ — без автоматична публикация.',
    'opening_import = true → не влизат в оперативното изпълнение на бюджета.',
    'category_code е по желание; неизвестен код → ERROR (без тихо присвояване).',
    'Без AP / фактури към доставчици / плащания. Без Support Fee / Internet opening.',
    'Идентичен source_ref → SKIP. Разминаване → CONFLICT. Без overwrite.',
    'Импортът е незадължителен — може да се пропусне и да се ползва Admin UI.',
  ],
  ru: [
    'Расходы УК — начальный исторический импорт (IS-6a)',
    `schema_version: ${UK_EXPENSES_SETUP_SCHEMA_VERSION}. Лист: expenses.`,
    'source_ref — обязательный уникальный ключ. Не используйте только title+date+amount.',
    'Строки создаются только со статусом «на проверке» — без автопубликации.',
    'opening_import = true → не входят в операционное исполнение бюджета.',
    'category_code необязателен; неизвестный код → ERROR (без тихого назначения).',
    'Без AP / счетов поставщикам / платежей. Без Support Fee / Internet opening.',
    'Идентичный source_ref → SKIP. Расхождение → CONFLICT. Без overwrite.',
    'Импорт необязателен — можно пропустить и использовать Admin UI.',
  ],
  en: [
    'UK expenses — historical opening import (IS-6a)',
    `schema_version: ${UK_EXPENSES_SETUP_SCHEMA_VERSION}. Sheet: expenses.`,
    'source_ref is the required unique key. Do not rely on title+date+amount alone.',
    'Rows are created as pending review only — no automatic publication.',
    'opening_import = true → excluded from operational budget execution.',
    'category_code is optional; unknown code → ERROR (no silent assignment).',
    'No AP / supplier invoices / payments. No Support Fee / Internet opening RPCs.',
    'Identical source_ref → SKIP. Mismatch → CONFLICT. Never overwrite.',
    'Import is optional — skip and use Admin expense UI after launch if preferred.',
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

export function buildUkExpensesIs6aTemplateBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const example = [
    {
      source_ref: 'EXP-2025-001',
      title: 'Cleaning Q4 2025',
      expense_date: '2025-11-15',
      amount_eur: '120.00',
      category_code: 'cleaning',
      transition_date: '2026-01-01',
      source_document: 'INV-7788',
      notes: 'historical archival',
    },
    {
      source_ref: 'EXP-2025-002',
      title: 'Elevator service',
      expense_date: '2025-08-01',
      amount_eur: '350.50',
      category_code: '',
      transition_date: '2026-01-01',
      source_document: '',
      notes: 'no category — archival only',
    },
  ].map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, sanitizeSpreadsheetCell(String(v))]),
    ),
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(example, { header: [...UK_EXPENSE_OPENING_HEADERS] }),
    'expenses',
  );
  appendInstructionSheets(wb, INSTRUCTIONS);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export function downloadUkExpensesIs6aTemplate(
  fileName = 'uk_expenses_opening_template.xlsx',
): void {
  const buf = buildUkExpensesIs6aTemplateBuffer();
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

export function buildUkExpensesErrorReportXlsx(preview: ImportPreviewResult): ArrayBuffer {
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

export function downloadUkExpensesErrorReport(preview: ImportPreviewResult): void {
  const buf = buildUkExpensesErrorReportXlsx(preview);
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'uk_expenses_opening_errors.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}
