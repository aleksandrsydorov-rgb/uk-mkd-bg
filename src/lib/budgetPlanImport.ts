/**
 * Complex budget plan workbook.
 * Preview only — confirmation goes through admin_commit_budget_plan.
 * Codes stay text so values such as 1.1 and 01 are not rewritten.
 * Numeric Excel cells use cell.v; display format (cell.w) must not drive import.
 */

import * as XLSX from 'xlsx';
import {
  BUDGET_PLAN_IMPORT_SPEC,
  OPENING_TOTALS_IMPORT_SPEC,
  buildLocalizedImportWorkbook,
  buildLocalizedImportWorkbookWithRows,
  columnHeaderCandidates,
  findImportDataSheet,
  normalizeImportHeader,
  toImportTemplateLocale,
  type ImportTemplateLocale,
} from '@/lib/importTemplates';

export const BUDGET_PLAN_CODE = 'Код статьи';
export const BUDGET_PLAN_NAME = 'Название статьи';
export const BUDGET_PLAN_AMOUNT = 'План на год, EUR';

const CODE_HEADERS = ['код статьи', 'category code', 'код на статията', 'code'];
const NAME_HEADERS = ['название статьи', 'category name', 'наименование', 'name'];
const AMOUNT_HEADERS = [
  'план на год, eur',
  'annual plan, eur',
  'план за годината, eur',
  'уже израсходовано, eur',
  'already spent, eur',
  'вече изразходвано, eur',
  'amount',
];

function headerSetFor(legacy: string[], key: 'code' | 'name' | 'amount'): Set<string> {
  const out = new Set(legacy.map((h) => normalizeImportHeader(h)));
  for (const spec of [BUDGET_PLAN_IMPORT_SPEC, OPENING_TOTALS_IMPORT_SPEC]) {
    const col = spec.columns.find((c) => c.key === key);
    if (!col) continue;
    for (const cand of columnHeaderCandidates(col)) out.add(cand);
  }
  return out;
}

const CODE_HEADER_SET = headerSetFor(CODE_HEADERS, 'code');
const NAME_HEADER_SET = headerSetFor(NAME_HEADERS, 'name');
const AMOUNT_HEADER_SET = headerSetFor(AMOUNT_HEADERS, 'amount');

function headerMatches(set: Set<string>, normalizedCell: string): boolean {
  return set.has(normalizedCell) || set.has(normalizeImportHeader(normalizedCell));
}

const TOTAL_RE = /^(?:итого|всего|total|общо|sum|сумма|сума)(?:\s|$)/i;

export type BudgetPlanArticle = {
  row: number;
  code: string;
  name: string;
  amount: number;
};

export type BudgetPlanSkip = {
  row: number;
  reason: 'section' | 'total' | 'empty';
};

export type BudgetPlanIssueReason =
  | 'required_code'
  | 'required_name'
  | 'required_amount'
  | 'invalid_amount'
  | 'negative_amount'
  | 'amount_precision'
  | 'duplicate_code';

export type BudgetPlanIssue = {
  row: number;
  reason: BudgetPlanIssueReason;
  code?: string;
  /** Raw amount cell as shown to the user when amount parsing failed. */
  raw?: string;
};

export type BudgetPreviewAction = 'create' | 'update' | 'unchanged' | 'error' | 'skip';

/** Leaf rows shown in the preview table (sections/totals are skipped, not listed as articles). */
export type BudgetPlanPreviewRow = {
  row: number;
  code: string;
  name: string;
  /** Valid amount, or null when the cell could not be read as money. */
  amount: number | null;
  /** Original amount cell for display when invalid. */
  amountRaw: string;
  issues: BudgetPlanIssueReason[];
  /** Existing plan amount for this code when known (client enrich). */
  priorAmount?: number | null;
  action?: BudgetPreviewAction;
};

export type BudgetPlanParse = {
  articles: BudgetPlanArticle[];
  previewRows: BudgetPlanPreviewRow[];
  skipped: BudgetPlanSkip[];
  issues: BudgetPlanIssue[];
};

/** Attach create/update/unchanged actions from existing plan amounts by category code. */
export function enrichBudgetPreviewWithExisting(
  parsed: BudgetPlanParse,
  existingByCode: Map<string, number>,
): BudgetPlanParse {
  const previewRows = parsed.previewRows.map((row) => {
    if (row.issues.length > 0 || row.amount == null) {
      return { ...row, priorAmount: null, action: 'error' as BudgetPreviewAction };
    }
    const key = row.code.trim().toLowerCase();
    if (!key) return { ...row, priorAmount: null, action: 'error' as BudgetPreviewAction };
    if (!existingByCode.has(key)) {
      return { ...row, priorAmount: null, action: 'create' as BudgetPreviewAction };
    }
    const prior = existingByCode.get(key) ?? 0;
    const same = Math.abs(prior - row.amount) < 0.0001;
    return {
      ...row,
      priorAmount: prior,
      action: (same ? 'unchanged' : 'update') as BudgetPreviewAction,
    };
  });
  return { ...parsed, previewRows };
}

