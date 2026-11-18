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
  buildBudgetPlanTemplateBuffer as buildBudgetPlanTemplateFromSpec,
  buildLocalizedImportWorkbookWithRows,
  columnHeaderCandidates,
  findImportDataSheet,
  normalizeImportHeader,
  toImportTemplateLocale,
  type BudgetCatalogSeed,
  type ImportTemplateLocale,
} from '@/lib/importTemplates';

export type { BudgetCatalogSeed };

export const BUDGET_PLAN_CODE = 'Код статьи';
export const BUDGET_PLAN_GROUP = 'Группа';
export const BUDGET_PLAN_SUBGROUP = 'Подгруппа';
export const BUDGET_PLAN_NAME = 'Статья бюджета';
export const BUDGET_PLAN_AMOUNT = 'Плановая сумма, EUR';

const CODE_HEADERS = ['код статьи', 'category code', 'код на статията', 'article code', 'code'];
const GROUP_HEADERS = ['группа', 'група', 'group', 'group name', 'group_name'];
const SUBGROUP_HEADERS = [
  'подгруппа',
  'подгрупа',
  'subgroup',
  'subgroup name',
  'subgroup_name',
];
const NAME_HEADERS = [
  'статья бюджета',
  'статия на бюджета',
  'название статьи',
  'category name',
  'budget article',
  'наименование',
  'name',
];
const AMOUNT_HEADERS = [
  'плановая сумма, eur',
  'планова сума, eur',
  'planned amount, eur',
  'план на год, eur',
  'annual plan, eur',
  'план за годината, eur',
  'уже израсходовано, eur',
  'already spent, eur',
  'вече изразходвано, eur',
  'amount',
];

function headerSetFor(
  legacy: string[],
  key: 'code' | 'group' | 'subgroup' | 'name' | 'amount',
): Set<string> {
  const out = new Set(legacy.map((h) => normalizeImportHeader(h)));
  for (const spec of [BUDGET_PLAN_IMPORT_SPEC, OPENING_TOTALS_IMPORT_SPEC]) {
    const col = spec.columns.find((c) => c.key === key);
    if (!col) continue;
    for (const cand of columnHeaderCandidates(col)) out.add(cand);
  }
  return out;
}

const CODE_HEADER_SET = headerSetFor(CODE_HEADERS, 'code');
const GROUP_HEADER_SET = headerSetFor(GROUP_HEADERS, 'group');
const SUBGROUP_HEADER_SET = headerSetFor(SUBGROUP_HEADERS, 'subgroup');
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
  group: string;
  subgroup: string;
  amount: number;
};

export type BudgetPlanSkip = {
  row: number;
  reason: 'section' | 'total' | 'empty';
};

export type BudgetPlanIssueReason =
  | 'required_code'
  | 'required_name'
  | 'required_group'
  | 'required_amount'
  | 'invalid_amount'
  | 'negative_amount'
  | 'amount_precision'
  | 'duplicate_code'
  | 'duplicate_article'
  | 'unknown_code'
  | 'unknown_article'
  | 'ambiguous_article'
  | 'name_mismatch'
  | 'group_mismatch'
  | 'subgroup_mismatch';

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
  group: string;
  subgroup: string;
  /** Valid amount, or null when blank / invalid. */
  amount: number | null;
  /** True when the amount cell was empty (preserve existing plan — do not zero). */
  amountBlank: boolean;
  /** Original amount cell for display when invalid. */
  amountRaw: string;
  issues: BudgetPlanIssueReason[];
  /** Existing plan amount for this code/path when known (client enrich). */
  priorAmount?: number | null;
  action?: BudgetPreviewAction;
  /** True when Group→Subgroup→Article is not in the catalog and will be created on confirm. */
  willCreate?: boolean;
  /** Same article title exists elsewhere in the catalog — hint only, never auto-merged. */
  similarNames?: string[];
};

export type BudgetPlanParse = {
  articles: BudgetPlanArticle[];
  previewRows: BudgetPlanPreviewRow[];
  skipped: BudgetPlanSkip[];
  issues: BudgetPlanIssue[];
};

export type BudgetCatalogMatch = {
  code: string;
  name_ru: string;
  name_en: string;
  name_bg: string;
  group_code?: string | null;
  group_name_ru?: string | null;
  group_name_en?: string | null;
  group_name_bg?: string | null;
  subgroup_code?: string | null;
  subgroup_name_ru?: string | null;
  subgroup_name_en?: string | null;
  subgroup_name_bg?: string | null;
};

