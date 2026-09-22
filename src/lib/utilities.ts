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