export function presentBudgetPreviewAction(
  action: BudgetPreviewAction | undefined,
  t: (key: string) => string,
): string {
  if (action === 'create') return t('admin.internetImportOutcomeWillCreate');
  if (action === 'update') return t('admin.internetImportOutcomeWillUpdate');
  if (action === 'unchanged') return t('admin.internetImportOutcomeWillSkip');
  if (action === 'error') return t('admin.internetImportOutcomeError');
  if (action === 'skip') return t('admin.internetImportOutcomeWillSkip');
  return '—';
}

export type OpeningPreviewAction = 'create' | 'update' | 'unchanged' | 'error';

export function openingPreviewAction(
  baselineAmount: number | undefined,
  newAmount: number | null,
  hasIssues: boolean,
): OpeningPreviewAction {
  if (hasIssues || newAmount == null) return 'error';
  if (baselineAmount == null || !Number.isFinite(baselineAmount) || baselineAmount <= 0) {
    return newAmount === 0 ? 'unchanged' : 'create';
  }
  if (Math.abs(baselineAmount - newAmount) < 0.0001) return 'unchanged';
  return 'update';
}

export function presentOpeningPreviewAction(
  action: OpeningPreviewAction,
  t: (key: string) => string,
): string {
  if (action === 'create') return t('admin.internetImportOutcomeWillCreate');
  if (action === 'update') return t('admin.internetImportOutcomeWillUpdate');
  if (action === 'unchanged') return t('admin.internetImportOutcomeWillSkip');
  return t('admin.internetImportOutcomeError');
}

function normHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function cellText(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function amountRawDisplay(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return String(value).trim();
}

/**
 * Parse a money cell.
 * - Numbers from Excel (cell.v) are accepted as-is (2 dp max).
 * - Text: optional spaces; a single `.` or `,` as decimal separator;
 *   no mixed thousand+decimal guessing (e.g. "2,556.46" as text is invalid).
 */
export function parseMoneyCell(
  raw: unknown,
):
  | { ok: true; amount: number }
  | {
      ok: false;
      reason: 'required_amount' | 'invalid_amount' | 'negative_amount' | 'amount_precision';
      raw: string;
    } {
  const display = amountRawDisplay(raw);
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, reason: 'invalid_amount', raw: display };
    if (raw < 0) return { ok: false, reason: 'negative_amount', raw: display };
    // Round each article to cents independently — no global balancing adjustment.
    return { ok: true, amount: Math.round(raw * 100) / 100 };
  }

  const text = display.replace(/\u00a0/g, ' ').trim();
  if (!text) return { ok: false, reason: 'required_amount', raw: display };

  // Strip ordinary spaces only (not commas/dots) — spaces may separate thousands in plain text.
  const compact = text.replace(/ /g, '');
  if (!compact) return { ok: false, reason: 'required_amount', raw: display };

  // Reject mixed separators: "2,556.46" / "2.556,46" are ambiguous as text.
  if (compact.includes(',') && compact.includes('.')) {
    return { ok: false, reason: 'invalid_amount', raw: display };
  }

  // Single decimal separator: comma or dot. No thousand grouping in text form.
  if (!/^-?\d+([.,]\d+)?$/.test(compact)) {
    return { ok: false, reason: 'invalid_amount', raw: display };
  }

  const normalized = compact.replace(',', '.');
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return { ok: false, reason: 'invalid_amount', raw: display };
  if (amount < 0) return { ok: false, reason: 'negative_amount', raw: display };
  // Round each article to cents; more than two fractional digits are accepted then rounded.
  return { ok: true, amount: Math.round(amount * 100) / 100 };
}

function isTotalLabel(code: string, name: string): boolean {
  return TOTAL_RE.test(code) || TOTAL_RE.test(name);
}

