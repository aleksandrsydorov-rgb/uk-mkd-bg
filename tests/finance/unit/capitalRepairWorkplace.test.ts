import { describe, expect, it } from 'vitest';
import { parseCapitalRepairYearChargeContext } from '@/lib/capitalRepairLaunch';
import {
  CAPITAL_ADMIN_TABS,
  EMPTY_CAPITAL_JOURNAL_FILTERS,
  aggregateCapitalRepairBalances,
  capitalChargeStateNoticeKey,
  capitalChargeYearChoices,
  buildCapitalYearBreakdown,
  capitalAssessmentDocumentDate,
  capitalBillingYearFromAssessmentTitle,
  capitalHistoryFiltersActive,
  capitalJournalFiltersActive,
  capitalLedgerSofiaYmd,
  capitalStandingDebt,
  capitalStandingOverpay,
  defaultCapitalChargeYear,
  EMPTY_CAPITAL_HISTORY_FILTERS,
  filterCapitalHistoryRows,
  filterCapitalJournalRows,
  isCapitalBulkChargeEnabled,
  isSyntheticCapitalDecisionDate,
  parseCapitalAdminTab,
  resolveCapitalChargeState,
  sumCapitalCashReceipts,
  sumCapitalJournalRows,
  sumCapitalOpeningCredit,
  sumCapitalOpeningObligation,
  sumCapitalYearCharge,
} from '@/lib/capitalRepairUi';
import {
  buildUtilityFinanceRegisterRows,
  filterUtilityFinanceRegisterRows,
  sortUtilityFinanceRegisterRows,
} from '@/lib/utilityFinanceRegister';

function ctx(over: Record<string, unknown>) {
  return parseCapitalRepairYearChargeContext({
    billing_year: 2027,
    launch_year: 2026,
    min_charge_year: 2027,
    blocked: false,
    apartments_total: 55,
    apartments_charged: 0,
    apartments_opening: 0,
    apartments_remaining: 55,
    ...over,
  });
}

describe('capital repair workplace · tabs', () => {
  it('uses register | charges | payments | history and defaults to register', () => {
    expect([...CAPITAL_ADMIN_TABS]).toEqual(['register', 'charges', 'payments', 'history']);
    expect(parseCapitalAdminTab(null)).toBe('register');
    expect(parseCapitalAdminTab('')).toBe('register');
    expect(parseCapitalAdminTab('overview')).toBe('register');
    expect(parseCapitalAdminTab('operations')).toBe('register');
    expect(parseCapitalAdminTab('charges')).toBe('charges');
    expect(parseCapitalAdminTab('payments')).toBe('payments');
    expect(parseCapitalAdminTab('history')).toBe('history');
  });
});

describe('capital repair workplace · register balances', () => {
  it('matches get_capital_repair_balance signs (opening kinds included)', () => {
    const map = aggregateCapitalRepairBalances([
      { property_id: 1, kind: 'charge', amount_eur: 100 },
      { property_id: 1, kind: 'opening_obligation', amount_eur: 50 },
      { property_id: 1, kind: 'payment', amount_eur: 30 },
      { property_id: 1, kind: 'opening_historical_settlement', amount_eur: 20 },
      { property_id: 1, kind: 'adjustment_debit', amount_eur: 5 },
      { property_id: 1, kind: 'adjustment_credit', amount_eur: 2 },
      { property_id: 1, kind: 'opening_credit', amount_eur: 3 },
      { property_id: 2, kind: 'payment', amount_eur: '40.5' },
      { property_id: 3, kind: 'unknown', amount_eur: 999 },
    ]);
    expect(map.get(1)).toEqual({
      charged_eur: 150,
      paid_eur: 50,
      adjustments_debit_eur: 5,
      adjustments_credit_eur: 5,
      balance_eur: 100,
    });
    expect(map.get(2)?.balance_eur).toBe(-40.5);
    expect(map.get(3)?.balance_eur).toBe(0);
  });

  it('builds, filters and sorts register rows through the shared utility register helpers', () => {
    const props = [
      { id: 10, apartment_number: '10', owner_name: 'Борис' },
      { id: 2, apartment_number: '2', owner_name: 'Анна' },
      { id: 3, apartment_number: '3', owner_name: null },
    ];
    const balances = aggregateCapitalRepairBalances([
      { property_id: 10, kind: 'charge', amount_eur: 60 },
      { property_id: 2, kind: 'charge', amount_eur: 60 },
      { property_id: 2, kind: 'payment', amount_eur: 80 },
    ]);
    const rows = buildUtilityFinanceRegisterRows(props, balances);
    const sorted = sortUtilityFinanceRegisterRows(rows);
    expect(sorted.map((r) => r.apartmentNumber)).toEqual(['2', '3', '10']);
    expect(sorted.map((r) => r.status)).toEqual(['credit', 'settled', 'debt']);
    expect(
      filterUtilityFinanceRegisterRows(rows, { query: '', status: 'debt' }).map((r) => r.propertyId),
    ).toEqual([10]);
    expect(
      filterUtilityFinanceRegisterRows(rows, { query: 'анна', status: 'all' }).map((r) => r.propertyId),
    ).toEqual([2]);
  });
});

