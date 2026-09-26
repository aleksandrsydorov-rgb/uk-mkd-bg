import type { Database } from '@/lib/database.types';

export type WaterMeter = Database['public']['Tables']['water_meters']['Row'];
/** @deprecated Prefer ApplicableUtilityTariff from tariffs.ts for current rates. Legacy table shape kept for historical SELECT. */
export type WaterTariff = Database['public']['Tables']['water_tariffs']['Row'];
export type WaterReading = Database['public']['Tables']['water_readings']['Row'];
export type WaterLedger = Database['public']['Tables']['water_ledger']['Row'];

/** Core-backed current water rate for owner/admin display (Package 2). */
export type CurrentWaterTariffView = {
  tariff_version_id: string;
  valid_from: string;
  price_eur_per_m3: number;
};
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

/** Display-only money. Without locale keeps a stable 2-decimal string for existing callers. */
export function formatMoneyNumber(n: number, locale?: string) {
  const value = Number(n);
  const safe = Number.isFinite(value) ? value : 0;
  if (!locale) return safe.toFixed(2);
  return new Intl.NumberFormat(numberFormatLocale(locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

export function formatEur(n: number, locale?: string) {
  return `${formatMoneyNumber(n, locale)} €`;
}

export const WATER_VOLUME_DECIMALS = 1;
export const UTILITY_READING_DECIMALS = 1;

function numberFormatLocale(locale: string) {
  if (locale === 'en' || locale.startsWith('en')) return 'en-US';
  if (locale === 'bg' || locale.startsWith('bg')) return 'bg-BG';
  return 'ru-RU';
}

export function formatUtilityReading(n: number, locale: string = 'ru') {
  return new Intl.NumberFormat(numberFormatLocale(locale), {
    minimumFractionDigits: UTILITY_READING_DECIMALS,
    maximumFractionDigits: UTILITY_READING_DECIMALS,
  }).format(Number(n));
}

export function formatM3(n: number, locale: string = 'ru') {
  return formatUtilityReading(n, locale);
}

export function formatKwh(n: number, locale: string = 'ru') {
  return formatUtilityReading(n, locale);
}

export function normalizeWaterVolume(n: number) {
  return Number(Number(n).toFixed(WATER_VOLUME_DECIMALS));
}

export function parseWaterVolume(raw: string) {
  return Number(String(raw).replace(',', '.'));
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

export function mapSubmitWaterError(message: string): 'noMeter' | 'lower' | 'datePrev' | 'future' | 'conflict' | 'disabled' | 'staffOnly' | 'generic' {
  const msg = message.toLowerCase();
  if (msg.includes('water readings are disabled')) return 'disabled';
  if (msg.includes('submitted by the management company') || (msg.includes('not authorized') && msg.includes('staff'))) return 'staffOnly';
  if (msg.includes('no active water meter')) return 'noMeter';
  if (msg.includes('cannot be lower than previous')) return 'lower';
  if (msg.includes('earlier than previous reading') || msg.includes('earlier than meter installation')) return 'datePrev';
  if (msg.includes('cannot be in the future')) return 'future';
  if (msg.includes('idempotency key conflict')) return 'conflict';
  return 'generic';
}

export const STAFF_ROLE_ADMIN = 'администрация';
export const STAFF_ROLE_ACCOUNTANT = 'бухгалтер';
export const STAFF_ROLE_ENGINEER = 'инженер';
export const STAFF_ROLE_CLEANER = 'уборщик';

export function exactStaffRole(role?: string | null) {
  return role ?? '';
}

export function canSeeWaterAdmin(role?: string | null) {
  const r = exactStaffRole(role);
  return r === STAFF_ROLE_ADMIN || r === STAFF_ROLE_ACCOUNTANT || r === STAFF_ROLE_ENGINEER;
}

export function canAssignWaterMeter(role?: string | null) {
  const r = exactStaffRole(role);
  return r === STAFF_ROLE_ADMIN || r === STAFF_ROLE_ENGINEER;
}

export type WaterMode = 'owner_and_staff' | 'staff_only';
export const DEFAULT_WATER_MODE: WaterMode = 'owner_and_staff';

export function parseWaterMode(value: unknown): WaterMode {
  if (value === 'owner_and_staff' || value === 'staff_only') {
    return value;
  }
  // Legacy `disabled` → module off; remap to default when mode column still holds it.
  return DEFAULT_WATER_MODE;
}

/** Owner can use the surface when module is on and mode is not staff-only. */
export function isOwnerModuleEnabled(mode: string | null | undefined) {
  return mode === 'owner_and_staff' || mode === 'staff_only';
}

export function canSubmitWaterStaff(role?: string | null, active?: boolean | null) {
  if (active !== true) return false;
  return canAssignWaterMeter(role);
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

export function canSeeElectricityFinance(role?: string | null) {
  return canManageWaterFinance(role);
}

export function canManageElectricityTariff(role?: string | null) {
  return canManageWaterTariff(role);
}

export type AdminRpcErrorKey =
  | 'admin.errMeterAssigned'
  | 'admin.errMeterInUse'
  | 'admin.errNoMeter'
  | 'admin.errReadingLower'
  | 'admin.errTariffDate'
  | 'admin.errNoTariff'
  | 'admin.errLegacyTariffDisabled'
  | 'admin.errCapitalDup'
  | 'admin.errIdempotency'
  | 'admin.errNoAccess'
  | 'admin.errReadingsDisabled'
  | 'admin.errGeneric';

export function mapAdminRpcError(message: string): AdminRpcErrorKey {
  const msg = message.toLowerCase();
  if (msg.includes('active water meter is already assigned') || msg.includes('active electricity meter is already assigned')) return 'admin.errMeterAssigned';
  if (msg.includes('meter number is already in use')) return 'admin.errMeterInUse';
  if (msg.includes('no active water meter') || msg.includes('no active electricity meter') || msg.includes('electricity meter is not assigned')) return 'admin.errNoMeter';
  if (msg.includes('cannot be lower than previous')) return 'admin.errReadingLower';
  if (msg.includes('no electricity tariff is defined') || msg.includes('no water tariff configured')) return 'admin.errNoTariff';
  if (msg.includes('legacy tariff publication disabled')) return 'admin.errLegacyTariffDisabled';
  if (msg.includes('tariff already exists') || msg.includes('already exists for this valid_from')) {
    return 'admin.errTariffDate';
  }
  if (msg.includes('capital repair charge already exists') || msg.includes('charge already exists')) {
    return 'admin.errCapitalDup';
  }
  if (msg.includes('idempotency key conflict')) return 'admin.errIdempotency';
  if (msg.includes('water readings are disabled') || msg.includes('electricity readings are disabled')) return 'admin.errReadingsDisabled';
  if (msg.includes('not authorized') || msg.includes('permission denied')) return 'admin.errNoAccess';
  return 'admin.errGeneric';
}

export function currentWaterTariff(tariffs: WaterTariff[], asOf = todayIsoDate()): WaterTariff | null {
  return tariffs.find((row) => row.valid_from <= asOf) ?? null;
}

export function currentWaterTariffViewFromCore(row: {
  tariff_version_id: string;
  valid_from: string;
  rates: Record<string, number> | null;
} | null): CurrentWaterTariffView | null {
  if (!row?.rates) return null;
  const price = Number(row.rates.base);
  if (!Number.isFinite(price)) return null;
  return {
    tariff_version_id: row.tariff_version_id,
    valid_from: row.valid_from,
    price_eur_per_m3: price,
  };
}
