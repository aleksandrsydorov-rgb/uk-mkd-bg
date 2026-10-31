/**
 * Task 15 — reporting scope filters (UI + PDF). No finance math.
 */

export type ReportPropertyScope = 'all' | number;
export type ReportExpenseCategoryScope = 'all' | 'none' | string;
export type ReportGroupScope = 'all' | 'overview' | 'support_fee' | 'capital' | 'utilities' | 'ops';

export function parseReportPropertyScope(raw: string): ReportPropertyScope {
  if (raw === 'all' || raw === '') return 'all';
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 'all';
}

export function filterPropertiesByScope<T extends { id: number }>(
  properties: T[],
  scope: ReportPropertyScope,
): T[] {
  if (scope === 'all') return properties;
  return properties.filter((p) => p.id === scope);
}

export function filterRowsByPropertyScope<T>(
  rows: T[],
  scope: ReportPropertyScope,
  propertyIdOf: (row: T) => number | null | undefined,
): T[] {
  if (scope === 'all') return rows;
  return rows.filter((row) => propertyIdOf(row) === scope);
}

export function filterExpenseRowsByCategoryScope<T extends { budget_category_id?: string | null }>(
  rows: T[],
  scope: ReportExpenseCategoryScope,
): T[] {
  if (scope === 'all') return rows;
  if (scope === 'none') return rows.filter((r) => !r.budget_category_id);
  return rows.filter((r) => String(r.budget_category_id ?? '') === scope);
}

export function filterBalanceMapByPropertyScope<T>(
  map: Map<number, T> | null,
  scope: ReportPropertyScope,
): Map<number, T> | null {
  if (!map) return null;
  if (scope === 'all') return map;
  const next = new Map<number, T>();
  const hit = map.get(scope);
  if (hit !== undefined) next.set(scope, hit);
  return next;
}

export function reportScopeMatchesGroup(
  cardCategory: Exclude<ReportGroupScope, 'all'>,
  groupScope: ReportGroupScope,
): boolean {
  return groupScope === 'all' || groupScope === cardCategory;
}

/** Stable filter fingerprint for PDF header / filename (not finance). */
export function reportFilterFingerprint(args: {
  year: number | string;
  quarter: number;
  propertyScope: ReportPropertyScope;
  expenseCategoryScope: ReportExpenseCategoryScope;
}): string {
  const q = args.quarter === 0 ? 'y' : `q${args.quarter}`;
  const apt = args.propertyScope === 'all' ? 'all' : `p${args.propertyScope}`;
  const cat = args.expenseCategoryScope === 'all' ? 'cat-all' : `cat-${args.expenseCategoryScope}`;
  return `${args.year}-${q}-${apt}-${cat}`;
}