export type BudgetPreviewSubgroup = {
  key: string;
  label: string;
  rows: BudgetPlanPreviewRow[];
  total: number;
  priorTotal: number | null;
};

export type BudgetPreviewGroup = {
  key: string;
  label: string;
  /** Articles with no subgroup — shown directly under the group. */
  directRows: BudgetPlanPreviewRow[];
  subgroups: BudgetPreviewSubgroup[];
  /** Flat leaf rows (direct + nested) for callers that need a simple list. */
  rows: BudgetPlanPreviewRow[];
  /** Sum of valid (non-blank) article amounts in the group. */
  total: number;
  priorTotal: number | null;
};

/** Collapse NBSP / unicode spaces for matching only — never rewrite displayed labels. */
export function normMatch(value: string): string {
  return value
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Path identity: Group → Subgroup → Article (empty subgroup is distinct). */
export function budgetArticlePathKey(group: string, subgroup: string, name: string): string {
  return `${normMatch(group)}|${normMatch(subgroup)}|${normMatch(name)}`;
}

/** Display text: NBSP→space and trim ends only (no typo/collapse fixes). */
export function displayBudgetLabel(value: string): string {
  return value.replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ').trim();
}

/** Same article title under other branches — informational, never auto-merged. */
export function findSimilarBudgetArticleNames(
  catalog: BudgetCatalogMatch[],
  name: string,
  locale: string = 'ru',
  excludePath?: { group: string; subgroup: string },
): string[] {
  const n = normMatch(name);
  if (!n) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const cat of catalog) {
    if (!catalogNames(cat).includes(n)) continue;
    if (
      excludePath &&
      catalogGroupDisplayNames(cat).includes(normMatch(excludePath.group)) &&
      (normMatch(excludePath.subgroup)
        ? catalogSubgroups(cat).includes(normMatch(excludePath.subgroup))
        : catalogHasEmptySubgroup(cat))
    ) {
      continue;
    }
    const label = catalogArticleLabel(cat, locale);
    const group = catalogGroupLabel(cat, locale);
    const subgroup = catalogSubgroupLabel(cat, locale);
    const path = subgroup ? `${group} → ${subgroup} → ${label}` : `${group} → ${label}`;
    const key = normMatch(path);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(path);
    if (out.length >= 3) break;
  }
  return out;
}

function catalogNames(cat: BudgetCatalogMatch): string[] {
  return [cat.name_ru, cat.name_en, cat.name_bg].map((v) => normMatch(v)).filter(Boolean);
}

function catalogGroups(cat: BudgetCatalogMatch): string[] {
  return [cat.group_code, cat.group_name_ru, cat.group_name_en, cat.group_name_bg]
    .map((v) => normMatch(String(v ?? '')))
    .filter(Boolean);
}

function catalogSubgroups(cat: BudgetCatalogMatch): string[] {
  return [cat.subgroup_code, cat.subgroup_name_ru, cat.subgroup_name_en, cat.subgroup_name_bg]
    .map((v) => normMatch(String(v ?? '')))
    .filter(Boolean);
}

function catalogHasEmptySubgroup(cat: BudgetCatalogMatch): boolean {
  return catalogSubgroups(cat).length === 0;
}

function catalogGroupLabel(cat: BudgetCatalogMatch, locale: string): string {
  const loc = String(locale || 'ru').toLowerCase();
  // Never surface internal group_code to the user.
  if (loc.startsWith('bg')) {
    return cat.group_name_bg?.trim() || cat.group_name_ru?.trim() || cat.group_name_en?.trim() || '';
  }
  if (loc.startsWith('en')) {
    return cat.group_name_en?.trim() || cat.group_name_ru?.trim() || cat.group_name_bg?.trim() || '';
  }
  return cat.group_name_ru?.trim() || cat.group_name_en?.trim() || cat.group_name_bg?.trim() || '';
}

function catalogSubgroupLabel(cat: BudgetCatalogMatch, locale: string): string {
  const loc = String(locale || 'ru').toLowerCase();
  if (loc.startsWith('bg')) {
    return cat.subgroup_name_bg?.trim() || cat.subgroup_name_ru?.trim() || cat.subgroup_name_en?.trim() || '';
  }
  if (loc.startsWith('en')) {
    return cat.subgroup_name_en?.trim() || cat.subgroup_name_ru?.trim() || cat.subgroup_name_bg?.trim() || '';
  }
  return cat.subgroup_name_ru?.trim() || cat.subgroup_name_en?.trim() || cat.subgroup_name_bg?.trim() || '';
}

