/**
 * Task 12 — Capital Repair admin presentation helpers (no finance math).
 */

import type { CapitalRepairYearChargeContext } from '@/lib/capitalRepairLaunch';
import { isCapitalRepairLaunchYearBlocked } from '@/lib/capitalRepairLaunch';
import { emptyBalance, type UtilityBalance } from '@/lib/utilities';

/** URL tabs for `/admin?section=капремонт&tab=…` (Support-Fee-like workplace). */
export const CAPITAL_ADMIN_TABS = ['register', 'charges', 'payments', 'history'] as const;
export type CapitalAdminTab = (typeof CAPITAL_ADMIN_TABS)[number];
export const DEFAULT_CAPITAL_ADMIN_TAB: CapitalAdminTab = 'register';

/** Unknown / missing values fall back to the register. */
export function parseCapitalAdminTab(raw: string | null | undefined): CapitalAdminTab {
  return isCapitalAdminTab(raw) ? raw : DEFAULT_CAPITAL_ADMIN_TAB;
}

export type CapitalLedgerKindFilter = 'all' | 'charge' | 'payment' | 'adjustment';

export type CapitalLedgerFilterRow = {
  kind: string | null | undefined;
  note?: string | null;
};

export function isCapitalAdminTab(value: string | null | undefined): value is CapitalAdminTab {
  return (CAPITAL_ADMIN_TABS as readonly string[]).includes(String(value ?? ''));
}

export function capitalLedgerKindFilterActive(filter: CapitalLedgerKindFilter): boolean {
  return filter !== 'all';
}

export function filterCapitalLedgerRows<T extends CapitalLedgerFilterRow>(
  rows: T[],
  filter: CapitalLedgerKindFilter,
): T[] {
  if (filter === 'all') return rows;
  if (filter === 'charge') return rows.filter((r) => String(r.kind) === 'charge');
  if (filter === 'payment') return rows.filter((r) => String(r.kind) === 'payment');
  return rows.filter((r) => {
    const k = String(r.kind ?? '');
    return k === 'adjustment_debit' || k === 'adjustment_credit';
  });
}

export function capitalOpsHistoryTitleKey(kind: string | null | undefined): string {
  switch (String(kind ?? '')) {
    case 'charge':
      return 'admin.kindCharge';
    case 'payment':
      return 'admin.kindPayment';
    case 'adjustment_debit':
      return 'admin.kindAdjDebit';
    case 'adjustment_credit':
      return 'admin.kindAdjCredit';
    case 'opening_obligation':
      return 'admin.kindOpeningObligation';
    case 'opening_historical_settlement':
      return 'admin.kindOpeningSettlement';
    case 'opening_credit':
      return 'admin.kindOpeningCredit';
    default:
      return 'admin.kind';
  }
}

export type CapitalAmountRow = {
  kind: string | null | undefined;
  amount_eur?: number | string | null;
};

