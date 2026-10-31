/**
 * Task 09 — Support Fee register sorting, filters, and operations-history presentation.
 * Presentation-only; does not alter financial amounts.
 */

export type SupportFeeRegisterStatusFilter =
  | 'all'
  | 'debt'
  | 'settled'
  | 'void'
  | 'waived';

export type SupportFeeRegisterPricingFilter = 'all' | 'early' | 'late' | 'standard' | 'none';

export type SupportFeeRegisterFilters = {
  apartmentQuery: string;
  status: SupportFeeRegisterStatusFilter;
  pricing: SupportFeeRegisterPricingFilter;
};

export const EMPTY_SUPPORT_FEE_REGISTER_FILTERS: SupportFeeRegisterFilters = {
  apartmentQuery: '',
  status: 'all',
  pricing: 'all',
};

export type SupportFeeRegisterRowInput = {
  propertyId: number;
  apartmentNumber: string | number;
  ownerName?: string | null;
  assessment?: {
    status?: string | null;
    remaining_due?: number | null;
    pricing_rule?: string | null;
    penalty_waived_at?: string | null;
  } | null;
  overpayment?: number | null;
};

export type SupportFeeHistoryKind =
  | 'charge'
  | 'payment'
  | 'discount_context'
  | 'penalty_context'
  | 'penalty_waive'
  | 'correction'
  | 'tariff_change'
  | 'void'
  | 'restore'
  | 'other';

export type SupportFeeHistoryEntryInput = {
  id: number;
  property_id: number;
  kind: string;
  amount: number;
  period?: string | null;
  note?: string | null;
  reversal_reason?: string | null;
  recorded_by?: string | null;
  created_at: string;
};

const aptCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function compareApartmentNumbers(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): number {
  return aptCollator.compare(String(a ?? ''), String(b ?? ''));
}

export function sortSupportFeeRegisterRows<T extends { apartmentNumber: string | number }>(
  rows: T[],
): T[] {
  return [...rows].sort((x, y) => compareApartmentNumbers(x.apartmentNumber, y.apartmentNumber));
}

export function supportFeeRegisterFiltersActive(f: SupportFeeRegisterFilters): boolean {
  return (
    f.status !== 'all' ||
    f.pricing !== 'all' ||
    Boolean(String(f.apartmentQuery ?? '').trim())
  );
}

export function filterSupportFeeRegisterRows(
  rows: SupportFeeRegisterRowInput[],
  filters: SupportFeeRegisterFilters,
): SupportFeeRegisterRowInput[] {
  const q = String(filters.apartmentQuery ?? '').trim().toLowerCase();
  return rows.filter((row) => {
    if (q) {
      const apt = String(row.apartmentNumber ?? '').toLowerCase();
      const owner = String(row.ownerName ?? '').toLowerCase();
      if (!apt.includes(q) && !owner.includes(q)) return false;
    }

    const a = row.assessment;
    const status = String(a?.status ?? '').toLowerCase();
    const remaining = Math.max(0, Number(a?.remaining_due ?? 0));
    const waived = Boolean(a?.penalty_waived_at);

    if (filters.status === 'void' && status !== 'void') return false;
    if (filters.status === 'waived' && !waived) return false;
    if (filters.status === 'debt') {
      if (status === 'void' || !(remaining > 0)) return false;
    }
    if (filters.status === 'settled') {
      if (!a || status === 'void' || remaining > 0) return false;
    }

    const rule = String(a?.pricing_rule ?? '');
    if (filters.pricing === 'none' && a != null) return false;
    if (filters.pricing === 'early' && rule !== 'early_full_payment') return false;
    if (filters.pricing === 'late' && rule !== 'late') return false;
    if (filters.pricing === 'standard' && rule !== 'standard') return false;

    return true;
  });
}

/** Classify ledger kind for the operations-history card. */
export function classifySupportFeeHistoryKind(kind: string | null | undefined): SupportFeeHistoryKind {
  switch (String(kind ?? '')) {
    case 'charge':
      return 'charge';
    case 'payment':
      return 'payment';
    case 'late_increase_waive':
      return 'penalty_waive';
    case 'adjustment_debit':
    case 'adjustment_credit':
      return 'correction';
    case 'assessment_void':
      return 'void';
    case 'assessment_restore':
      return 'restore';
    default:
      return 'other';
  }
}

export function supportFeeHistoryLooksLikeTariffChange(note: string | null | undefined): boolean {
  const s = String(note ?? '').toLowerCase();
  return /tariff|reprice|тариф|пересч|ставк/.test(s);
}

export function enrichSupportFeeHistoryKind(
  kind: string | null | undefined,
  note: string | null | undefined,
): SupportFeeHistoryKind {
  const base = classifySupportFeeHistoryKind(kind);
  if (base === 'correction' && supportFeeHistoryLooksLikeTariffChange(note)) {
    return 'tariff_change';
  }
  return base;
}

export function supportFeeHistoryKindLabelKey(kind: SupportFeeHistoryKind): string {
  switch (kind) {
    case 'charge':
      return 'admin.sfHistCharge';
    case 'payment':
      return 'admin.sfHistPayment';
    case 'discount_context':
      return 'admin.sfHistDiscount';
    case 'penalty_context':
      return 'admin.sfHistPenalty';
    case 'penalty_waive':
      return 'admin.sfHistPenaltyWaive';
    case 'correction':
      return 'admin.sfHistCorrection';
    case 'tariff_change':
      return 'admin.sfHistTariffChange';
    case 'void':
      return 'admin.sfHistVoid';
    case 'restore':
      return 'admin.sfHistRestore';
    default:
      return 'admin.kind';
  }
}

export function buildSupportFeeHistoryRows(
  entries: SupportFeeHistoryEntryInput[],
  aptByPropertyId: Map<number, string | number>,
): Array<{
  id: number;
  createdAt: string;
  apartmentNumber: string | number;
  historyKind: SupportFeeHistoryKind;
  amount: number;
  author: string | null;
  basis: string | null;
  period: string | null;
}> {
  return [...entries]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map((e) => ({
      id: e.id,
      createdAt: e.created_at,
      apartmentNumber: aptByPropertyId.get(e.property_id) ?? e.property_id,
      historyKind: enrichSupportFeeHistoryKind(e.kind, e.note ?? e.reversal_reason),
      amount: Number(e.amount) || 0,
      author: e.recorded_by ? String(e.recorded_by) : null,
      basis: e.reversal_reason || e.note || null,
      period: e.period ?? null,
    }));
}