export function parseBudgetPlanMatrix(matrix: unknown[][]): BudgetPlanParse {
  const rows = matrix.filter((row) => row.some((cell) => cellText(cell) !== '' || typeof cell === 'number'));
  if (rows.length === 0) return { articles: [], previewRows: [], skipped: [], issues: [] };
  const header = rows[0].map((cell) => normHeader(cellText(cell)));
  const codeAt = header.findIndex((cell) => headerMatches(CODE_HEADER_SET, cell));
  const nameAt = header.findIndex((cell) => headerMatches(NAME_HEADER_SET, cell));
  const amountAt = header.findIndex((cell) => headerMatches(AMOUNT_HEADER_SET, cell));
  if (codeAt < 0 || nameAt < 0 || amountAt < 0) {
    return {
      articles: [],
      previewRows: [],
      skipped: [],
      issues: [{ row: 1, reason: 'required_code' }],
    };
  }

  const body = rows.slice(1).map((row, index) => ({
    row: index + 2,
    code: cellText(row[codeAt]),
    name: cellText(row[nameAt]),
    amountCell: row[amountAt],
    amountRaw: amountRawDisplay(row[amountAt]),
  }));
  const codes = body.map((row) => row.code).filter((code) => code.length > 0);
  const isParent = (code: string) => codes.some((other) => other !== code && other.startsWith(`${code}.`));

  const articles: BudgetPlanArticle[] = [];
  const previewRows: BudgetPlanPreviewRow[] = [];
  const skipped: BudgetPlanSkip[] = [];
  const issues: BudgetPlanIssue[] = [];
  const seen = new Set<string>();

  for (const row of body) {
    if (!row.code && !row.name && !row.amountRaw) {
      skipped.push({ row: row.row, reason: 'empty' });
      continue;
    }
    if (isTotalLabel(row.code, row.name)) {
      skipped.push({ row: row.row, reason: 'total' });
      continue;
    }
    if (row.code && isParent(row.code)) {
      skipped.push({ row: row.row, reason: 'section' });
      continue;
    }

    const rowIssues: BudgetPlanIssueReason[] = [];
    if (!row.code) {
      rowIssues.push('required_code');
      issues.push({ row: row.row, reason: 'required_code' });
    }
    if (!row.name) {
      rowIssues.push('required_name');
      issues.push({ row: row.row, reason: 'required_name', code: row.code || undefined });
    }
    const money = parseMoneyCell(row.amountCell);
    if (!money.ok) {
      rowIssues.push(money.reason);
      issues.push({
        row: row.row,
        reason: money.reason,
        code: row.code || undefined,
        raw: money.raw,
      });
    }
    const key = row.code.toLowerCase();
    const duplicate = row.code.length > 0 && seen.has(key);
    if (row.code) {
      if (duplicate) {
        rowIssues.push('duplicate_code');
        issues.push({ row: row.row, reason: 'duplicate_code', code: row.code });
      }
      seen.add(key);
    }

    previewRows.push({
      row: row.row,
      code: row.code,
      name: row.name,
      amount: money.ok ? money.amount : null,
      amountRaw: row.amountRaw,
      issues: rowIssues,
    });

    if (row.code && row.name && money.ok && !duplicate) {
      articles.push({ row: row.row, code: row.code, name: row.name, amount: money.amount });
    }
  }

  const duplicateCodes = new Set(
    issues.filter((issue) => issue.reason === 'duplicate_code').map((issue) => issue.code?.toLowerCase()),
  );
  return {
    articles: articles.filter((article) => !duplicateCodes.has(article.code.toLowerCase())),
    previewRows,
    skipped,
    issues,
  };
}

/**
 * Prefer the real numeric value for Excel number cells.
 * Never use cell.w (display format like "2,556.46") for import.
 */
function sheetMatrix(sheet: XLSX.WorkSheet): unknown[][] {
  const ref = sheet['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const matrix: unknown[][] = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row: unknown[] = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (!cell) {
        row.push('');
        continue;
      }
      if (cell.t === 'n' && typeof cell.v === 'number' && Number.isFinite(cell.v)) {
        row.push(cell.v);
        continue;
      }
      if (typeof cell.v === 'string') {
        row.push(cell.v.trim());
        continue;
      }
      if (cell.v == null) {
        row.push('');
        continue;
      }
      // Boolean / other: stringify value, still avoid formatted w.
      row.push(String(cell.v).trim());
    }
    matrix.push(row);
  }
  return matrix;
}

export function readBudgetPlanWorkbook(data: ArrayBuffer): BudgetPlanParse {
  const book = XLSX.read(data, { type: 'array', cellText: true, cellDates: false });
  const sheet = findImportDataSheet(book, BUDGET_PLAN_IMPORT_SPEC);
  if (!sheet) {
    return {
      articles: [],
      previewRows: [],
      skipped: [],
      issues: [{ row: 1, reason: 'required_code' }],
    };
  }
  return parseBudgetPlanMatrix(sheetMatrix(sheet));
}

