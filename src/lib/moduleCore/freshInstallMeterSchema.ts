/**
 * IS-7a — Fresh-install Property Book / meter DDL packaging helpers.
 * Pure analysis (no node:fs) so client bundles stay clean.
 */

export const FRESH_INSTALL_PACKAGE_DIR = 'supabase/packages/fresh_install';
export const FRESH_INSTALL_COMPANION_MIGRATION =
  'supabase/migrations/20261026120000_is7a_fresh_install_meter_baseline_ddl.sql';

export const FRESH_INSTALL_ORDERED_FILES = [
  '00_properties_baseline.sql',
  '10_water_meters.sql',
  '20_electricity_meters.sql',
  '30_meter_rls_enable.sql',
] as const;

/** Relations this package aims to establish before chronological migrations. */
export const CANONICAL_METER_SCHEMA_PREREQUISITES = [
  'public.properties',
  'public.water_meters',
  'public.electricity_meters',
] as const;

/** Explicit greenfield gaps — package + migrations alone are PARTIAL. */
export const REMAINING_GREENFIELD_MIGRATION_GAPS = [
  'property_registry_people',
  'meter_readings',
  'water_readings',
  'water_ledger',
  'electricity_ledger',
  'full_property_book_rpc_baseline',
  'auth_helpers_owns_property_has_staff_role',
  'tariff_catalog_publish_seed',
] as const;

export type FreshInstallManifest = {
  packageId: string;
  phase: string;
  applyBeforeMigrations: boolean;
  orderedFiles: string[];
  companionMigration: string;
  requiredRelationsAfterPackage: string[];
  explicitRemainingGaps: string[];
  forbidden: string[];
};

export function parseFreshInstallManifest(raw: string): FreshInstallManifest {
  return JSON.parse(raw) as FreshInstallManifest;
}

/** Lexicographic migration order: companion must sort after IS-6a. */
export function assertCompanionMigrationOrdering(migrationFileNames: string[]): {
  ok: boolean;
  companionPresent: boolean;
  afterIs6a: boolean;
} {
  const companion = FRESH_INSTALL_COMPANION_MIGRATION.split('/').pop()!;
  const sorted = [...migrationFileNames].sort();
  const companionPresent = sorted.includes(companion);
  const is6a = '20261025120000_is6a_uk_expense_opening.sql';
  const afterIs6a =
    companionPresent &&
    sorted.indexOf(is6a) >= 0 &&
    sorted.indexOf(companion) > sorted.indexOf(is6a);
  return { ok: companionPresent && afterIs6a, companionPresent, afterIs6a };
}

const DANGEROUS_DDL =
  /\b(drop\s+table|truncate|cascade\s*;|delete\s+from\s+public\.(water_meters|electricity_meters|properties))\b/i;

/** Existing-install safety: must be idempotent CREATE IF NOT EXISTS, no destructive ops. */
export function assertExistingInstallNoOpSafety(sql: string): {
  ok: boolean;
  usesIfNotExists: boolean;
  noDangerousDdl: boolean;
  noLegacyDoNotRun: boolean;
} {
  const usesIfNotExists =
    /create\s+table\s+if\s+not\s+exists\s+public\.water_meters/i.test(sql) &&
    /create\s+table\s+if\s+not\s+exists\s+public\.electricity_meters/i.test(sql);
  const noDangerousDdl = !DANGEROUS_DDL.test(sql);
  // Flag only executable includes — comments may mention DO_NOT_RUN.
  const noLegacyDoNotRun = !/(?:\\i|\\include|include)\s+.*DO_NOT_RUN/i.test(sql);
  return {
    ok: usesIfNotExists && noDangerousDdl && noLegacyDoNotRun,
    usesIfNotExists,
    noDangerousDdl,
    noLegacyDoNotRun,
  };
}

export function assertCanonicalMeterSchemaSql(sql: string): {
  ok: boolean;
  hasProperties: boolean;
  hasWaterMeters: boolean;
  hasElectricityMeters: boolean;
  hasWaterFk: boolean;
  hasElectricityFk: boolean;
} {
  const hasProperties = /create\s+table\s+if\s+not\s+exists\s+public\.properties/i.test(sql);
  const hasWaterMeters = /create\s+table\s+if\s+not\s+exists\s+public\.water_meters/i.test(sql);
  const hasElectricityMeters =
    /create\s+table\s+if\s+not\s+exists\s+public\.electricity_meters/i.test(sql);
  const hasWaterFk = /water_meters[\s\S]{0,400}references\s+public\.properties/i.test(sql);
  const hasElectricityFk =
    /electricity_meters[\s\S]{0,400}references\s+public\.properties/i.test(sql);
  return {
    ok: hasProperties && hasWaterMeters && hasElectricityMeters && hasWaterFk && hasElectricityFk,
    hasProperties,
    hasWaterMeters,
    hasElectricityMeters,
    hasWaterFk,
    hasElectricityFk,
  };
}

/** RLS compatibility: enable RLS; policies only when helpers exist (no blind overwrite). */
export function assertRlsAccessCompatibility(sql: string): {
  ok: boolean;
  enablesRls: boolean;
  conditionalPolicies: boolean;
  noDropPolicyBlind: boolean;
} {
  const enablesRls =
    /alter\s+table\s+public\.water_meters\s+enable\s+row\s+level\s+security/i.test(sql) &&
    /alter\s+table\s+public\.electricity_meters\s+enable\s+row\s+level\s+security/i.test(sql);
  const conditionalPolicies =
    /to_regprocedure\('public\.has_staff_role\(text\)'\)/i.test(sql) &&
    /if\s+not\s+exists\s*\([\s\S]*pg_policies/i.test(sql);
  const noDropPolicyBlind = !/drop\s+policy\s+if\s+exists\s+water_meters_select/i.test(sql);
  return {
    ok: enablesRls && conditionalPolicies && noDropPolicyBlind,
    enablesRls,
    conditionalPolicies,
    noDropPolicyBlind,
  };
}
