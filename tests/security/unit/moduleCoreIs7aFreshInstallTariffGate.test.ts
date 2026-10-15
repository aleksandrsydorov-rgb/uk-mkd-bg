import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  assertCanonicalMeterSchemaSql,
  assertCompanionMigrationOrdering,
  assertExistingInstallNoOpSafety,
  assertRlsAccessCompatibility,
  bootstrapModuleSetupAdapters,
  buildApartmentLookup,
  CANONICAL_METER_SCHEMA_PREREQUISITES,
  classifyElectricityMeterOpeningRows,
  classifyInternetOpeningRows,
  classifySupportFeeOpeningRows,
  classifyWaterMeterOpeningRows,
  ELECTRICITY_MODULE_KEY,
  evaluateAllTariffSetupGates,
  evaluateTariffSetupGate,
  FRESH_INSTALL_COMPANION_MIGRATION,
  FRESH_INSTALL_ORDERED_FILES,
  FRESH_INSTALL_PACKAGE_DIR,
  getModuleAdapter,
  INTERNET_MODULE_KEY,
  meterInventoryIndependentOfBillingTariff,
  parseFreshInstallManifest,
  propertyBookBlocksDependentSetup,
  REMAINING_GREENFIELD_MIGRATION_GAPS,
  resetModuleSetupAdaptersForTests,
  SUPPORT_FEE_MODULE_KEY,
  tariffGateChangesModuleActivation,
  WATER_MODULE_KEY,
  type TariffListSnapshot,
} from '@/lib/moduleCore';
import { dictionaries } from '@/i18n/messages';

const published: TariffListSnapshot[] = [
  { tariff_key: 'support_fee', module_key: 'support_fee', current_version_id: 'v-sf' },
  { tariff_key: 'internet', module_key: 'internet', current_version_id: 'v-net' },
  { tariff_key: 'water', module_key: 'water', current_version_id: 'v-w' },
  { tariff_key: 'electricity', module_key: 'electricity', current_version_id: 'v-e' },
  { tariff_key: 'capital_repair', module_key: 'capital_repair', current_version_id: 'v-c' },
];

const unpublished: TariffListSnapshot[] = [
  { tariff_key: 'support_fee', module_key: 'support_fee', current_version_id: null },
  { tariff_key: 'internet', module_key: 'internet', current_version_id: null },
  { tariff_key: 'water', module_key: 'water', current_version_id: null },
  { tariff_key: 'electricity', module_key: 'electricity', current_version_id: null },
  { tariff_key: 'capital_repair', module_key: 'capital_repair', current_version_id: null },
];

function packageSqlConcat(): string {
  return FRESH_INSTALL_ORDERED_FILES.map((f) =>
    readFileSync(path.resolve(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, f), 'utf8'),
  ).join('\n\n');
}

function companionSql(): string {
  return readFileSync(path.resolve(process.cwd(), FRESH_INSTALL_COMPANION_MIGRATION), 'utf8');
}

