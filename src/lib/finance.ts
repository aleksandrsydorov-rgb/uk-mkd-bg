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
  const r = (role ?? '').trim().toLowerCase();
  if (!r) return false;
  return /админ|administr|управляющ|директор|председател|управител|менедж|\bmanager\b|(^|\s)ук(\s|$)/.test(r);
}

export function isUkAccountantRole(role?: string | null) {
  const r = (role ?? '').trim().toLowerCase();
  if (!r) return false;
  return /бухгалтер|account|кассир|счетовод/.test(r);
}

/** Admin and accountant (and empty legacy roles) can take support-fee payments. */
export function canRecordSupportPayments(role?: string | null) {
  const r = (role ?? '').trim();
  if (!r) return true;
  return isUkAdminRole(r) || isUkAccountantRole(r);
}

/** Only administrator sets the €/m² rate. Empty role is treated as admin for setup. */
export function canSetSupportRate(role?: string | null) {
  const r = (role ?? '').trim();
  if (!r) return true;
  return isUkAdminRole(r);
}

/** Only administrator publishes expenses for owners. Empty role is treated as admin for setup. */
export function canApproveUkExpenses(role?: string | null) {
  return canSetSupportRate(role);
}

export const STAFF_ROLE_OPTIONS = [
  'Администратор',
  'Бухгалтер',
  'Управляющий',
  'Техник',
  'Охрана',
] as const;