function catalogArticleLabel(cat: BudgetCatalogMatch, locale: string): string {
  const loc = String(locale || 'ru').toLowerCase();
  // Never fall back to internal article code in UI.
  if (loc.startsWith('bg')) return cat.name_bg || cat.name_ru || cat.name_en || '';
  if (loc.startsWith('en')) return cat.name_en || cat.name_ru || cat.name_bg || '';
  return cat.name_ru || cat.name_en || cat.name_bg || '';
}

function catalogGroupDisplayNames(cat: BudgetCatalogMatch): string[] {
  return [cat.group_name_ru, cat.group_name_en, cat.group_name_bg]
    .map((v) => normMatch(String(v ?? '')))
    .filter(Boolean);
}

/**
 * Match by full path Group → Subgroup → Article when the subgroup column is present.
 * Empty subgroup matches only catalog rows without a subgroup.
 * Legacy (no subgroup column): match by group + name; unique hit fills subgroup from catalog.
 */
export function matchBudgetCatalogByPath(
  catalog: BudgetCatalogMatch[],
  group: string,
  subgroup: string,
  name: string,
  opts: { subgroupColumnPresent: boolean } = { subgroupColumnPresent: true },
): BudgetCatalogMatch[] {
  const g = normMatch(group);
  const s = normMatch(subgroup);
  const n = normMatch(name);
  if (!n) return [];
  return catalog.filter((cat) => {
    if (!catalogNames(cat).includes(n)) return false;
    if (g && !catalogGroupDisplayNames(cat).includes(g)) return false;
    if (!opts.subgroupColumnPresent) return true;
    if (!s) return catalogHasEmptySubgroup(cat);
    return catalogSubgroups(cat).includes(s);
  });
}

/** @deprecated Prefer matchBudgetCatalogByPath — kept for call sites / tests. */
export function matchBudgetCatalogByGroupName(
  catalog: BudgetCatalogMatch[],
  group: string,
  name: string,
): BudgetCatalogMatch[] {
  return matchBudgetCatalogByPath(catalog, group, '', name, { subgroupColumnPresent: false });
}

/**
 * Resolve articles against the catalog.
 * - Current template: match by Group → Subgroup → Article; ambiguity is an error.
 * - Unmatched paths are allowed: preview «will create», persist only on confirm.
 * - Legacy files without subgroup: match by group + name when unique.
 * - Legacy files with a code column: match by code; optional group/subgroup/name must agree.
 * Never pick arbitrarily among ambiguous matches; never rewrite user labels for new rows.
 */