describe('capital repair workplace · charge state', () => {
  it('launch year 2026 is blocked, even before the year context loads', () => {
    expect(
      resolveCapitalChargeState({ billingYear: 2026, launchYear: 2026, ctx: null, rateOk: null }),
    ).toBe('launch_blocked');
    expect(
      resolveCapitalChargeState({
        billingYear: 2026,
        launchYear: 2026,
        ctx: ctx({ billing_year: 2026, blocked: true, apartments_remaining: 0 }),
        rateOk: true,
      }),
    ).toBe('launch_blocked');
  });

  it('server-side blocked flag also blocks', () => {
    expect(
      resolveCapitalChargeState({
        billingYear: 2027,
        launchYear: null,
        ctx: ctx({ blocked: true }),
        rateOk: true,
      }),
    ).toBe('launch_blocked');
  });

  it('2027 shows remaining, then all-charged', () => {
    expect(
      resolveCapitalChargeState({ billingYear: 2027, launchYear: 2026, ctx: ctx({}), rateOk: true }),
    ).toBe('remaining');
    expect(
      resolveCapitalChargeState({
        billingYear: 2027,
        launchYear: 2026,
        ctx: ctx({ apartments_charged: 55, apartments_remaining: 0 }),
        rateOk: true,
      }),
    ).toBe('all_charged');
  });

  it('missing rate or no apartments → calculation impossible; loading while unknown', () => {
    expect(
      resolveCapitalChargeState({ billingYear: 2027, launchYear: 2026, ctx: ctx({}), rateOk: false }),
    ).toBe('calc_impossible');
    expect(
      resolveCapitalChargeState({
        billingYear: 2027,
        launchYear: 2026,
        ctx: ctx({ apartments_total: 0, apartments_remaining: 0 }),
        rateOk: true,
      }),
    ).toBe('calc_impossible');
    expect(
      resolveCapitalChargeState({ billingYear: 2027, launchYear: 2026, ctx: null, rateOk: true }),
    ).toBe('loading');
    expect(
      resolveCapitalChargeState({ billingYear: 2027, launchYear: 2026, ctx: ctx({}), rateOk: null }),
    ).toBe('loading');
  });

  it('bulk button only enabled for remaining + permission', () => {
    expect(isCapitalBulkChargeEnabled('remaining', true)).toBe(true);
    expect(isCapitalBulkChargeEnabled('remaining', false)).toBe(false);
    for (const s of ['loading', 'launch_blocked', 'calc_impossible', 'all_charged'] as const) {
      expect(isCapitalBulkChargeEnabled(s, true)).toBe(false);
    }
  });

  it('notice keys per state', () => {
    expect(capitalChargeStateNoticeKey('launch_blocked')).toBe('admin.capitalLaunchBlocked');
    expect(capitalChargeStateNoticeKey('calc_impossible')).toBe('admin.capitalChargeImpossible');
    expect(capitalChargeStateNoticeKey('all_charged')).toBe('admin.capitalChargeAllCharged');
    expect(capitalChargeStateNoticeKey('remaining')).toBeNull();
    expect(capitalChargeStateNoticeKey('loading')).toBeNull();
  });

  it('year choices include launch + first chargeable year; default is launch + 1', () => {
    expect(
      capitalChargeYearChoices({ currentYear: 2026, selectedYear: 2027, launchYear: 2026, minChargeYear: 2027 }),
    ).toEqual([2026, 2027, 2028]);
    expect(
      capitalChargeYearChoices({ currentYear: 2026, selectedYear: 2026, launchYear: null, minChargeYear: null }),
    ).toEqual([2026, 2027]);
    expect(defaultCapitalChargeYear(2027, 2026)).toBe(2027);
    expect(defaultCapitalChargeYear(null, 2026)).toBe(2026);
  });
});

