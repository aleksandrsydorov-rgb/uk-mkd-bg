export const DEFAULT_SUPPORT_RATE = 8;

export type SupportFeeKind = 'payment' | 'charge';

export interface BuildingSettings {
  id: number;
  support_rate_eur_per_sqm_year: number;
  updated_at?: string | null;
  updated_by?: string | null;
}

export interface SupportFeeEntry {
  id: number;
  created_at: string;
  property_id: number;
  kind: SupportFeeKind | string;
  amount: number;
  period: string | null;
  note: string | null;
  recorded_by: string | null;
  debt_after: number | null;
  overpayment_after: number | null;
}

function roundMoney(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Matches record_support_payment_internal note normalization. */
export const SUPPORT_PAYMENT_DEFAULT_NOTE = 'Оплата таксы поддержки';

export function supportPaymentIdempotencySignature(input: {
  mode: 'regular' | 'year';
  propertyId: number;
  amount: number;
  note?: string | null;
  billingYear?: number | null;
}) {
  const amount = roundMoney(input.amount).toFixed(2);
  const note = (input.note ?? '').trim() || SUPPORT_PAYMENT_DEFAULT_NOTE;
  if (input.mode === 'year') {
    return `year|${input.propertyId}|${amount}|${input.billingYear ?? ''}|${note}`;
  }
  return `regular|${input.propertyId}|${amount}|${note}`;
}

export function annualSupportFee(area: number | null | undefined, rate: number) {
  return roundMoney(Number(area ?? 0) * rate);
}

export function monthlySupportFee(area: number | null | undefined, rate: number) {
  return roundMoney(annualSupportFee(area, rate) / 12);
}

/** Incoming cash: pays down debt, leftover becomes overpayment. */
export function applySupportPayment(debt: number, overpayment: number, amount: number) {
  const pay = roundMoney(amount);
  if (pay <= 0) throw new Error('Сумма должна быть больше нуля');
  const d = Math.max(0, roundMoney(debt));
  const o = Math.max(0, roundMoney(overpayment));
  if (pay <= d) return { debt: roundMoney(d - pay), overpayment: o };
  return { debt: 0, overpayment: roundMoney(o + (pay - d)) };
}

/** Accrual: consume overpayment first, then add remainder to debt. */
export function applySupportCharge(debt: number, overpayment: number, amount: number) {
  const charge = roundMoney(amount);
  if (charge <= 0) throw new Error('Сумма должна быть больше нуля');
  const d = Math.max(0, roundMoney(debt));
  const o = Math.max(0, roundMoney(overpayment));
  if (charge <= o) return { debt: d, overpayment: roundMoney(o - charge) };
  return { debt: roundMoney(d + (charge - o)), overpayment: 0 };
}

export function isUkAdminRole(role?: string | null) {
  return role === 'администрация';
}

export function isUkAccountantRole(role?: string | null) {
  return role === 'бухгалтер';
}

/** Exact active-role gating is resolved by the caller; only these roles may manage support fees. */
export function canRecordSupportPayments(role?: string | null) {
  return isUkAdminRole(role) || isUkAccountantRole(role);
}

/** Only the exact canonical administration role sets the €/m² rate. */
export function canSetSupportRate(role?: string | null) {
  return isUkAdminRole(role);
}

/** Only the exact canonical administration role publishes expenses for owners. */
export function canApproveUkExpenses(role?: string | null) {
  return canSetSupportRate(role);
}

export const STAFF_ROLE_OPTIONS = [
  { value: 'администрация', label: 'Администратор' },
  { value: 'бухгалтер', label: 'Бухгалтер' },
  { value: 'инженер', label: 'Инженер' },
  { value: 'уборщик', label: 'Уборщик' },
] as const;
