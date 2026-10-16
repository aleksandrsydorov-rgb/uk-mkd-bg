import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  assertCanonicalIs9aSchemaSql,
  assertCanonicalIs9bSchemaSql,
  assertCanonicalMeterSchemaSql,
  assertCompanionMigrationOrdering,
  assertExistingInstallNoOpSafety,
  assertFreshInstallDependencyOrder,
  assertIs9aCompanionMigrationOrdering,
  assertIs9aExistingInstallNoOpSafety,
  assertIs9aRlsCompleteness,
  assertIs9bCompanionMigrationOrdering,
  assertIs9bExistingInstallNoOpSafety,
  assertIs9bRlsAndSecurity,
  assertNoAmadeus11ProductionData,
  assertPackageObjectCoverage,
  assertRlsAccessCompatibility,
  bootstrapModuleSetupAdapters,
  buildApartmentLookup,
  CANONICAL_IS9A_SCHEMA_PREREQUISITES,
  CANONICAL_IS9B_SCHEMA_PREREQUISITES,
  CANONICAL_METER_SCHEMA_PREREQUISITES,
  classifyElectricityMeterOpeningRows,
  classifyInternetOpeningRows,
  classifySupportFeeOpeningRows,
  classifyWaterMeterOpeningRows,
  ELECTRICITY_MODULE_KEY,
  evaluateAllTariffSetupGates,
  evaluateTariffSetupGate,
  FRESH_INSTALL_COMPANION_MIGRATION,
  FRESH_INSTALL_IS9A_COMPANION_MIGRATION,
  FRESH_INSTALL_IS9B_COMPANION_MIGRATION,
  FRESH_INSTALL_IS10D_COMPANION_MIGRATION,
  FRESH_INSTALL_ORDERED_FILES,
  FRESH_INSTALL_PACKAGE_DIR,
  FRESH_INSTALL_PACKAGE_STATUS,
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

function is9aCompanionSql(): string {
  return readFileSync(path.resolve(process.cwd(), FRESH_INSTALL_IS9A_COMPANION_MIGRATION), 'utf8');
}

function is9bCompanionSql(): string {
  return readFileSync(path.resolve(process.cwd(), FRESH_INSTALL_IS9B_COMPANION_MIGRATION), 'utf8');
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
      path.basename(FRESH_INSTALL_IS10D_COMPANION_MIGRATION),
    );
    expect(manifest.companionMigrations ?? []).toEqual(
      expect.arrayContaining([
        expect.stringContaining(path.basename(FRESH_INSTALL_COMPANION_MIGRATION)),
        expect.stringContaining(path.basename(FRESH_INSTALL_IS9A_COMPANION_MIGRATION)),
        expect.stringContaining(path.basename(FRESH_INSTALL_IS9B_COMPANION_MIGRATION)),
        expect.stringContaining(path.basename(FRESH_INSTALL_IS10D_COMPANION_MIGRATION)),
      ]),
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

  it('marks remaining greenfield gaps explicitly (no fake completeness)', () => {
    expect(REMAINING_GREENFIELD_MIGRATION_GAPS.length).toBeGreaterThan(0);
    expect(REMAINING_GREENFIELD_MIGRATION_GAPS).toContain(
      'rental_management_not_implemented',
    );
    expect(REMAINING_GREENFIELD_MIGRATION_GAPS).not.toContain('property_registry_people');
    expect(REMAINING_GREENFIELD_MIGRATION_GAPS).not.toContain('water_readings');
    expect(REMAINING_GREENFIELD_MIGRATION_GAPS).not.toContain('owns_property_book_only_helpers');
    expect(REMAINING_GREENFIELD_MIGRATION_GAPS).not.toContain(
      'isolated_empty_environment_execution_proof',
    );
  });
});

