import { describe, expect, it } from 'vitest';
import {
  buildCapitalRepairKpis,
  capitalFundCashBalance,
  capitalLedgerKindFilterActive,
  capitalOpsHistoryTitleKey,
  filterCapitalLedgerRows,
  isCapitalAdminTab,
  sumCapitalOperationalCharges,
  sumCapitalOperationalReceipts,
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
    expect(capitalOpsHistoryTitleKey('opening_historical_settlement')).toBe('admin.kindOpeningSettlement');
    expect(capitalOpsHistoryTitleKey('opening_credit')).toBe('admin.kindOpeningCredit');
  });

  it('keeps opening out of operational charges and receipts, and fund cash off apartment debt', () => {
    const rows = [
      { kind: 'charge', amount_eur: 100 },
      { kind: 'opening_obligation', amount_eur: 80 },
      { kind: 'payment', amount_eur: 40 },
      { kind: 'opening_historical_settlement', amount_eur: 20 },
      { kind: 'opening_credit', amount_eur: 25 },
    ];
    expect(filterCapitalLedgerRows(rows, 'charge').map((row) => row.kind)).toEqual(['charge']);
    expect(filterCapitalLedgerRows(rows, 'payment').map((row) => row.kind)).toEqual(['payment']);
    expect(sumCapitalOperationalCharges(rows)).toBe(100);
    expect(sumCapitalOperationalReceipts(rows)).toBe(40);
    const apartmentDebtNet = 80;
    expect(capitalFundCashBalance(1500)).toBe(1500);
    expect(capitalFundCashBalance(1500)).not.toBe(apartmentDebtNet);
    expect(capitalFundCashBalance(null)).toBeNull();
  });
});

describe('Capital Repair KPI scenarios', () => {
  const openingCash = 1000;

  it('charge stays gross because void and restore are not capital ledger kinds', () => {
    const row = buildCapitalRepairKpis({
      fundCashOpeningEur: openingCash,
      ledger: [
        { kind: 'charge', amount_eur: 100 },
        { kind: 'assessment_void', amount_eur: 100 },
        { kind: 'assessment_restore', amount_eur: 100 },
      ],
    });
    expect(row).toEqual({ charges: 100, receipts: 0, fundCash: 1000 });
  });

  it('payment stays gross because reversal is not a capital ledger kind and does not move cash', () => {
    const row = buildCapitalRepairKpis({
      fundCashOpeningEur: openingCash,
      ledger: [
        { kind: 'payment', amount_eur: 40 },
        { kind: 'payment_reversal', amount_eur: 40 },
      ],
    });
    expect(row).toEqual({ charges: 0, receipts: 40, fundCash: 1000 });
  });

  it('opening cash stays put when later receipts exist and expenses are not a cash posting', () => {
    const row = buildCapitalRepairKpis({
      fundCashOpeningEur: openingCash,
      ledger: [
        { kind: 'payment', amount_eur: 40 },
        { kind: 'charge', amount_eur: 100 },
      ],
    });
    expect(row.receipts).toBe(40);
    expect(row.charges).toBe(100);
    expect(row.fundCash).toBe(1000);
    expect(row.fundCash).not.toBe(1000 + 40);
    expect(row.fundCash).not.toBe(1000 + 40 - 30);
  });

  it('apartment opening debt and credit do not move cash or operational totals', () => {
    const row = buildCapitalRepairKpis({
      fundCashOpeningEur: openingCash,
      ledger: [
        { kind: 'opening_obligation', amount_eur: 80 },
        { kind: 'opening_historical_settlement', amount_eur: 20 },
        { kind: 'opening_credit', amount_eur: 25 },
      ],
    });
    expect(row).toEqual({ charges: 0, receipts: 0, fundCash: 1000 });
  });
});