describe('capital repair workplace · payments journal', () => {
  const rows = [
    { id: 'a', kind: 'payment', property_id: 1, created_at: '2026-11-07T10:00:00Z', amount_eur: 10 },
    { id: 'b', kind: 'payment', property_id: 2, created_at: '2026-11-08T10:00:00Z', amount_eur: 20.25 },
    { id: 'c', kind: 'charge', property_id: 1, created_at: '2026-11-08T10:00:00Z', amount_eur: 500 },
    { id: 'd', kind: 'opening_historical_settlement', property_id: 1, created_at: '2026-11-08T10:00:00Z', amount_eur: 7 },
  ];

  it('keeps only ledger payments and sums them', () => {
    const out = filterCapitalJournalRows(rows, EMPTY_CAPITAL_JOURNAL_FILTERS);
    expect(out.map((r) => r.id)).toEqual(['a', 'b']);
    expect(sumCapitalJournalRows(out)).toBe(30.25);
  });

  it('filters by apartment and Sofia date window', () => {
    expect(
      filterCapitalJournalRows(rows, { from: '', to: '', propertyId: 2 }).map((r) => r.id),
    ).toEqual(['b']);
    expect(
      filterCapitalJournalRows(rows, { from: '2026-11-08', to: '', propertyId: '' }).map((r) => r.id),
    ).toEqual(['b']);
    expect(
      filterCapitalJournalRows(rows, { from: '', to: '2026-11-07', propertyId: '' }).map((r) => r.id),
    ).toEqual(['a']);
  });

  it('uses the Europe/Sofia calendar day', () => {
    // 22:30Z on 7 Nov is already 8 Nov in Sofia (UTC+2).
    expect(capitalLedgerSofiaYmd('2026-11-07T22:30:00Z')).toBe('2026-11-08');
    expect(capitalLedgerSofiaYmd('not-a-date')).toBe('');
    expect(capitalLedgerSofiaYmd(null)).toBe('');
  });

  it('reports active filters', () => {
    expect(capitalJournalFiltersActive(EMPTY_CAPITAL_JOURNAL_FILTERS)).toBe(false);
    expect(capitalJournalFiltersActive({ from: '', to: '', propertyId: 3 })).toBe(true);
    expect(capitalJournalFiltersActive({ from: '2026-01-01', to: '', propertyId: '' })).toBe(true);
  });
});

