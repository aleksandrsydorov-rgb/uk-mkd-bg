import { describe, expect, it } from 'vitest';
import {
  budgetExecutionOverspendCategories,
  findOperationalExpenseDuplicate,
  isBudgetOverspent,
  sumBudgetExecutionTotals,
} from '@/lib/budget';

describe('P1-UK · Budget overspend visibility + soft expense duplicate', () => {
  it('sumBudgetExecutionTotals is deterministic planned − actual', () => {
    const totals = sumBudgetExecutionTotals([
      { planned_amount_eur: 100, actual_amount_eur: 40 },
      { planned_amount_eur: 50, actual_amount_eur: 70 },
    ]);
    expect(totals).toEqual({
      planned: 150,
      actual: 110,
      remaining: 40,
      overspent: false,
    });
    expect(
      sumBudgetExecutionTotals([{ planned_amount_eur: 10, actual_amount_eur: 25 }]).overspent,
    ).toBe(true);
  });

  it('isBudgetOverspent treats negative remaining as overspend', () => {
    expect(isBudgetOverspent(0)).toBe(false);
    expect(isBudgetOverspent(0.01)).toBe(false);
    expect(isBudgetOverspent(-0.01)).toBe(true);
  });

  it('budgetExecutionOverspendCategories lists only negative remaining rows', () => {
    const cats = budgetExecutionOverspendCategories([
      { category_id: 'a', category_name_ru: 'A', remaining_amount_eur: 10 },
      { category_id: 'b', category_name_ru: 'B', remaining_amount_eur: -5 },
      { category_id: 'c', category_name_ru: 'C', remaining_amount_eur: 0 },
    ]);
    expect(cats).toEqual([
      { category_id: 'b', category_name_ru: 'B', remaining_amount_eur: -5 },
    ]);
  });

  it('findOperationalExpenseDuplicate matches date + title + amount (soft key)', () => {
    const existing = [
      { id: 1, expense_date: '2026-03-01', title: 'Cleaning hall', amount: 120.5 },
      { id: 2, expense_date: '2026-03-02', title: 'Other', amount: 10 },
    ];
    expect(
      findOperationalExpenseDuplicate(existing, {
        expense_date: '2026-03-01',
        title: '  Cleaning   hall ',
        amount: 120.5,
      }),
    ).toEqual(existing[0]);
    expect(
      findOperationalExpenseDuplicate(existing, {
        expense_date: '2026-03-01',
        title: 'Cleaning hall',
        amount: 120.51,
      }),
    ).toBeNull();
  });

  it('findOperationalExpenseDuplicate ignores self when editing', () => {
    const existing = [
      { id: 9, expense_date: '2026-04-01', title: 'Paint', amount: 50 },
    ];
    expect(
      findOperationalExpenseDuplicate(existing, {
        id: 9,
        expense_date: '2026-04-01',
        title: 'Paint',
        amount: 50,
      }),
    ).toBeNull();
  });
});
