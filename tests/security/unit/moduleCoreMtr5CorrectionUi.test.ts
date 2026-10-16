import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bg, en, ru } from '@/i18n/messages';
import {
  canCorrectWaterReading,
  estimateWaterCorrectionDeltaEur,
  mapAdminRpcError,
  waterReadingHasCharge,
  STAFF_ROLE_ADMIN,
  STAFF_ROLE_ACCOUNTANT,
  STAFF_ROLE_ENGINEER,
} from '@/lib/utilities';
import {
  canCorrectElectricityReading,
  estimateElectricityCorrectionDeltaEur,
  latestCorrectableElectricityPair,
  pairElectricityReadings,
  type ElectricityMeter,
  type MeterReadingRow,
} from '@/lib/electricity';

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.resolve(ROOT, rel), 'utf8');
}

describe('MTR-5 · correction authorization helpers', () => {
  it('allows engineer uncharged; admin only when charged; blocks accountant/owner', () => {
    expect(canCorrectWaterReading(STAFF_ROLE_ENGINEER, true, false)).toBe(true);
    expect(canCorrectWaterReading(STAFF_ROLE_ENGINEER, true, true)).toBe(false);
    expect(canCorrectWaterReading(STAFF_ROLE_ADMIN, true, true)).toBe(true);
    expect(canCorrectWaterReading(STAFF_ROLE_ACCOUNTANT, true, false)).toBe(false);
    expect(canCorrectWaterReading(STAFF_ROLE_ADMIN, false, false)).toBe(false);

    expect(canCorrectElectricityReading(STAFF_ROLE_ENGINEER, true, false)).toBe(true);
    expect(canCorrectElectricityReading(STAFF_ROLE_ENGINEER, true, true)).toBe(false);
    expect(canCorrectElectricityReading(STAFF_ROLE_ADMIN, true, true)).toBe(true);
    expect(canCorrectElectricityReading('собственник', true, false)).toBe(false);
  });

  it('detects charge and estimates water delta matching charged RPC formula', () => {
    expect(waterReadingHasCharge({ charge_amount_eur: 0 })).toBe(false);
    expect(waterReadingHasCharge({ charge_amount_eur: 20 })).toBe(true);
    expect(
      estimateWaterCorrectionDeltaEur(
        { previous_value: 100, tariff_eur_per_m3: 2, charge_amount_eur: 20 },
        115,
      ),
    ).toBe(10);
    expect(
      estimateWaterCorrectionDeltaEur(
        { previous_value: 100, tariff_eur_per_m3: 2, charge_amount_eur: 0 },
        115,
      ),
    ).toBeNull();
  });

  it('estimates electricity delta only when charge ref is present', () => {
    expect(estimateElectricityCorrectionDeltaEur(null, 10, 5)).toBeNull();
    expect(
      estimateElectricityCorrectionDeltaEur(
        {
          id: 'c1',
          day_reading_id: 1,
          night_reading_id: 2,
          previous_day: 100,
          previous_night: 50,
          day_tariff_eur_per_kwh: 0.2,
          night_tariff_eur_per_kwh: 0.1,
          total_amount_eur: 3,
        },
        120,
        60,
      ),
    ).toBe(2);
  });
});

describe('MTR-5 · electricity pair ids for correction RPC', () => {
  it('pairs expose day/night reading ids and picks latest active correctable pair', () => {
    const meter: ElectricityMeter = {
      id: 'm1',
      property_id: 7,
      meter_number: 'EL-1',
      initial_day_reading: 0,
      initial_night_reading: 0,
      installed_at: '2026-01-01',
      retired_at: null,
      replacement_reason: null,
      assigned_by_email: 'a@b.c',
      created_at: '2026-01-01T00:00:00Z',
    };
    const rows: MeterReadingRow[] = [
      {
        id: 11,
        property_id: 7,
        meter_type: 'electricity_day',
        value: 10,
        reading_date: '2026-02-01',
        submitted_by: 'staff',
        created_at: '2026-02-01T10:00:00Z',
        idempotency_key: 'k1',
        electricity_meter_id: 'm1',
        status: 'active',
        reading_kind: 'operational',
      },
      {
        id: 12,
        property_id: 7,
        meter_type: 'electricity_night',
        value: 4,
        reading_date: '2026-02-01',
        submitted_by: 'staff',
        created_at: '2026-02-01T10:00:00Z',
        idempotency_key: 'k1',
        electricity_meter_id: 'm1',
        status: 'active',
        reading_kind: 'operational',
      },
      {
        id: 21,
        property_id: 7,
        meter_type: 'electricity_day',
        value: 5,
        reading_date: '2026-01-15',
        submitted_by: 'staff',
        created_at: '2026-01-15T10:00:00Z',
        idempotency_key: 'k0',
        electricity_meter_id: 'm1',
        status: 'active',
        reading_kind: 'opening',
      },
      {
        id: 22,
        property_id: 7,
        meter_type: 'electricity_night',
        value: 2,
        reading_date: '2026-01-15',
        submitted_by: 'staff',
        created_at: '2026-01-15T10:00:00Z',
        idempotency_key: 'k0',
        electricity_meter_id: 'm1',
        status: 'active',
        reading_kind: 'opening',
      },
    ];
    const pairs = pairElectricityReadings(rows, [meter]);
    expect(pairs[0]?.day_reading_id).toBe(11);
    expect(pairs[0]?.night_reading_id).toBe(12);
    const latest = latestCorrectableElectricityPair(pairs, meter);
    expect(latest?.day_reading_id).toBe(11);
    expect(latest?.night_reading_id).toBe(12);
  });
});