describe('capital repair workplace · complex history', () => {
  const rows = [
    { id: 'a', kind: 'payment', property_id: 1, created_at: '2026-11-07T10:00:00Z', amount_eur: 10 },
    { id: 'b', kind: 'charge', property_id: 2, created_at: '2026-11-08T10:00:00Z', amount_eur: 100 },
    { id: 'c', kind: 'adjustment_debit', property_id: 1, created_at: '2026-11-08T12:00:00Z', amount_eur: 5 },
    { id: 'd', kind: 'opening_obligation', property_id: 2, created_at: '2026-01-01T10:00:00Z', amount_eur: 50 },
  ];

  it('filters by apartment, period and operation kind', () => {
    expect(
      filterCapitalHistoryRows(rows, { ...EMPTY_CAPITAL_HISTORY_FILTERS, propertyId: 1 }).map((r) => r.id),
    ).toEqual(['a', 'c']);
    expect(
      filterCapitalHistoryRows(rows, { ...EMPTY_CAPITAL_HISTORY_FILTERS, kind: 'charge' }).map((r) => r.id),
    ).toEqual(['b']);
    expect(
      filterCapitalHistoryRows(rows, {
        from: '2026-11-08',
        to: '2026-11-08',
        propertyId: '',
        kind: 'all',
      }).map((r) => r.id),
    ).toEqual(['b', 'c']);
    expect(
      filterCapitalHistoryRows(rows, {
        from: '',
        to: '',
        propertyId: 1,
        kind: 'adjustment',
      }).map((r) => r.id),
    ).toEqual(['c']);
  });

  it('reports active history filters', () => {
    expect(capitalHistoryFiltersActive(EMPTY_CAPITAL_HISTORY_FILTERS)).toBe(false);
    expect(capitalHistoryFiltersActive({ ...EMPTY_CAPITAL_HISTORY_FILTERS, kind: 'payment' })).toBe(true);
    expect(capitalHistoryFiltersActive({ ...EMPTY_CAPITAL_HISTORY_FILTERS, propertyId: 2 })).toBe(true);
  });
});

describe('capital repair workplace · year charge vs total balance', () => {
  const apt1 = [
    { kind: 'opening_obligation', amount_eur: 120, assessment_title: 'Капитальный ремонт 2025' },
    { kind: 'charge', amount_eur: 70, assessment_title: 'Капитальный ремонт 2026' },
    { kind: 'charge', amount_eur: 70, assessment_title: 'Капитальный ремонт 2027' },
    { kind: 'payment', amount_eur: 40, assessment_title: null },
    { kind: 'opening_credit', amount_eur: 5, assessment_title: 'Капитальный ремонт 2025' },
  ];

  it('splits year charge from opening and from total charged', () => {
    expect(capitalBillingYearFromAssessmentTitle('Капитальный ремонт 2027')).toBe(2027);
    expect(sumCapitalYearCharge(apt1, 2027)).toBe(70);
    expect(sumCapitalYearCharge(apt1, 2026)).toBe(70);
    expect(sumCapitalOpeningObligation(apt1)).toBe(120);
    expect(sumCapitalCashReceipts(apt1)).toBe(40);
    expect(sumCapitalOpeningCredit(apt1)).toBe(5);
  });

  it('builds year breakdown matching audit apt #1 (120+70+70)', () => {
    const lines = buildCapitalYearBreakdown(apt1);
    expect(lines).toEqual([
      { year: 2025, kind: 'opening', amountEur: 120 },
      { year: 2026, kind: 'charge', amountEur: 70 },
      { year: 2027, kind: 'charge', amountEur: 70 },
    ]);
    expect(lines.reduce((s, l) => s + l.amountEur, 0)).toBe(260);
  });

  it('hides synthetic Jan-1 decision_date as document date', () => {
    expect(isSyntheticCapitalDecisionDate('2027-01-01', 2027)).toBe(true);
    expect(isSyntheticCapitalDecisionDate('2027-03-15', 2027)).toBe(false);
    expect(
      capitalAssessmentDocumentDate({
        title: 'Капитальный ремонт 2027',
        decision_date: '2027-01-01',
      }),
    ).toBeNull();
    expect(
      capitalAssessmentDocumentDate({
        title: 'Капитальный ремонт 2027',
        decision_date: '2027-06-01',
      }),
    ).toBe('2027-06-01');
  });

  it('separates standing debt and overpay from signed balance', () => {
    expect(capitalStandingDebt(260)).toBe(260);
    expect(capitalStandingOverpay(260)).toBe(0);
    expect(capitalStandingDebt(-15.5)).toBe(0);
    expect(capitalStandingOverpay(-15.5)).toBe(15.5);
  });
});
