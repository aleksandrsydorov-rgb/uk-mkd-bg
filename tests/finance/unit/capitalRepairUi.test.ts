import { describe, expect, it } from 'vitest';
import {
  capitalLedgerKindFilterActive,
  capitalOpsHistoryTitleKey,
  filterCapitalLedgerRows,
  isCapitalAdminTab,
} from '@/lib/capitalRepairUi';

describe('Task 12 · Capital Repair UI helpers', () => {
  it('recognizes tabs and filters ledger kinds without changing amounts', () => {
    expect(isCapitalAdminTab('overview')).toBe(true);
    expect(isCapitalAdminTab('charge')).toBe(true);
    expect(isCapitalAdminTab('apartment')).toBe(true);
    expect(isCapitalAdminTab('other')).toBe(false);

    const rows = [
      { kind: 'charge', note: 'a', amount_eur: 100 },
      { kind: 'payment', note: 'b', amount_eur: 40 },
      { kind: 'adjustment_credit', note: 'c', amount_eur: 5 },
    ];
    expect(filterCapitalLedgerRows(rows, 'all')).toHaveLength(3);
    expect(filterCapitalLedgerRows(rows, 'charge').map((r) => r.kind)).toEqual(['charge']);
    expect(filterCapitalLedgerRows(rows, 'payment').map((r) => r.kind)).toEqual(['payment']);
    expect(filterCapitalLedgerRows(rows, 'adjustment').map((r) => r.kind)).toEqual(['adjustment_credit']);
    expect(capitalLedgerKindFilterActive('all')).toBe(false);
    expect(capitalLedgerKindFilterActive('payment')).toBe(true);
  });

  it('maps ops history labels', () => {
    expect(capitalOpsHistoryTitleKey('charge')).toBe('admin.kindCharge');
    expect(capitalOpsHistoryTitleKey('payment')).toBe('admin.kindPayment');
    expect(capitalOpsHistoryTitleKey('opening_obligation')).toBe('admin.kindOpeningObligation');
  });
});
