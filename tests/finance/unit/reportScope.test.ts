import { describe, expect, it } from 'vitest';
import {
  filterBalanceMapByPropertyScope,
  filterExpenseRowsByCategoryScope,
  filterPropertiesByScope,
  filterRowsByPropertyScope,
  parseReportPropertyScope,
  reportFilterFingerprint,
  reportScopeMatchesGroup,
} from '@/lib/reportScope';

describe('Task 15 · report scope filters', () => {
  it('filters properties, ledger rows and expense categories without changing amounts', () => {
    expect(parseReportPropertyScope('all')).toBe('all');
    expect(parseReportPropertyScope('12')).toBe(12);

    const props = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(filterPropertiesByScope(props, 'all')).toHaveLength(3);
    expect(filterPropertiesByScope(props, 2).map((p) => p.id)).toEqual([2]);

    const rows = [
      { property_id: 1, amount: 10 },
      { property_id: 2, amount: 20 },
      { property_id: null as number | null, amount: 5 },
    ];
    expect(filterRowsByPropertyScope(rows, 2, (r) => r.property_id)).toEqual([
      { property_id: 2, amount: 20 },
    ]);

    const expenses = [
      { budget_category_id: 'aaa' },
      { budget_category_id: null },
      { budget_category_id: 'bbb' },
    ];
    expect(filterExpenseRowsByCategoryScope(expenses, 'none')).toEqual([
      { budget_category_id: null },
    ]);
    expect(filterExpenseRowsByCategoryScope(expenses, 'bbb')).toEqual([
      { budget_category_id: 'bbb' },
    ]);
  });

  it('scopes balance maps and report groups; fingerprint is stable', () => {
    const map = new Map([
      [1, { balance_eur: 3 }],
      [2, { balance_eur: 9 }],
    ]);
    expect(filterBalanceMapByPropertyScope(map, 2)?.get(2)?.balance_eur).toBe(9);
    expect(filterBalanceMapByPropertyScope(map, 2)?.has(1)).toBe(false);
    expect(filterBalanceMapByPropertyScope(null, 1)).toBeNull();

    expect(reportScopeMatchesGroup('ops', 'all')).toBe(true);
    expect(reportScopeMatchesGroup('ops', 'capital')).toBe(false);
    expect(reportScopeMatchesGroup('capital', 'capital')).toBe(true);

    expect(
      reportFilterFingerprint({
        year: 2026,
        quarter: 2,
        propertyScope: 55,
        expenseCategoryScope: 'none',
      }),
    ).toBe('2026-q2-p55-cat-none');
  });
});