describe('IS-9a · fresh-install Book/auth/capital/tariff packaging', () => {
  it('manifest covers IS-9a baselines within IS-9b package', () => {
    const manifest = parseFreshInstallManifest(
      readFileSync(path.resolve(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, 'MANIFEST.json'), 'utf8'),
    );
    expect(manifest.orderedFiles).toEqual([...FRESH_INSTALL_ORDERED_FILES]);
    expect(manifest.orderedFiles).toContain('05_auth_staff_helpers.sql');
    expect(manifest.orderedFiles).toContain('50_capital_repair_baseline.sql');
    expect(manifest.orderedFiles).toContain('70_tariff_catalog_shell.sql');
    expect(manifest.requiredRelationsAfterPackage).toEqual(
      expect.arrayContaining([
        ...CANONICAL_METER_SCHEMA_PREREQUISITES,
        ...CANONICAL_IS9A_SCHEMA_PREREQUISITES,
      ]),
    );
    expect(manifest.requiredFunctionsAfterPackage).toEqual(
      expect.arrayContaining(['public.is_staff()', 'public.has_staff_role(text)']),
    );
    expect(manifest.explicitRemainingGaps).toEqual(
      expect.arrayContaining([...REMAINING_GREENFIELD_MIGRATION_GAPS]),
    );
  });

  it('IS-9a companion sorts after IS-8 opening migration', () => {
    const names = readdirSync(path.resolve(process.cwd(), 'supabase/migrations')).filter((f) =>
      f.endsWith('.sql'),
    );
    const order = assertIs9aCompanionMigrationOrdering(names);
    expect(order.companionPresent).toBe(true);
    expect(order.afterIs8).toBe(true);
    expect(order.ok).toBe(true);
  });

  it('canonical Book/auth/capital/tariff schema is packaged without portal-email owns_property', () => {
    const schema = assertCanonicalIs9aSchemaSql(packageSqlConcat());
    expect(schema.ok).toBe(true);
    expect(schema.hasOpeningKinds).toBe(true);
    expect(schema.noOwnsPropertyInvention).toBe(true);
    expect(schema.noPublishedTariffVersions).toBe(true);
  });

  it('auth helpers use SECURITY DEFINER empty search_path and least privilege', () => {
    const sql = packageSqlConcat();
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.has_staff_role/i);
    expect(sql).toMatch(/security\s+definer/i);
    expect(sql).toMatch(/set\s+search_path\s*=\s*''/i);
    // Staff rows only via install_bootstrap_claim_first_admin — never seeded emails/passwords.
    expect(sql).toMatch(/install_bootstrap_claim_first_admin/i);
    expect(sql).not.toMatch(/password\s*=/i);
    expect(sql).not.toMatch(/@amadeus11\.(online|bg|com)/i);
  });

  it('RLS completeness for staff/registry/capital/tariff', () => {
    expect(assertIs9aRlsCompleteness(packageSqlConcat()).ok).toBe(true);
    expect(assertIs9aRlsCompleteness(is9aCompanionSql()).ok).toBe(true);
  });

  it('tariff bootstrap has catalog definitions without published prices', () => {
    const sql = packageSqlConcat();
    expect(sql).toMatch(/insert\s+into\s+public\.tariff_catalog/i);
    // IS-10d may insert a cancelled distributive sentinel; must not publish.
    expect(sql).not.toMatch(
      /insert\s+into\s+public\.tariff_versions[\s\S]*?\bvalues\b[\s\S]*?'published'/i,
    );
    expect(sql).toMatch(/86_distributive_block_amadeus11_sf_cutover/i);
    expect(sql).toMatch(/No published prices/i);
  });

  it('no AMADEUS 11-specific apartment/owner production data', () => {
    expect(assertNoAmadeus11ProductionData(packageSqlConcat()).ok).toBe(true);
    expect(assertNoAmadeus11ProductionData(is9aCompanionSql()).ok).toBe(true);
  });

  it('IS-9a companion is existing-install no-op / data-safe', () => {
    const safety = assertIs9aExistingInstallNoOpSafety(is9aCompanionSql());
    expect(safety.ok).toBe(true);
    expect(safety.noStaffInsert).toBe(true);
    expect(safety.noTariffVersionsInsert).toBe(true);
    expect(safety.noCredentials).toBe(true);
  });

  it('package completeness: every ordered file exists and dependency order is deterministic', () => {
    const order = assertFreshInstallDependencyOrder(FRESH_INSTALL_ORDERED_FILES);
    expect(order.ok).toBe(true);
    for (const f of FRESH_INSTALL_ORDERED_FILES) {
      expect(existsSync(path.resolve(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, f))).toBe(true);
    }
  });

  it('capital repair remains independent of support fee opening mechanisms', () => {
    const capitalSql = readFileSync(
      path.resolve(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, '50_capital_repair_baseline.sql'),
      'utf8',
    );
    expect(capitalSql).not.toMatch(/support_fee/i);
    expect(capitalSql).not.toMatch(/opening_obligation.*support/i);
    expect(capitalSql).toMatch(/opening_obligation/);
  });
});

