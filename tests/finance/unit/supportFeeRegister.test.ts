import { describe, expect, it } from 'vitest';
import {
  EMPTY_SUPPORT_FEE_REGISTER_FILTERS,
  buildSupportFeeHistoryRows,
  compareApartmentNumbers,
  enrichSupportFeeHistoryKind,
  filterSupportFeeRegisterRows,
  sortSupportFeeRegisterRows,
  supportFeeRegisterFiltersActive,
} from '@/lib/supportFeeRegister';
import { supportLedgerKindLabelKey } from '@/lib/supportFeeReversal';

describe('Task 09 · Support Fee register natural sort', () => {
  it('orders apartments 1,2,10 instead of 1,10,2', () => {
    const sorted = sortSupportFeeRegisterRows([
      { apartmentNumber: '10' },
      { apartmentNumber: '1' },
      { apartmentNumber: '2' },
      { apartmentNumber: '20' },
      { apartmentNumber: '11' },
    ]).map((r) => String(r.apartmentNumber));
    expect(sorted).toEqual(['1', '2', '10', '11', '20']);
    expect(compareApartmentNumbers('2', '10')).toBeLessThan(0);
  });
});

describe('Task 09 · Support Fee register filters', () => {
  const rows = [
    {
      propertyId: 1,
      apartmentNumber: '1',
      ownerName: 'Alpha',
      assessment: { status: 'open', remaining_due: 50, pricing_rule: 'late', penalty_waived_at: null },
    },
    {
      propertyId: 2,
      apartmentNumber: '2',
      ownerName: 'Beta',
      assessment: {
        status: 'open',
        remaining_due: 0,
        pricing_rule: 'early_full_payment',
        penalty_waived_at: '2026-01-02',
      },
    },
    {
      propertyId: 10,
      apartmentNumber: '10',
      ownerName: 'Gamma',
      assessment: null,
    },
  ];

  it('filters by status/pricing and supports reset detection', () => {
    expect(
      filterSupportFeeRegisterRows(rows, { ...EMPTY_SUPPORT_FEE_REGISTER_FILTERS, status: 'debt' }).map(
        (r) => r.propertyId,
      ),
    ).toEqual([1]);
    expect(
      filterSupportFeeRegisterRows(rows, { ...EMPTY_SUPPORT_FEE_REGISTER_FILTERS, pricing: 'early' }).map(
        (r) => r.propertyId,
      ),
    ).toEqual([2]);
    expect(
      filterSupportFeeRegisterRows(rows, { ...EMPTY_SUPPORT_FEE_REGISTER_FILTERS, apartmentQuery: '10' }).map(
        (r) => r.propertyId,
      ),
    ).toEqual([10]);
    expect(supportFeeRegisterFiltersActive(EMPTY_SUPPORT_FEE_REGISTER_FILTERS)).toBe(false);
    expect(
      supportFeeRegisterFiltersActive({ ...EMPTY_SUPPORT_FEE_REGISTER_FILTERS, status: 'debt' }),
    ).toBe(true);
  });
});

describe('Task 09 · operations history classification', () => {
  it('maps waive and tariff-change corrections', () => {
    expect(enrichSupportFeeHistoryKind('payment', null)).toBe('payment');
    expect(enrichSupportFeeHistoryKind('payment_reversal', null)).toBe('reversal');
    expect(enrichSupportFeeHistoryKind('assessment_void', null)).toBe('void');
    expect(enrichSupportFeeHistoryKind('opening_obligation', null)).toBe('opening_obligation');
    expect(enrichSupportFeeHistoryKind('opening_historical_settlement', null)).toBe('opening_settlement');
    expect(enrichSupportFeeHistoryKind('opening_credit', null)).toBe('opening_credit');
    expect(enrichSupportFeeHistoryKind('late_increase_waive', null)).toBe('penalty_waive');
    expect(enrichSupportFeeHistoryKind('adjustment_credit', 'tariff reprice delta')).toBe('tariff_change');
    expect(enrichSupportFeeHistoryKind('adjustment_debit', 'manual fix')).toBe('correction');
    expect(supportLedgerKindLabelKey('late_increase_waive')).toBe('admin.sfHistPenaltyWaive');
    expect(supportLedgerKindLabelKey('opening_obligation')).toBe('admin.sfHistOpeningObligation');
    expect(supportLedgerKindLabelKey('opening_historical_settlement')).toBe('admin.sfHistOpeningSettlement');
    expect(supportLedgerKindLabelKey('opening_credit')).toBe('admin.sfHistOpeningCredit');
  });

  it('builds history rows with author and basis', () => {
    const rows = buildSupportFeeHistoryRows(
      [
        {
          id: 2,
          property_id: 5,
          kind: 'late_increase_waive',
          amount: 12,
          note: 'WAIVE',
          reversal_reason: 'GM decision',
          recorded_by: 'admin@example.com',
          created_at: '2026-06-02T10:00:00Z',
        },
        {
          id: 1,
          property_id: 5,
          kind: 'payment',
          amount: 100,
          recorded_by: 'admin@example.com',
          created_at: '2026-06-01T10:00:00Z',
        },
      ],
      new Map([[5, '12']]),
    );
    expect(rows[0]?.id).toBe(2);
    expect(rows[0]?.historyKind).toBe('penalty_waive');
    expect(rows[0]?.basis).toBe('GM decision');
    expect(rows[0]?.apartmentNumber).toBe('12');
  });
});
