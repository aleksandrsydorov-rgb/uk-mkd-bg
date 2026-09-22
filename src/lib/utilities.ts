import type { Database } from '@/lib/database.types';

export type WaterMeter = Database['public']['Tables']['water_meters']['Row'];
export type WaterTariff = Database['public']['Tables']['water_tariffs']['Row'];
export type WaterReading = Database['public']['Tables']['water_readings']['Row'];
export type WaterLedger = Database['public']['Tables']['water_ledger']['Row'];
export type CapitalAssessment = Database['public']['Tables']['capital_repair_assessments']['Row'];
export type CapitalLedger = Database['public']['Tables']['capital_repair_ledger']['Row'];

export type UtilityBalance = {
  charged_eur: number;
  paid_eur: number;
  adjustments_debit_eur: number;
  adjustments_credit_eur: number;
  balance_eur: number;
};

export type WaterSubmitResult = {
  reading_id: string;
  property_id: number;
  meter_id: string;
  meter_number: string;
  reading_date: string;
  previous_value: number;
  current_value: number;
  consumption_m3: number;
  tariff_eur_per_m3: number;
  charge_amount_eur: number;
  charge_created: boolean;
};

export type LedgerKind = 'charge' | 'payment' | 'adjustment_debit' | 'adjustment_credit';

export function emptyBalance(): UtilityBalance {
  return {
    charged_eur: 0,
    paid_eur: 0,
    adjustments_debit_eur: 0,
    adjustments_credit_eur: 0,
    balance_eur: 0,
  };
}

export function formatEur(n: number) {
  return `${Number(n).toFixed(2)} €`;
}

export function formatM3(n: number) {
  return Number(n).toFixed(3);
}

export function todayIsoDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function balanceTone(balance: number): 'debt' | 'over' | 'settled' {
  if (balance > 0) return 'debt';
  if (balance < 0) return 'over';
  return 'settled';
}

export function lastActiveReading(readings: WaterReading[]): WaterReading | null {
  return readings.find((r) => r.status === 'active') ?? null;
}

export function mapSubmitWaterError(message: string): 'noMeter' | 'lower' | 'datePrev' | 'future' | 'conflict' | 'generic' {
  const msg = message.toLowerCase();
  if (msg.includes('no active water meter')) return 'noMeter';
  if (msg.includes('cannot be lower than previous')) return 'lower';
  if (msg.includes('earlier than previous reading')) return 'datePrev';
  if (msg.includes('cannot be in the future')) return 'future';
  if (msg.includes('idempotency key conflict')) return 'conflict';
  return 'generic';
}

export const STAFF_ROLE_ADMIN = 'администрация';
export const STAFF_ROLE_ACCOUNTANT = 'бухгалтер';
export const STAFF_ROLE_ENGINEER = 'инженер';
export const STAFF_ROLE_CLEANER = 'уборщик';

export function exactStaffRole(role?: string | null) {
  return (role ?? '').trim().toLowerCase();
}

export function canSeeWaterAdmin(role?: string | null) {
  const r = exactStaffRole(role);
  return r === STAFF_ROLE_ADMIN || r === STAFF_ROLE_ACCOUNTANT || r === STAFF_ROLE_ENGINEER;
}

export function canAssignWaterMeter(role?: string | null) {
  const r = exactStaffRole(role);
  return r === STAFF_ROLE_ADMIN || r === STAFF_ROLE_ENGINEER;
}

export function canManageWaterTariff(role?: string | null) {
  const r = exactStaffRole(role);
  return r === STAFF_ROLE_ADMIN || r === STAFF_ROLE_ACCOUNTANT;
}

export function canManageWaterFinance(role?: string | null) {
  const r = exactStaffRole(role);
  return r === STAFF_ROLE_ADMIN || r === STAFF_ROLE_ACCOUNTANT;
}

export function canSeeCapitalAdmin(role?: string | null) {
  return canManageWaterFinance(role);
}

export type AdminRpcErrorKey =
  | 'admin.errMeterAssigned'
  | 'admin.errMeterInUse'
  | 'admin.errNoMeter'
  | 'admin.errReadingLower'
  | 'admin.errTariffDate'
  | 'admin.errCapitalDup'
  | 'admin.errIdempotency'
  | 'admin.errNoAccess'
  | 'admin.errGeneric';

export function mapAdminRpcError(message: string): AdminRpcErrorKey {
  const msg = message.toLowerCase();
  if (msg.includes('active water meter is already assigned')) return 'admin.errMeterAssigned';
  if (msg.includes('meter number is already in use')) return 'admin.errMeterInUse';
  if (msg.includes('no active water meter')) return 'admin.errNoMeter';
  if (msg.includes('cannot be lower than previous')) return 'admin.errReadingLower';
  if (msg.includes('tariff already exists') || msg.includes('already exists for this valid_from')) {
    return 'admin.errTariffDate';
  }
  if (msg.includes('capital repair charge already exists') || msg.includes('charge already exists')) {
    return 'admin.errCapitalDup';
  }
  if (msg.includes('idempotency key conflict')) return 'admin.errIdempotency';
  if (msg.includes('not authorized') || msg.includes('permission denied')) return 'admin.errNoAccess';
  return 'admin.errGeneric';
}

export function currentWaterTariff(tariffs: WaterTariff[], asOf = todayIsoDate()): WaterTariff | null {
  return tariffs.find((row) => row.valid_from <= asOf) ?? null;
}
