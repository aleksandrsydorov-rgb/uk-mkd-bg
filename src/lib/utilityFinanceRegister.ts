/**
 * Shared apartment register for water / electricity / internet finance workplace.
 * Presentation helpers — balances come from ledger aggregates matching get_*_balance RPCs.
 */

import { compareApartmentNumbers } from '@/lib/supportFeeRegister';
import { balanceTone, emptyBalance, type UtilityBalance } from '@/lib/utilities';

export type UtilityFinanceService = 'water' | 'electricity' | 'internet';

export type UtilityFinanceStatusFilter = 'all' | 'debt' | 'credit' | 'settled';

export type UtilityFinanceRegisterFilters = {
  query: string;
  status: UtilityFinanceStatusFilter;
};

export const EMPTY_UTILITY_FINANCE_FILTERS: UtilityFinanceRegisterFilters = {
  query: '',
  status: 'all',
};

export type UtilityLedgerAggRow = {
  property_id: number;
  kind: string;
  amount_eur: number | string | null;
};

export type UtilityFinanceProperty = {
  id: number;
  apartment_number: string | number | null;
  owner_name: string | null;
};

export type UtilityFinanceRegisterRow = {
  propertyId: number;
  apartmentNumber: string | number;
  ownerName: string | null;
  chargedEur: number;
  paidEur: number;
  balanceEur: number;
  status: 'debt' | 'credit' | 'settled';
};

/**
 * Module-wide rollup for the complex balance card.
 * Per-apartment balance_eur uses the existing ledger formula (debt > 0, credit < 0).
 * Card total sums only outstanding debts — apartment overpayments are not netted.
 */
export type UtilityModuleTotals = {
  chargedEur: number;
  paidEur: number;
  /** Sum of positive per-apartment balances only (complex outstanding debt). */
  balanceEur: number;
  propertyCount: number;
};

export function sumModuleTotalsFromRegisterRows(
  rows: UtilityFinanceRegisterRow[],
): UtilityModuleTotals {
  let chargedEur = 0;
  let paidEur = 0;
  let debtEur = 0;
  for (const row of rows) {
    chargedEur += Number(row.chargedEur) || 0;
    paidEur += Number(row.paidEur) || 0;
    const bal = Number(row.balanceEur) || 0;
    if (bal > 0) debtEur += bal;
  }
  return { chargedEur, paidEur, balanceEur: debtEur, propertyCount: rows.length };
}

export function ledgerTableForService(service: UtilityFinanceService): string {
  if (service === 'water') return 'water_ledger';
  if (service === 'electricity') return 'electricity_ledger';
  return 'internet_ledger';
}

export function balanceRpcForService(service: UtilityFinanceService): string {
  if (service === 'water') return 'get_water_balance';
  if (service === 'electricity') return 'get_electricity_balance';
  return 'get_internet_balance';
}

export function paymentRpcForService(service: UtilityFinanceService): string {
  if (service === 'water') return 'record_water_payment';
  if (service === 'electricity') return 'record_electricity_payment';
  return 'record_internet_payment';
}

export function receiptModuleForService(
  service: UtilityFinanceService,
): 'water' | 'electricity' | 'internet' {
  return service;
}

/** Same formula as get_water_balance / get_electricity_balance / get_internet_balance. */
export function accumulateUtilityBalance(
  map: Map<number, UtilityBalance>,
  propertyId: number,
  kind: string,
  amountRaw: number | string | null | undefined,
): void {
  const amount = Number(amountRaw ?? 0);
  if (!Number.isFinite(amount) || !Number.isFinite(propertyId)) return;
  const current = map.get(propertyId) ?? emptyBalance();
  if (kind === 'charge') current.charged_eur += amount;
  else if (kind === 'payment') current.paid_eur += amount;
  else if (kind === 'adjustment_debit') current.adjustments_debit_eur += amount;
  else if (kind === 'adjustment_credit') current.adjustments_credit_eur += amount;
  current.balance_eur =
    current.charged_eur +
    current.adjustments_debit_eur -
    (current.paid_eur + current.adjustments_credit_eur);
  map.set(propertyId, current);
}

export function aggregateUtilityBalances(rows: UtilityLedgerAggRow[]): Map<number, UtilityBalance> {
  const map = new Map<number, UtilityBalance>();
  for (const row of rows) {
    accumulateUtilityBalance(map, Number(row.property_id), String(row.kind), row.amount_eur);
  }
  return map;
}

export function buildUtilityFinanceRegisterRows(
  properties: UtilityFinanceProperty[],
  balances: Map<number, UtilityBalance>,
): UtilityFinanceRegisterRow[] {
  return properties.map((p) => {
    const bal = balances.get(p.id) ?? emptyBalance();
    const tone = balanceTone(bal.balance_eur);
    return {
      propertyId: p.id,
      apartmentNumber: p.apartment_number ?? '',
      ownerName: p.owner_name,
      chargedEur: bal.charged_eur,
      paidEur: bal.paid_eur,
      balanceEur: bal.balance_eur,
      status: tone === 'over' ? 'credit' : tone,
    };
  });
}

export function utilityFinanceFiltersActive(f: UtilityFinanceRegisterFilters): boolean {
  return f.status !== 'all' || Boolean(String(f.query ?? '').trim());
}

export function filterUtilityFinanceRegisterRows(
  rows: UtilityFinanceRegisterRow[],
  filters: UtilityFinanceRegisterFilters,
): UtilityFinanceRegisterRow[] {
  const q = String(filters.query ?? '').trim().toLowerCase();
  return rows.filter((row) => {
    if (q) {
      const apt = String(row.apartmentNumber ?? '').toLowerCase();
      const owner = String(row.ownerName ?? '').toLowerCase();
      if (!apt.includes(q) && !owner.includes(q)) return false;
    }
    if (filters.status === 'debt' && row.status !== 'debt') return false;
    if (filters.status === 'credit' && row.status !== 'credit') return false;
    if (filters.status === 'settled' && row.status !== 'settled') return false;
    return true;
  });
}

export function sortUtilityFinanceRegisterRows(
  rows: UtilityFinanceRegisterRow[],
): UtilityFinanceRegisterRow[] {
  return [...rows].sort((a, b) => compareApartmentNumbers(a.apartmentNumber, b.apartmentNumber));
}
