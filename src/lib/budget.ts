/** Budget module helpers. UX only — RPCs are the security boundary. */

export const BUDGET_YEAR_STATUSES = ['draft', 'published', 'adopted', 'closed'] as const;
export type BudgetYearStatus = (typeof BUDGET_YEAR_STATUSES)[number];

export type BudgetCategory = {
  id: string;
  code: string;
  name_ru: string;
  name_en: string;
  name_bg: string;
  sort_order?: number;
  active?: boolean;
};

export type BudgetYear = {
  id: string;
  calendar_year: number;
  status: string;
  title: string | null;
  decision_note: string | null;
  decision_id: string | null;
  published_at: string | null;
  adopted_at: string | null;
  closed_at: string | null;
  created_at?: string;
};

export type BudgetLineRow = {
  id: string;
  year_id: string;
  category_id: string;
  category_code: string;
  category_name_ru: string;
  planned_amount_eur: number;
  note: string | null;
};

export type BudgetExecutionRow = {
  category_id: string;
  category_code: string;
  category_name_ru: string;
  planned_amount_eur: number;
  expenses_amount_eur?: number;
  adjustments_amount_eur?: number;
  actual_amount_eur: number;
  remaining_amount_eur: number;
};

export type BudgetAdjustment = {
  id: string;
  year_id: string;
  category_id: string;
  amount_eur: number;
  reason: string;
  created_by_email: string | null;
  created_at: string;
};

export type OwnerBudgetPayload = {
  year: {
    id: string;
    calendar_year: number;
    status: string;
    title: string | null;
    decision_note: string | null;
    published_at: string | null;
    adopted_at: string | null;
    closed_at: string | null;
  } | null;
  calendar_year: number;
  lines: Array<{
    category_id: string;
    category_code: string;
    category_name_ru: string;
    category_name_en: string;
    category_name_bg: string;
    planned_amount_eur: number;
  }>;
  execution: Array<{
    category_id: string;
    category_code: string;
    category_name_ru: string;
    category_name_en?: string;
    category_name_bg?: string;
    planned_amount_eur: number;
    actual_amount_eur: number;
    remaining_amount_eur: number;
  }>;
};

export function canSeeBudgetAdmin(role?: string | null) {
  return role === 'администрация' || role === 'бухгалтер';
}

export function budgetStatusTone(
  status: string,
): 'warning' | 'info' | 'success' | 'danger' | 'neutral' {
  if (status === 'draft') return 'warning';
  if (status === 'published') return 'info';
  if (status === 'adopted') return 'success';
  if (status === 'closed') return 'neutral';
  return 'neutral';
}

export function categoryLabel(
  cat: Pick<BudgetCategory, 'name_ru' | 'name_en' | 'name_bg'> | null | undefined,
  locale: string,
) {
  if (!cat) return '—';
  if (locale.startsWith('en')) return cat.name_en || cat.name_ru;
  if (locale.startsWith('bg')) return cat.name_bg || cat.name_ru;
  return cat.name_ru;
}

export function moneyEur(n: number | null | undefined) {
  const v = Number(n ?? 0);
  return `${v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** Soft overspend: remaining can go negative; no hard RPC block in R1.0. */
export function isBudgetOverspent(remainingAmountEur: number | null | undefined): boolean {
  return Number(remainingAmountEur ?? 0) < -1e-9;
}

/** Deterministic planned / actual / remaining from execution rows (admin_budget_execution shape). */
export function sumBudgetExecutionTotals(
  rows: Array<Pick<BudgetExecutionRow, 'planned_amount_eur' | 'actual_amount_eur'>>,
): { planned: number; actual: number; remaining: number; overspent: boolean } {
  const planned = rows.reduce((s, r) => s + Number(r.planned_amount_eur ?? 0), 0);
  const actual = rows.reduce((s, r) => s + Number(r.actual_amount_eur ?? 0), 0);
  const remaining = planned - actual;
  return { planned, actual, remaining, overspent: isBudgetOverspent(remaining) };
}

export function budgetExecutionOverspendCategories(
  rows: Array<Pick<BudgetExecutionRow, 'category_id' | 'category_name_ru' | 'remaining_amount_eur'>>,
): Array<{ category_id: string; category_name_ru: string; remaining_amount_eur: number }> {
  return rows
    .filter((r) => isBudgetOverspent(r.remaining_amount_eur))
    .map((r) => ({
      category_id: r.category_id,
      category_name_ru: r.category_name_ru,
      remaining_amount_eur: Number(r.remaining_amount_eur),
    }));
}

/** Operational uk_expenses soft duplicate key (P1-UK). Opening path uses source_ref separately. */
export type UkExpenseDuplicateCandidate = {
  id?: number | null;
  expense_date: string;
  title: string;
  amount: number;
};

function normalizeExpenseTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeExpenseAmount(amount: number): number {
  return Math.round(Number(amount) * 100) / 100;
}

/**
 * Soft business-key match for manual expense inserts.
 * Does not enforce DB uniqueness — UI confirm only (hard unique = financial NEEDS_DECISION).
 */
export function findOperationalExpenseDuplicate(
  existing: UkExpenseDuplicateCandidate[],
  candidate: UkExpenseDuplicateCandidate,
): UkExpenseDuplicateCandidate | null {
  const date = (candidate.expense_date ?? '').trim();
  const title = normalizeExpenseTitle(candidate.title ?? '');
  const amount = normalizeExpenseAmount(candidate.amount);
  if (!date || !title || !(amount > 0)) return null;
  const hit = existing.find((row) => {
    if (candidate.id != null && row.id != null && Number(row.id) === Number(candidate.id)) {
      return false;
    }
    return (
      (row.expense_date ?? '').trim() === date &&
      normalizeExpenseTitle(row.title ?? '') === title &&
      normalizeExpenseAmount(Number(row.amount)) === amount
    );
  });
  return hit ?? null;
}
