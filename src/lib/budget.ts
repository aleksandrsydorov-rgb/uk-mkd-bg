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