export function buildBudgetPlanTemplateBuffer(
  locale: ImportTemplateLocale | string = 'ru',
): ArrayBuffer {
  return buildLocalizedImportWorkbook(BUDGET_PLAN_IMPORT_SPEC, toImportTemplateLocale(locale));
}

export type OpeningTotalIssueReason =
  | 'required_code'
  | 'required_amount'
  | 'unknown_code'
  | 'invalid_amount'
  | 'negative_amount'
  | 'amount_precision'
  | 'duplicate_code';

export type OpeningTotalIssue = {
  row: number;
  reason: OpeningTotalIssueReason;
  code?: string;
  raw?: string;
};

export type OpeningTotalWarning = {
  row: number;
  reason: 'over_plan';
  code: string;
  overBy: number;
};

/** Leaf rows shown in the opening-expenses preview (including invalid / empty amounts). */
export type OpeningTotalPreviewRow = {
  row: number;
  code: string;
  name: string;
  planned: number | null;
  /** Valid spent amount, or null when the cell could not be read as money. */
  amount: number | null;
  amountRaw: string;
  /** planned − amount when both are known; may be negative. Null when amount is missing/invalid. */
  remainder: number | null;
  overPlan: boolean;
  overBy: number | null;
  issues: OpeningTotalIssueReason[];
  warnings: Array<'over_plan'>;
};

export type OpeningTotalParse = {
  rows: Array<{ row: number; code: string; amount: number; overPlan: boolean }>;
  previewRows: OpeningTotalPreviewRow[];
  issues: OpeningTotalIssue[];
  warnings: OpeningTotalWarning[];
};

export function readFirstSheetMatrix(data: ArrayBuffer): unknown[][] {
  const book = XLSX.read(data, { type: 'array', cellText: true, cellDates: false });
  const sheet = findImportDataSheet(book, OPENING_TOTALS_IMPORT_SPEC);
  if (!sheet) return [];
  return sheetMatrix(sheet);
}

export function parseOpeningTotalsMatrix(
  matrix: unknown[][],
  known: Array<{ code: string; planned: number; name?: string }>,
): OpeningTotalParse {
  const empty: OpeningTotalParse = { rows: [], previewRows: [], issues: [], warnings: [] };
  const rowsIn = matrix.filter((row) => row.some((cell) => cellText(cell) !== '' || typeof cell === 'number'));
  if (rowsIn.length === 0) {
    return { ...empty, issues: [{ row: 1, reason: 'required_code' }] };
  }
  const header = rowsIn[0].map((cell) => normHeader(cellText(cell)));
  const codeAt = header.findIndex((cell) => headerMatches(CODE_HEADER_SET, cell));
  const nameAt = header.findIndex((cell) => headerMatches(NAME_HEADER_SET, cell));
  const amountAt = header.findIndex((cell) => headerMatches(AMOUNT_HEADER_SET, cell));
  if (codeAt < 0 || amountAt < 0) {
    return { ...empty, issues: [{ row: 1, reason: 'required_code' }] };
  }

  const byCode = new Map(known.map((item) => [item.code.toLowerCase(), item]));
  const issues: OpeningTotalIssue[] = [];
  const warnings: OpeningTotalWarning[] = [];
  const rows: OpeningTotalParse['rows'] = [];
  const previewRows: OpeningTotalPreviewRow[] = [];
  const seen = new Set<string>();

  rowsIn.slice(1).forEach((row, index) => {
    const line = index + 2;
    const code = cellText(row[codeAt]);
    const fileName = nameAt >= 0 ? cellText(row[nameAt]) : '';
    const amountCell = row[amountAt];
    const amountRaw = amountRawDisplay(amountCell);
    if (!code && !amountRaw && !fileName) return;

    const rowIssues: OpeningTotalIssueReason[] = [];
    if (!code) {
      rowIssues.push('required_code');
      issues.push({ row: line, reason: 'required_code' });
    }

    const key = code.toLowerCase();
    const duplicate = code.length > 0 && seen.has(key);
    if (code) {
      if (duplicate) {
        rowIssues.push('duplicate_code');
        issues.push({ row: line, reason: 'duplicate_code', code });
      }
      seen.add(key);
    }

    const money = parseMoneyCell(amountCell);
    if (!money.ok) {
      rowIssues.push(money.reason);
      issues.push({
        row: line,
        reason: money.reason,
        code: code || undefined,
        raw: money.raw,
      });
    }

    const knownRow = code ? byCode.get(key) : undefined;
    if (code && !knownRow && !duplicate) {
      rowIssues.push('unknown_code');
      issues.push({ row: line, reason: 'unknown_code', code });
    }

    const planned = knownRow != null ? knownRow.planned : null;
    const amount = money.ok ? money.amount : null;
    const overPlan =
      amount != null && planned != null && amount - planned > 0.000001;
    const overBy = overPlan && amount != null && planned != null ? amount - planned : null;
    const remainder = amount != null && planned != null ? planned - amount : null;
    const rowWarnings: Array<'over_plan'> = overPlan ? ['over_plan'] : [];

    if (overPlan && code && overBy != null) {
      warnings.push({ row: line, reason: 'over_plan', code: knownRow?.code ?? code, overBy });
    }

    previewRows.push({
      row: line,
      code: knownRow?.code ?? code,
      name: (knownRow?.name && knownRow.name.trim()) || fileName,
      planned,
      amount,
      amountRaw,
      remainder,
      overPlan,
      overBy,
      issues: rowIssues,
      warnings: rowWarnings,
    });

    if (code && knownRow && money.ok && !duplicate) {
      rows.push({
        row: line,
        code: knownRow.code,
        amount: money.amount,
        overPlan,
      });
    }
  });

  return { rows, previewRows, issues, warnings };
}