describe('IS-7a · fresh-install DDL packaging', () => {
  it('package files and manifest order exist', () => {
    for (const f of FRESH_INSTALL_ORDERED_FILES) {
      expect(existsSync(path.resolve(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, f))).toBe(true);
    }
    const manifest = parseFreshInstallManifest(
      readFileSync(path.resolve(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, 'MANIFEST.json'), 'utf8'),
    );
    expect(manifest.applyBeforeMigrations).toBe(true);
    expect(manifest.orderedFiles).toEqual([...FRESH_INSTALL_ORDERED_FILES]);
    expect(manifest.companionMigration.replace(/\\/g, '/')).toContain(
      path.basename(FRESH_INSTALL_COMPANION_MIGRATION),
    );
    expect(manifest.requiredRelationsAfterPackage).toEqual(
      expect.arrayContaining([...CANONICAL_METER_SCHEMA_PREREQUISITES]),
    );
    expect(manifest.explicitRemainingGaps).toEqual(
      expect.arrayContaining([...REMAINING_GREENFIELD_MIGRATION_GAPS]),
    );
    expect(manifest.forbidden.some((f) => f.includes('DO_NOT_RUN'))).toBe(true);
  });

  it('migration ordering places companion after IS-6a', () => {
    const names = readdirSync(path.resolve(process.cwd(), 'supabase/migrations')).filter((f) =>
      f.endsWith('.sql'),
    );
    const order = assertCompanionMigrationOrdering(names);
    expect(order.companionPresent).toBe(true);
    expect(order.afterIs6a).toBe(true);
    expect(order.ok).toBe(true);
  });

  it('canonical meter schema prerequisites are packaged', () => {
    const schema = assertCanonicalMeterSchemaSql(packageSqlConcat());
    expect(schema.ok).toBe(true);
    expect(schema.hasWaterMeters).toBe(true);
    expect(schema.hasElectricityMeters).toBe(true);
    expect(schema.hasWaterFk).toBe(true);
    expect(schema.hasElectricityFk).toBe(true);
  });

  it('RLS/access compatibility is conditional and non-destructive', () => {
    expect(assertRlsAccessCompatibility(packageSqlConcat()).ok).toBe(true);
    expect(assertRlsAccessCompatibility(companionSql()).ok).toBe(true);
  });

  it('existing-installation companion migration is no-op safe', () => {
    const companion = companionSql();
    const safety = assertExistingInstallNoOpSafety(companion);
    expect(safety.ok).toBe(true);
    expect(safety.usesIfNotExists).toBe(true);
    expect(safety.noDangerousDdl).toBe(true);
    expect(safety.noLegacyDoNotRun).toBe(true);
    expect(companion).not.toMatch(
      /\binsert\s+into\s+public\.(water_meters|electricity_meters|properties)\b/i,
    );
    expect(companion).not.toMatch(
      /\bupdate\s+public\.(water_meters|electricity_meters|properties)\b/i,
    );
  });

  it('marks remaining greenfield gaps explicitly (PARTIAL readiness)', () => {
    expect(REMAINING_GREENFIELD_MIGRATION_GAPS.length).toBeGreaterThan(0);
    expect(REMAINING_GREENFIELD_MIGRATION_GAPS).toContain('property_registry_people');
    expect(REMAINING_GREENFIELD_MIGRATION_GAPS).toContain('water_readings');
  });
});