function roundMoney(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function sumCapitalKind(rows: CapitalAmountRow[], kind: string): number {
  return roundMoney(
    rows
      .filter((row) => String(row.kind) === kind)
      .reduce((sum, row) => sum + (Number(row.amount_eur) || 0), 0),
  );
}

/**
 * Operational charges: gross kind `charge` only.
 * Capital Repair has no void or restore, so this gross total is also the standing charge.
 * Opening obligation is inventarisation, not a new charge.
 */
export function sumCapitalOperationalCharges(rows: CapitalAmountRow[]): number {
  return sumCapitalKind(rows, 'charge');
}

/**
 * Operational receipts: gross kind `payment` only.
 * Capital Repair has no payment reversal, so this gross total is also the standing receipt.
 * Opening settlement and opening credit are not receipts and are not cash movements.
 */
export function sumCapitalOperationalReceipts(rows: CapitalAmountRow[]): number {
  return sumCapitalKind(rows, 'payment');
}

/**
 * Confirmed opening cash snapshot.
 * Later apartment payments, charges, opening debts/credits, and expenses are not posted to this cash record.
 */
export function capitalFundCashBalance(
  fundCashOpeningEur: number | null | undefined,
): number | null {
  if (fundCashOpeningEur == null) return null;
  const amount = Number(fundCashOpeningEur);
  if (!Number.isFinite(amount)) return null;
  return roundMoney(amount);
}

export function buildCapitalRepairKpis(input: {
  fundCashOpeningEur: number | null | undefined;
  ledger: CapitalAmountRow[];
}): { charges: number; receipts: number; fundCash: number | null } {
  return {
    charges: sumCapitalOperationalCharges(input.ledger),
    receipts: sumCapitalOperationalReceipts(input.ledger),
    fundCash: capitalFundCashBalance(input.fundCashOpeningEur),
  };
}

// ---------------------------------------------------------------------------
// Workplace (register / charges / payments) helpers — presentation only.
// ---------------------------------------------------------------------------

export type CapitalBalanceLedgerRow = {
  property_id: number | string;
  kind: string | null | undefined;
  amount_eur?: number | string | null;
};

/**
 * Per-apartment balances, same signs as `get_capital_repair_balance` / fund totals:
 * charged = charge + opening_obligation, paid = payment + opening_historical_settlement,
 * debit adj = adjustment_debit, credit adj = adjustment_credit + opening_credit.
 */
export function aggregateCapitalRepairBalances(
  rows: CapitalBalanceLedgerRow[],
): Map<number, UtilityBalance> {
  const map = new Map<number, UtilityBalance>();
  for (const row of rows) {
    const propertyId = Number(row.property_id);
    const amount = Number(row.amount_eur ?? 0);
    if (!Number.isFinite(propertyId) || !Number.isFinite(amount)) continue;
    const cur = map.get(propertyId) ?? emptyBalance();
    switch (String(row.kind ?? '')) {
      case 'charge':
      case 'opening_obligation':
        cur.charged_eur += amount;
        break;
      case 'payment':
      case 'opening_historical_settlement':
        cur.paid_eur += amount;
        break;
      case 'adjustment_debit':
        cur.adjustments_debit_eur += amount;
        break;
      case 'adjustment_credit':
      case 'opening_credit':
        cur.adjustments_credit_eur += amount;
        break;
      default:
        break;
    }
    cur.balance_eur = roundMoney(
      cur.charged_eur + cur.adjustments_debit_eur - (cur.paid_eur + cur.adjustments_credit_eur),
    );
    map.set(propertyId, cur);
  }
  return map;
}

export type CapitalChargeState =
  | 'loading'
  | 'launch_blocked'
  | 'calc_impossible'
  | 'all_charged'
  | 'remaining';

/**
 * Charge-tab state for the selected billing year.
 * - launch_blocked: billing year <= complex launch year (server also blocks)
 * - calc_impossible: no valid rate for the year, or no apartments to charge
 * - all_charged: every apartment already has a charge / opening import
 * - remaining: at least one apartment can be charged
 */
export function resolveCapitalChargeState(input: {
  billingYear: number;
  launchYear: number | null | undefined;
  ctx: CapitalRepairYearChargeContext | null;
  /** True when get_applicable_capital_tariff returned a positive rate for the year. */
  rateOk: boolean | null;
}): CapitalChargeState {
  if (isCapitalRepairLaunchYearBlocked(input.billingYear, input.launchYear) || input.ctx?.blocked) {
    return 'launch_blocked';
  }
  if (input.ctx == null || input.rateOk == null) return 'loading';
  if (!input.rateOk || input.ctx.apartmentsTotal === 0) return 'calc_impossible';
  if (input.ctx.apartmentsRemaining === 0) return 'all_charged';
  return 'remaining';
}

/** Bulk button is enabled only when the state is `remaining` and the user may charge. */
export function isCapitalBulkChargeEnabled(state: CapitalChargeState, canCharge: boolean): boolean {
  return canCharge && state === 'remaining';
}

/** i18n key (admin.*) for the notice shown under the year picker; null when no notice is needed. */
export function capitalChargeStateNoticeKey(state: CapitalChargeState): string | null {
  switch (state) {
    case 'launch_blocked':
      return 'admin.capitalLaunchBlocked';
    case 'calc_impossible':
      return 'admin.capitalChargeImpossible';
    case 'all_charged':
      return 'admin.capitalChargeAllCharged';
    default:
      return null;
  }
}

/** Selectable billing years: current year, launch year, first chargeable year(s), and current choice. */
export function capitalChargeYearChoices(input: {
  currentYear: number;
  selectedYear: number;
  launchYear: number | null | undefined;
  minChargeYear: number | null | undefined;
}): number[] {
  const set = new Set<number>([input.currentYear, input.currentYear + 1, input.selectedYear]);
  if (input.launchYear != null) set.add(input.launchYear);
  if (input.minChargeYear != null) {
    set.add(input.minChargeYear);
    set.add(input.minChargeYear + 1);
  }
  return [...set].filter((y) => Number.isFinite(y) && y >= 2000 && y <= 2100).sort((a, b) => a - b);
}

/** Default billing year: first chargeable year after launch, else the current Sofia year. */
export function defaultCapitalChargeYear(
  minChargeYear: number | null | undefined,
  currentYear: number,
): number {
  return minChargeYear ?? currentYear;
}

export type CapitalJournalFilters = {
  from: string;
  to: string;
  propertyId: number | '';
};

export const EMPTY_CAPITAL_JOURNAL_FILTERS: CapitalJournalFilters = { from: '', to: '', propertyId: '' };

export function capitalJournalFiltersActive(f: CapitalJournalFilters): boolean {
  return Boolean(f.from) || Boolean(f.to) || f.propertyId !== '';
}

const sofiaYmdFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Sofia',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** YYYY-MM-DD in Europe/Sofia for an ISO timestamp; '' when invalid. */
export function capitalLedgerSofiaYmd(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return sofiaYmdFmt.format(d);
}

export type CapitalJournalRow = {
  kind: string | null | undefined;
  property_id: number | string;
  created_at: string | null | undefined;
  amount_eur?: number | string | null;
};

/** Payment journal rows (kind `payment`) inside the optional Sofia-date window / apartment. */
export function filterCapitalJournalRows<T extends CapitalJournalRow>(
  rows: T[],
  filters: CapitalJournalFilters,
): T[] {
  return rows.filter((row) => {
    if (String(row.kind ?? '') !== 'payment') return false;
    if (filters.propertyId !== '' && Number(row.property_id) !== Number(filters.propertyId)) return false;
    const ymd = capitalLedgerSofiaYmd(row.created_at);
    if (filters.from && ymd < filters.from) return false;
    if (filters.to && ymd > filters.to) return false;
    return true;
  });
}

export function sumCapitalJournalRows(rows: CapitalJournalRow[]): number {
  return sumCapitalKind(rows, 'payment');
}

/** Building-wide operations history filters (apartment + Sofia period + kind). */
export type CapitalHistoryFilters = CapitalJournalFilters & {
  kind: CapitalLedgerKindFilter;
};

export const EMPTY_CAPITAL_HISTORY_FILTERS: CapitalHistoryFilters = {
  from: '',
  to: '',
  propertyId: '',
  kind: 'all',
};

export function capitalHistoryFiltersActive(f: CapitalHistoryFilters): boolean {
  return capitalJournalFiltersActive(f) || capitalLedgerKindFilterActive(f.kind);
}

export type CapitalHistoryRow = CapitalJournalRow & CapitalLedgerFilterRow;

/** Complex ops history: optional apartment, Sofia date window, and kind filter. */
export function filterCapitalHistoryRows<T extends CapitalHistoryRow>(
  rows: T[],
  filters: CapitalHistoryFilters,
): T[] {
  const byWindow = rows.filter((row) => {
    if (filters.propertyId !== '' && Number(row.property_id) !== Number(filters.propertyId)) {
      return false;
    }
    const ymd = capitalLedgerSofiaYmd(row.created_at);
    if (filters.from && ymd < filters.from) return false;
    if (filters.to && ymd > filters.to) return false;
    return true;
  });
  return filterCapitalLedgerRows(byWindow, filters.kind);
}

// ---------------------------------------------------------------------------
// Year charge vs total balance / cash vs overpay (presentation only).
// ---------------------------------------------------------------------------

export type CapitalAssessmentYearRow = {
  kind: string | null | undefined;
  amount_eur?: number | string | null;
  /** Assessment title, e.g. «Капитальный ремонт 2027». */
  assessment_title?: string | null;
};

/** Billing year from assessment title (`… 2027`); null when absent. */
export function capitalBillingYearFromAssessmentTitle(
  title: string | null | undefined,
): number | null {
  const raw = String(title ?? '').trim();
  if (!raw) return null;
  const m = /(?:капитальн\w*\s+ремонт|capital\s+repair)\s+(20\d{2})\b/i.exec(raw)
    ?? /\b(20\d{2})\s*$/.exec(raw);
  if (!m) return null;
  const year = Number(m[1]);
  return Number.isFinite(year) ? year : null;
}

/**
 * True when decision_date is the synthetic Jan 1 of the billing year
 * (stored for year matching, not a real assembly document date).
 */
export function isSyntheticCapitalDecisionDate(
  decisionDate: string | null | undefined,
  billingYear: number | null | undefined,
): boolean {
  if (!decisionDate || billingYear == null) return false;
  const ymd = String(decisionDate).slice(0, 10);
  return ymd === `${billingYear}-01-01`;
}

/**
 * Document date for display: only a non-synthetic decision_date.
 * Jan 1 of the billing year is never shown as a document date.
 */
export function capitalAssessmentDocumentDate(input: {
  decision_date?: string | null;
  title?: string | null;
}): string | null {
  const decision = input.decision_date ? String(input.decision_date).slice(0, 10) : '';
  if (!decision) return null;
  const yearFromTitle = capitalBillingYearFromAssessmentTitle(input.title);
  const yearFromDate = Number(decision.slice(0, 4));
  const billingYear = yearFromTitle ?? (Number.isFinite(yearFromDate) ? yearFromDate : null);
  if (isSyntheticCapitalDecisionDate(decision, billingYear)) return null;
  return decision;
}

/** Operational charge amount for one billing year (kind `charge` only). */
export function sumCapitalYearCharge(rows: CapitalAssessmentYearRow[], year: number): number {
  return roundMoney(
    rows
      .filter(
        (row) =>
          String(row.kind) === 'charge'
          && capitalBillingYearFromAssessmentTitle(row.assessment_title) === year,
      )
      .reduce((sum, row) => sum + (Number(row.amount_eur) || 0), 0),
  );
}

/** Opening inventarisation debt (kind `opening_obligation`). */
export function sumCapitalOpeningObligation(rows: CapitalAmountRow[]): number {
  return sumCapitalKind(rows, 'opening_obligation');
}

/** Cash receipts only (kind `payment`). Opening settlements are not cash. */
export function sumCapitalCashReceipts(rows: CapitalAmountRow[]): number {
  return sumCapitalKind(rows, 'payment');
}

/** Opening credit / inventarisation overpay credit (not a cash receipt). */
export function sumCapitalOpeningCredit(rows: CapitalAmountRow[]): number {
  return sumCapitalKind(rows, 'opening_credit');
}

/** Standing overpay from negative balance (display). */
export function capitalStandingOverpay(balanceEur: number | null | undefined): number {
  const n = Number(balanceEur ?? 0);
  if (!Number.isFinite(n) || n >= 0) return 0;
  return roundMoney(-n);
}

/** Standing debt from positive balance (display). */
export function capitalStandingDebt(balanceEur: number | null | undefined): number {
  const n = Number(balanceEur ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return roundMoney(n);
}

export type CapitalYearBreakdownLine = {
  year: number;
  kind: 'opening' | 'charge';
  amountEur: number;
};

/**
 * Per-year lines for the apartment card: opening obligation (by assessment year)
 * plus operational charges. Sorted by year ascending.
 */
export function buildCapitalYearBreakdown(
  rows: CapitalAssessmentYearRow[],
): CapitalYearBreakdownLine[] {
  const openingByYear = new Map<number, number>();
  const chargeByYear = new Map<number, number>();
  for (const row of rows) {
    const year = capitalBillingYearFromAssessmentTitle(row.assessment_title);
    if (year == null) continue;
    const amount = Number(row.amount_eur) || 0;
    if (!(amount > 0)) continue;
    const kind = String(row.kind ?? '');
    if (kind === 'opening_obligation') {
      openingByYear.set(year, roundMoney((openingByYear.get(year) ?? 0) + amount));
    } else if (kind === 'charge') {
      chargeByYear.set(year, roundMoney((chargeByYear.get(year) ?? 0) + amount));
    }
  }
  const years = new Set<number>([...openingByYear.keys(), ...chargeByYear.keys()]);
  const lines: CapitalYearBreakdownLine[] = [];
  for (const year of [...years].sort((a, b) => a - b)) {
    const opening = openingByYear.get(year);
    if (opening != null && opening > 0) {
      lines.push({ year, kind: 'opening', amountEur: opening });
    }
    const charge = chargeByYear.get(year);
    if (charge != null && charge > 0) {
      lines.push({ year, kind: 'charge', amountEur: charge });
    }
  }
  return lines;
}
