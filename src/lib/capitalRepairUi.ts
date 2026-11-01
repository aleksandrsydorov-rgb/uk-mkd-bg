/**
 * Task 12 — Capital Repair admin presentation helpers (no finance math).
 */

export const CAPITAL_ADMIN_TABS = ['overview', 'charge', 'apartment'] as const;
export type CapitalAdminTab = (typeof CAPITAL_ADMIN_TABS)[number];

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