export function validateBudgetPlanAgainstCatalog(
  parsed: BudgetPlanParse,
  catalog: BudgetCatalogMatch[],
  locale: string = 'ru',
  opts: { subgroupColumnPresent?: boolean } = {},
): BudgetPlanParse {
  const subgroupColumnPresent = opts.subgroupColumnPresent ?? true;
  const byCode = new Map(catalog.map((c) => [c.code.trim().toLowerCase(), c]));
  const issues: BudgetPlanIssue[] = [];
  const previewRows: BudgetPlanPreviewRow[] = parsed.previewRows.map((row) => {
    const rowIssues: BudgetPlanIssueReason[] = [...row.issues];
    const key = row.code.trim().toLowerCase();
    let cat = key ? byCode.get(key) : undefined;
    // Preserve file labels for new articles; catalog labels only when matched.
    let group = displayBudgetLabel(row.group);
    let subgroup = displayBudgetLabel(row.subgroup);
    let name = displayBudgetLabel(row.name);
    let code = row.code;
    let willCreate = false;
    let similarNames: string[] | undefined;

    if (key) {
      // Legacy / code-bearing file — codes must already exist (no inventing codes).
      if (!cat) {
        if (!rowIssues.includes('unknown_code')) rowIssues.push('unknown_code');
      } else {
        if (row.name && !catalogNames(cat).includes(normMatch(row.name))) {
          if (!rowIssues.includes('name_mismatch')) rowIssues.push('name_mismatch');
        } else if (!row.name) {
          name = catalogArticleLabel(cat, locale);
        }
        if (row.group && !catalogGroups(cat).includes(normMatch(row.group))) {
          if (!rowIssues.includes('group_mismatch')) rowIssues.push('group_mismatch');
        } else if (!row.group) {
          group = catalogGroupLabel(cat, locale);
        }
        if (row.subgroup && !catalogSubgroups(cat).includes(normMatch(row.subgroup))) {
          if (!rowIssues.includes('subgroup_mismatch')) rowIssues.push('subgroup_mismatch');
        } else if (!row.subgroup) {
          subgroup = catalogSubgroupLabel(cat, locale);
        }
        code = cat.code;
      }
    } else {
      // Current / human template: path → catalog code, or create on confirm.
      if (!row.name) {
        if (!rowIssues.includes('required_name')) rowIssues.push('required_name');
      }
      if (!row.group) {
        if (!rowIssues.includes('required_group')) rowIssues.push('required_group');
      }
      if (row.name && row.group) {
        const hits = matchBudgetCatalogByPath(catalog, row.group, row.subgroup, row.name, {
          subgroupColumnPresent,
        });
        if (hits.length === 0) {
          willCreate = true;
          similarNames = findSimilarBudgetArticleNames(catalog, row.name, locale, {
            group: row.group,
            subgroup: row.subgroup,
          });
        } else if (hits.length > 1) {
          if (!rowIssues.includes('ambiguous_article')) rowIssues.push('ambiguous_article');
        } else {
          cat = hits[0];
          code = cat.code;
          // Matched: keep catalog labels for consistency with the reference.
          group = catalogGroupLabel(cat, locale) || group;
          subgroup = catalogSubgroupLabel(cat, locale);
          name = catalogArticleLabel(cat, locale) || name;
        }
      }
    }

    for (const reason of rowIssues) {
      issues.push({
        row: row.row,
        reason,
        code: code || undefined,
        raw: row.amountRaw,
      });
    }

    return {
      ...row,
      code,
      group,
      subgroup,
      name,
      issues: rowIssues,
      willCreate,
      similarNames,
    };
  });

  const blocking = new Set(previewRows.filter((r) => r.issues.length > 0).map((r) => r.row));
  const articles = parsed.articles
    .filter((a) => !blocking.has(a.row))
    .map((a) => {
      const preview = previewRows.find((r) => r.row === a.row);
      return {
        ...a,
        code: preview?.code || a.code,
        group: preview?.group ?? a.group,
        subgroup: preview?.subgroup ?? a.subgroup,
        name: preview?.name ?? a.name,
      };
    })
    // Matched rows need a code; new rows may have empty code (server creates on confirm).
    .filter((a) => a.name.trim().length > 0 && a.group.trim().length > 0);

  return {
    articles,
    previewRows,
    skipped: parsed.skipped,
    issues,
  };
}

/** Attach create/update/unchanged/skip actions from existing plan amounts by code and/or path. */
export function enrichBudgetPreviewWithExisting(
  parsed: BudgetPlanParse,
  existingByCode: Map<string, number>,
  existingByPath?: Map<string, number>,
): BudgetPlanParse {
  const previewRows = parsed.previewRows.map((row) => {
    const key = row.code.trim().toLowerCase();
    const pathKey = budgetArticlePathKey(row.group, row.subgroup, row.name);
    let prior: number | null = null;
    if (key && existingByCode.has(key)) prior = existingByCode.get(key) ?? 0;
    else if (existingByPath?.has(pathKey)) prior = existingByPath.get(pathKey) ?? 0;

    if (row.issues.length > 0) {
      return { ...row, priorAmount: prior, action: 'error' as BudgetPreviewAction };
    }
    if (row.amountBlank) {
      // Blank amount never zeros an existing plan and is not imported.
      return {
        ...row,
        priorAmount: prior,
        action: 'unchanged' as BudgetPreviewAction,
      };
    }
    if (row.amount == null) {
      return { ...row, priorAmount: prior, action: 'error' as BudgetPreviewAction };
    }
    if (prior == null) {
      return {
        ...row,
        priorAmount: null,
        action: 'create' as BudgetPreviewAction,
        willCreate: row.willCreate || !key,
      };
    }
    const same = Math.abs(prior - row.amount) < 0.0001;
    return {
      ...row,
      priorAmount: prior,
      action: (same ? 'unchanged' : 'update') as BudgetPreviewAction,
      willCreate: false,
    };
  });
  return { ...parsed, previewRows };
}