describe('IS-7a · tariff setup gate', () => {
  it('missing published tariff blocks Support Fee and Internet import', () => {
    const sf = evaluateTariffSetupGate('support_fee', unpublished)!;
    const net = evaluateTariffSetupGate('internet', unpublished)!;
    expect(sf.importBlockedByMissingTariff).toBe(true);
    expect(net.importBlockedByMissingTariff).toBe(true);
    expect(sf.importReady).toBe(false);
    expect(net.billingReady).toBe(false);
  });

  it('published tariffs clear Support Fee and Internet readiness', () => {
    const sf = evaluateTariffSetupGate('support_fee', published)!;
    const net = evaluateTariffSetupGate('internet', published)!;
    expect(sf.hasPublishedApplicable).toBe(true);
    expect(net.hasPublishedApplicable).toBe(true);
    expect(sf.importReady).toBe(true);
    expect(net.importReady).toBe(true);
  });

  it('Support Fee classify surfaces tariff_not_configured', () => {
    const apartmentsByNumber = buildApartmentLookup([{ property_id: 1, apartment_number: '101' }]);
    const row = {
      apartment_number: '101',
      billing_year: '2025',
      obligation_type: 'support_fee',
      assessed_amount: '100',
      historically_paid_amount: '0',
      remaining_debt: '100',
      opening_overpayment: '0',
      transition_date: '2026-01-01',
    };
    const blocked = classifySupportFeeOpeningRows([row], {
      apartmentsByNumber,
      existingByScope: new Map(),
      openingImportsByScope: new Map(),
      supportFeeTariffConfigured: false,
    });
    expect(blocked.rows[0]?.errors).toContain('tariff_not_configured');

    const ok = classifySupportFeeOpeningRows([row], {
      apartmentsByNumber,
      existingByScope: new Map(),
      openingImportsByScope: new Map(),
      supportFeeTariffConfigured: true,
    });
    expect(ok.createCount).toBe(1);
    expect(ok.rows[0]?.errors).not.toContain('tariff_not_configured');
  });

  it('Internet classify surfaces tariff_not_configured', () => {
    const preview = classifyInternetOpeningRows(
      [
        {
          apartment_number: '101',
          tariff_code: 'internet',
          status: 'active',
          connection_date: '2025-06-01',
          transition_date: '2026-01-01',
          paid_through: '2026-04-30',
          opening_debt: '0',
          opening_credit: '0',
        },
      ],
      {
        apartmentsByNumber: buildApartmentLookup([{ property_id: 10, apartment_number: '101' }]),
        existingByProperty: new Map(),
        openingImportsByProperty: new Map(),
        pendingWoPropertyIds: new Set(),
        internetTariffConfigured: false,
        sofiaTodayIso: '2026-03-15',
      },
    );
    expect(preview.rows[0]?.errors).toContain('tariff_not_configured');
  });

  it('water/electricity inventory independent of billing tariffs', () => {
    expect(meterInventoryIndependentOfBillingTariff('water')).toBe(true);
    expect(meterInventoryIndependentOfBillingTariff('electricity')).toBe(true);
    const waterGate = evaluateTariffSetupGate('water', unpublished)!;
    const elGate = evaluateTariffSetupGate('electricity', unpublished)!;
    expect(waterGate.importBlockedByMissingTariff).toBe(false);
    expect(elGate.importBlockedByMissingTariff).toBe(false);
    expect(waterGate.billingBlockedByMissingTariff).toBe(true);
    expect(elGate.billingBlockedByMissingTariff).toBe(true);

    const ctx = {
      apartmentsByNumber: buildApartmentLookup([{ property_id: 1, apartment_number: '12' }]),
      activePropertyIds: new Set<number>(),
      existingSerials: new Set<string>(),
      policy: { allowReplace: false as const },
    };
    const water = classifyWaterMeterOpeningRows(
      [
        {
          apartment_number: '12',
          meter_number: 'W-12-001',
          initial_reading: '0',
          installed_at: '2026-01-15',
        },
      ],
      ctx,
    );
    const el = classifyElectricityMeterOpeningRows(
      [
        {
          apartment_number: '12',
          meter_number: 'E-12-001',
          initial_day_reading: '0',
          initial_night_reading: '0',
          installed_at: '2026-01-15',
        },
      ],
      ctx,
    );
    expect(water.createCount).toBe(1);
    expect(el.createCount).toBe(1);
    expect(water.rows[0]?.errors ?? []).not.toContain('tariff_not_configured');
    expect(el.rows[0]?.errors ?? []).not.toContain('tariff_not_configured');
  });

  it('Property Book gate blocks property-dependent setup', () => {
    expect(
      propertyBookBlocksDependentSetup({
        moduleKey: 'support_fee',
        propertyBookReadyOrVerified: false,
      }),
    ).toBe(true);
    expect(
      propertyBookBlocksDependentSetup({
        moduleKey: 'water',
        propertyBookReadyOrVerified: true,
      }),
    ).toBe(false);
  });

  it('does not auto-activate modules', () => {
    resetModuleSetupAdaptersForTests();
    bootstrapModuleSetupAdapters();
    expect(tariffGateChangesModuleActivation()).toBe(false);
    expect(getModuleAdapter(SUPPORT_FEE_MODULE_KEY)?.registration.requiresInitialSetup).toBe(true);
    expect(getModuleAdapter(INTERNET_MODULE_KEY)?.registration.requiresInitialSetup).toBe(true);
    expect(getModuleAdapter(WATER_MODULE_KEY)?.registration.activationPrerequisites).not.toContain(
      'tariff_core_water_configured',
    );
    expect(
      getModuleAdapter(ELECTRICITY_MODULE_KEY)?.registration.activationPrerequisites,
    ).not.toContain('tariff_core_electricity_configured');
    const all = evaluateAllTariffSetupGates(published);
    expect(all.every((r) => r.importReady && r.billingReady)).toBe(true);
  });

  it('BG/RU/EN prerequisite messages exist', () => {
    const keys = [
      'is7aTariffMissingSupportFee',
      'is7aTariffMissingInternet',
      'is7aTariffMissingWaterBilling',
      'is7aTariffMissingElectricityBilling',
      'is7aMeterInventoryIndependentWater',
      'is7aMeterInventoryIndependentElectricity',
      'is7aPropertyBookRequired',
    ] as const;
    for (const locale of ['ru', 'en', 'bg'] as const) {
      const admin = dictionaries[locale].admin as Record<string, string>;
      for (const key of keys) {
        expect(String(admin[key] ?? '').trim().length).toBeGreaterThan(10);
      }
    }
  });

  it('existing data preservation: companion SQL has no DML on domain tables', () => {
    const sql = companionSql();
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    const packageReadme = readFileSync(
      path.resolve(process.cwd(), 'supabase/packages/fresh_install/README.md'),
      'utf8',
    );
    expect(packageReadme).toMatch(/No seed of AMADEUS 11 production rows/i);
  });
});