const OPENING_STRUCTURAL_ISSUES: OpeningTotalIssueReason[] = [
  'required_code',
  'unknown_code',
  'duplicate_code',
];

/** Editable amount baseline for a parsed preview row (empty stays empty). */
export function openingAmountEditBaseline(row: OpeningTotalPreviewRow): string {
  if (row.amount != null) return String(row.amount);
  return row.amountRaw.trim() === '' ? '' : row.amountRaw;
}

/**
 * Recompute one opening preview row after an in-table amount edit.
 * Structural issues (missing/unknown/duplicate code) are preserved from the file parse.
 */
export function applyOpeningAmountDraft(
  base: OpeningTotalPreviewRow,
  draftRaw: string,
): OpeningTotalPreviewRow {
  const structural = base.issues.filter((reason) => OPENING_STRUCTURAL_ISSUES.includes(reason));
  const display = draftRaw;
  const money = parseMoneyCell(draftRaw.trim() === '' ? '' : draftRaw);
  const amountIssues: OpeningTotalIssueReason[] = [];
  if (!money.ok) amountIssues.push(money.reason);

  const amount = money.ok ? money.amount : null;
  const planned = base.planned;
  const overPlan = amount != null && planned != null && amount - planned > 0.000001;
  const overBy = overPlan && amount != null && planned != null ? amount - planned : null;
  const remainder = amount != null && planned != null ? planned - amount : null;

  return {
    ...base,
    amount,
    amountRaw: money.ok ? String(money.amount) : display,
    remainder,
    overPlan,
    overBy,
    issues: [...structural, ...amountIssues],
    warnings: overPlan ? ['over_plan'] : [],
  };
}

/** Rebuild importable rows / issues / warnings from edited preview rows. */
export function rebuildOpeningTotalParse(previewRows: OpeningTotalPreviewRow[]): OpeningTotalParse {
  const issues: OpeningTotalIssue[] = [];
  const warnings: OpeningTotalWarning[] = [];
  const rows: OpeningTotalParse['rows'] = [];

  for (const row of previewRows) {
    for (const reason of row.issues) {
      issues.push({
        row: row.row,
        reason,
        code: row.code || undefined,
        raw: row.amountRaw,
      });
    }
    if (row.overPlan && row.code && row.overBy != null) {
      warnings.push({ row: row.row, reason: 'over_plan', code: row.code, overBy: row.overBy });
    }
    const blocking = row.issues.length > 0;
    const structuralBlock = row.issues.some((reason) => OPENING_STRUCTURAL_ISSUES.includes(reason));
    if (!blocking && row.amount != null && row.code && !structuralBlock) {
      rows.push({
        row: row.row,
        code: row.code,
        amount: row.amount,
        overPlan: row.overPlan,
      });
    }
  }

  return { rows, previewRows, issues, warnings };
}

export function buildOpeningTotalsTemplateBuffer(
  categories: Array<{ code: string; name: string; planned: number }>,
  locale: ImportTemplateLocale | string = 'ru',
): ArrayBuffer {
  return buildLocalizedImportWorkbookWithRows(
    OPENING_TOTALS_IMPORT_SPEC,
    toImportTemplateLocale(locale),
    categories.map((category) => ({ code: category.code, name: category.name, amount: '' })),
  );
}