function addAmountToTotals(
  target: { total: number; priorTotal: number | null },
  row: BudgetPlanPreviewRow,
): void {
  if (row.amount != null && Number.isFinite(row.amount)) {
    target.total += row.amount;
  }
  if (row.priorAmount != null && Number.isFinite(row.priorAmount)) {
    target.priorTotal = (target.priorTotal ?? 0) + row.priorAmount;
  }
}

/** Nested preview: Group → Subgroup → Article (empty subgroup = direct under group). */
export function buildBudgetPreviewGroups(previewRows: BudgetPlanPreviewRow[]): {
  groups: BudgetPreviewGroup[];
  grandTotal: number;
  priorGrandTotal: number | null;
} {
  const order: string[] = [];
  const map = new Map<string, BudgetPreviewGroup>();
  for (const row of previewRows) {
    const label = row.group.trim() || '—';
    const key = normMatch(label) || '_';
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        label,
        directRows: [],
        subgroups: [],
        rows: [],
        total: 0,
        priorTotal: null,
      };
      map.set(key, group);
      order.push(key);
    }
    group.rows.push(row);
    addAmountToTotals(group, row);

    const subLabel = row.subgroup.trim();
    if (!subLabel) {
      group.directRows.push(row);
      continue;
    }
    const subKey = normMatch(subLabel) || '_';
    let sub = group.subgroups.find((s) => s.key === subKey);
    if (!sub) {
      sub = { key: subKey, label: subLabel, rows: [], total: 0, priorTotal: null };
      group.subgroups.push(sub);
    }
    sub.rows.push(row);
    addAmountToTotals(sub, row);
  }
  const groups = order.map((k) => map.get(k)!);
  const grandTotal = groups.reduce((s, g) => s + g.total, 0);
  const anyPrior = groups.some((g) => g.priorTotal != null);
  const priorGrandTotal = anyPrior
    ? groups.reduce((s, g) => s + (g.priorTotal ?? 0), 0)
    : null;
  return { groups, grandTotal, priorGrandTotal };
}

