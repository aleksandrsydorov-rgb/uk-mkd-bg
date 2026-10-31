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
