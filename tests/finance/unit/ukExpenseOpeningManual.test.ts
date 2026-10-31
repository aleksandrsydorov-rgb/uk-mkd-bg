import { describe, expect, it } from 'vitest';
import { isOpeningExpense } from '@/lib/expenses';
import {
  defaultUkExpenseOpeningManualSourceRef,
  ukExpenseOpeningRequiresReceipt,
  ukExpenseOpeningYearBounds,
  validateUkExpenseOpeningManualInput,
} from '@/lib/ukExpenseOpeningManual';

describe('Task 13 · UK expense opening manual entry', () => {
  it('marks opening rows and never requires receipts', () => {
    expect(isOpeningExpense({ opening_import: true })).toBe(true);
    expect(isOpeningExpense({ opening_import: false })).toBe(false);
    expect(isOpeningExpense({})).toBe(false);
    expect(ukExpenseOpeningRequiresReceipt()).toBe(false);
  });

  it('bounds the accounting year and validates mid-year input', () => {
    expect(ukExpenseOpeningYearBounds(2026)).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });

    const base = {
      title: 'Охрана янв–март',
      amount: 120.5,
      expenseDate: '2026-03-15',
      transitionDate: '2026-06-01',
      sourceRef: defaultUkExpenseOpeningManualSourceRef({
        expenseDate: '2026-03-15',
        nonce: 'test',
      }),
    };

    expect(base.sourceRef).toBe('manual-opening:2026-03-15:test');
    expect(
      validateUkExpenseOpeningManualInput(base, {
        sofiaTodayIso: '2026-06-15',
        billingYear: 2026,
      }),
    ).toEqual({ ok: true });

    expect(
      validateUkExpenseOpeningManualInput(
        { ...base, expenseDate: '2025-12-31' },
        { sofiaTodayIso: '2026-06-15', billingYear: 2026 },
      ),
    ).toEqual({ ok: false, errorKey: 'admin.expOpeningErrYearWindow' });

    expect(
      validateUkExpenseOpeningManualInput(
        { ...base, expenseDate: '2026-07-01' },
        { sofiaTodayIso: '2026-06-15', billingYear: 2026 },
      ),
    ).toEqual({ ok: false, errorKey: 'admin.expOpeningErrAfterTransition' });

    expect(
      validateUkExpenseOpeningManualInput(
        { ...base, transitionDate: '2026-07-01' },
        { sofiaTodayIso: '2026-06-15', billingYear: 2026 },
      ),
    ).toEqual({ ok: false, errorKey: 'admin.expOpeningErrTransitionFuture' });

    expect(
      validateUkExpenseOpeningManualInput(
        { ...base, amount: 0 },
        { sofiaTodayIso: '2026-06-15', billingYear: 2026 },
      ),
    ).toEqual({ ok: false, errorKey: 'admin.expOpeningErrAmount' });
  });
});