export function presentBudgetPreviewAction(
  action: BudgetPreviewAction | undefined,
  t: (key: string) => string,
): string {
  if (action === 'create') return t('admin.firstRunBudgetImportWillCreate');
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
  return displayBudgetLabel(String(value));
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

export type BudgetPlanParseMeta = {
  subgroupColumnPresent: boolean;
};

export function parseBudgetPlanMatrix(matrix: unknown[][]): BudgetPlanParse & BudgetPlanParseMeta {
  const rows = matrix.filter((row) => row.some((cell) => cellText(cell) !== '' || typeof cell === 'number'));
  if (rows.length === 0) {
    return { articles: [], previewRows: [], skipped: [], issues: [], subgroupColumnPresent: false };
  }
  const header = rows[0].map((cell) => normHeader(cellText(cell)));
  const codeAt = header.findIndex((cell) => headerMatches(CODE_HEADER_SET, cell));
  const groupAt = header.findIndex((cell) => headerMatches(GROUP_HEADER_SET, cell));
  const subgroupAt = header.findIndex((cell) => headerMatches(SUBGROUP_HEADER_SET, cell));
  const nameAt = header.findIndex((cell) => headerMatches(NAME_HEADER_SET, cell));
  const amountAt = header.findIndex((cell) => headerMatches(AMOUNT_HEADER_SET, cell));
  const subgroupColumnPresent = subgroupAt >= 0;
  // Current template: Group + Subgroup + Article + Amount (no code).
  // Legacy: Code + Name + Amount (group/subgroup optional) or older 3/4-column shapes.
  const modern = codeAt < 0 && groupAt >= 0 && nameAt >= 0 && amountAt >= 0;
  const legacy = codeAt >= 0 && nameAt >= 0 && amountAt >= 0;
  if (!modern && !legacy) {
    return {
      articles: [],
      previewRows: [],
      skipped: [],
      issues: [{ row: 1, reason: modern || groupAt >= 0 ? 'required_name' : 'required_group' }],
      subgroupColumnPresent,
    };
  }

  const body = rows.slice(1).map((row, index) => ({
    row: index + 2,
    code: codeAt >= 0 ? cellText(row[codeAt]) : '',
    group: groupAt >= 0 ? cellText(row[groupAt]) : '',
    subgroup: subgroupAt >= 0 ? cellText(row[subgroupAt]) : '',
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
  const seenCodes = new Set<string>();
  const seenArticles = new Set<string>();

  for (const row of body) {
    if (!row.code && !row.name && !row.group && !row.subgroup && !row.amountRaw) {
      skipped.push({ row: row.row, reason: 'empty' });
      continue;
    }
    if (isTotalLabel(row.code, row.name) || isTotalLabel(row.group, '') || isTotalLabel(row.subgroup, '')) {
      skipped.push({ row: row.row, reason: 'total' });
      continue;
    }
    if (row.code && isParent(row.code)) {
      skipped.push({ row: row.row, reason: 'section' });
      continue;
    }

    const rowIssues: BudgetPlanIssueReason[] = [];
    if (legacy && !modern && !row.code) {
      // Legacy code-bearing header: empty code is an error.
      rowIssues.push('required_code');
      issues.push({ row: row.row, reason: 'required_code' });
    }
    if (!row.name) {
      rowIssues.push('required_name');
      issues.push({ row: row.row, reason: 'required_name', code: row.code || undefined });
    }
    if (modern && !row.group) {
      rowIssues.push('required_group');
      issues.push({ row: row.row, reason: 'required_group' });
    }

    const money = parseMoneyCell(row.amountCell);
    let amount: number | null = null;
    let amountBlank = false;
    if (money.ok) {
      amount = money.amount;
    } else if (money.reason === 'required_amount') {
      // Blank planned amount: preview-only preserve — do not treat as an error or zero.
      amountBlank = true;
    } else {
      rowIssues.push(money.reason);
      issues.push({
        row: row.row,
        reason: money.reason,
        code: row.code || undefined,
        raw: money.raw,
      });
    }

    let duplicate = false;
    if (row.code) {
      const key = row.code.toLowerCase();
      duplicate = seenCodes.has(key);
      if (duplicate) {
        rowIssues.push('duplicate_code');
        issues.push({ row: row.row, reason: 'duplicate_code', code: row.code });
      }
      seenCodes.add(key);
    } else if (row.group && row.name) {
      const key = `${normMatch(row.group)}|${normMatch(row.subgroup)}|${normMatch(row.name)}`;
      duplicate = seenArticles.has(key);
      if (duplicate) {
        rowIssues.push('duplicate_article');
        issues.push({ row: row.row, reason: 'duplicate_article' });
      }
      seenArticles.add(key);
    }

    previewRows.push({
      row: row.row,
      code: row.code,
      name: row.name,
      group: row.group,
      subgroup: row.subgroup,
      amount,
      amountBlank,
      amountRaw: row.amountRaw,
      issues: rowIssues,
    });

    // Articles with a code can commit after catalog validation; modern rows get a code later.
    if (row.name && money.ok && !duplicate && (row.code || (modern && row.group))) {
      articles.push({
        row: row.row,
        code: row.code,
        name: row.name,
        group: row.group,
        subgroup: row.subgroup,
        amount: money.amount,
      });
    }
  }

  const duplicateCodes = new Set(
    issues.filter((issue) => issue.reason === 'duplicate_code').map((issue) => issue.code?.toLowerCase()),
  );
  return {
    articles: articles.filter(
      (article) => !article.code || !duplicateCodes.has(article.code.toLowerCase()),
    ),
    previewRows,
    skipped,
    issues,
    subgroupColumnPresent,
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

export function readBudgetPlanWorkbook(data: ArrayBuffer): BudgetPlanParse & BudgetPlanParseMeta {
  const book = XLSX.read(data, { type: 'array', cellText: true, cellDates: false });
  const sheet = findImportDataSheet(book, BUDGET_PLAN_IMPORT_SPEC);
  if (!sheet) {
    return {
      articles: [],
      previewRows: [],
      skipped: [],
      issues: [{ row: 1, reason: 'required_code' }],
      subgroupColumnPresent: false,
    };
  }
  return parseBudgetPlanMatrix(sheetMatrix(sheet));
}

export function buildBudgetPlanTemplateBuffer(
  locale: ImportTemplateLocale | string = 'ru',
  catalogRows?: BudgetCatalogSeed[],
): ArrayBuffer {
  return buildBudgetPlanTemplateFromSpec(locale, catalogRows);
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