describe('MTR-5 · admin UI wiring (no invented finance)', () => {
  it('wires correct_water_reading into AdminWater with confirmation panel', () => {
    const src = read('src/components/admin/AdminWater.tsx');
    expect(src).toContain("rpc('correct_water_reading'");
    expect(src).toContain('AdminMeterCorrectionPanel');
    expect(src).toContain('canCorrectWaterReading');
    expect(src).toContain('estimateWaterCorrectionDeltaEur');
    expect(src).not.toMatch(/\.from\('water_readings'\)\s*\.update/);
    expect(src).not.toMatch(/\.from\('water_ledger'\)\s*\.insert/);
  });

  it('wires correct_electricity_reading into admin electricity readings UI', () => {
    const page = read('src/app/admin/page.tsx');
    expect(page).toContain("rpc('correct_electricity_reading'");
    expect(page).toContain('AdminMeterCorrectionPanel');
    expect(page).toContain('canCorrectElectricityReading');
    expect(page).toContain('openElectricityCorrection');
    expect(page).not.toMatch(/\.from\('meter_readings'\)\s*\.update/);
    expect(page).not.toMatch(/\.from\('electricity_ledger'\)\s*\.insert/);
  });

  it('does not expose correction RPCs on owner utility surfaces', () => {
    const water = read('src/components/account/OwnerUtilities.tsx');
    const el = read('src/components/account/OwnerElectricity.tsx');
    expect(water).not.toContain('correct_water_reading');
    expect(el).not.toContain('correct_electricity_reading');
  });

  it('maps correction RPC errors for display', () => {
    expect(mapAdminRpcError('Correction reason is required.')).toBe('admin.errCorrectionReason');
    expect(mapAdminRpcError('Only the latest active reading may be corrected.')).toBe(
      'admin.errCorrectionLatest',
    );
    expect(mapAdminRpcError('Financial adjustment already posted for this reading.')).toBe(
      'admin.errCorrectionAdjPosted',
    );
  });
});

describe('MTR-5 · BG/RU/EN localization', () => {
  const keys = [
    'meterCorrection',
    'meterCorrectionHint',
    'meterCorrectionReason',
    'meterCorrectionSubmit',
    'meterCorrectionAction',
    'meterCorrectionNewValue',
    'meterCorrectionNewDay',
    'meterCorrectionNewNight',
    'meterCorrectionNoCharge',
    'meterCorrectionImpact',
    'meterCorrectionImpactServer',
    'meterCorrectionOk',
    'meterCorrectionOriginal',
    'meterCorrectionOriginalEl',
    'errCorrectionReason',
    'errCorrectionLatest',
    'errCorrectionNotActive',
    'errCorrectionAdjPosted',
  ] as const;

  it('defines correction strings in ru/en/bg', () => {
    for (const key of keys) {
      expect(typeof ru.admin[key]).toBe('string');
      expect(String(ru.admin[key]).length).toBeGreaterThan(0);
      expect(typeof en.admin[key]).toBe('string');
      expect(String(en.admin[key]).length).toBeGreaterThan(0);
      expect(typeof bg.admin[key]).toBe('string');
      expect(String(bg.admin[key]).length).toBeGreaterThan(0);
    }
    expect(en.admin.meterCorrectionImpact).toContain('{amount}');
    expect(en.admin.meterCorrectionImpactServer.toLowerCase()).toContain('server');
  });
});