describe('IS-9b · complete fresh-install database dependencies', () => {
  it('manifest status READY_FOR_ISOLATED_TEST and phase IS-9b', () => {
    expect(FRESH_INSTALL_PACKAGE_STATUS).toBe('READY_FOR_ISOLATED_TEST');
    const manifest = parseFreshInstallManifest(
      readFileSync(path.resolve(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, 'MANIFEST.json'), 'utf8'),
    );
    expect(manifest.status).toBe('READY_FOR_ISOLATED_TEST');
    expect(manifest.phase).toBe('IS-10d');
    expect(manifest.excludeFromCompanion).toContain('00_preflight_refuse_populated.sql');
    expect(manifest.requiredRelationsAfterPackage).toEqual(
      expect.arrayContaining([...CANONICAL_IS9B_SCHEMA_PREREQUISITES]),
    );
    expect(manifest.requiredFunctionsAfterPackage).toEqual(
      expect.arrayContaining([
        'public.owns_property(bigint)',
        'public.record_capital_repair_payment(bigint,numeric,text,uuid)',
        'public.charge_capital_repair(bigint,uuid,integer,text,uuid)',
        'public.install_bootstrap_claim_first_admin(text,text)',
      ]),
    );
  });

  it('IS-9b companion sorts after IS-9a and excludes preflight', () => {
    const names = readdirSync(path.resolve(process.cwd(), 'supabase/migrations')).filter((f) =>
      f.endsWith('.sql'),
    );
    const order = assertIs9bCompanionMigrationOrdering(names);
    expect(order.ok).toBe(true);
    const companion = is9bCompanionSql();
    expect(assertIs9bExistingInstallNoOpSafety(companion).ok).toBe(true);
    expect(companion).not.toMatch(/fresh_install_preflight/i);
  });

  it('Book + utilities + capital + tariff + bootstrap schema coverage', () => {
    const schema = assertCanonicalIs9bSchemaSql(packageSqlConcat());
    expect(schema.ok).toBe(true);
    expect(schema.hasOwnsProperty).toBe(true);
    expect(schema.hasMeterReadings).toBe(true);
    expect(schema.hasWaterLedger).toBe(true);
    expect(schema.hasCapitalCharge).toBe(true);
    expect(schema.hasFirstAdminBootstrap).toBe(true);
    expect(schema.noPublishedPrices).toBe(true);
  });

  it('RLS/security and bootstrap least privilege', () => {
    expect(assertIs9bRlsAndSecurity(packageSqlConcat()).ok).toBe(true);
  });

  it('package object coverage matches MANIFEST required lists', () => {
    const manifest = parseFreshInstallManifest(
      readFileSync(path.resolve(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, 'MANIFEST.json'), 'utf8'),
    );
    const coverage = assertPackageObjectCoverage(
      packageSqlConcat(),
      manifest.requiredRelationsAfterPackage,
      manifest.requiredFunctionsAfterPackage ?? [],
    );
    expect(coverage.missingRelations).toEqual([]);
    expect(coverage.missingFunctions).toEqual([]);
    expect(coverage.ok).toBe(true);
  });

  it('no AMADEUS 11 production data; no credentials', () => {
    const sql = packageSqlConcat();
    expect(assertNoAmadeus11ProductionData(sql).ok).toBe(true);
    expect(sql).not.toMatch(/password\s*=/i);
    expect(sql).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\./);
  });

  it('dependency order places Book auth before meter RLS and tariff versions after catalog', () => {
    expect(assertFreshInstallDependencyOrder(FRESH_INSTALL_ORDERED_FILES).ok).toBe(true);
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
