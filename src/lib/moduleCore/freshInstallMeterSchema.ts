/**
 * IS-7a / IS-9a / IS-9b — Fresh-install DDL packaging helpers.
 * Pure analysis (no node:fs) so client bundles stay clean.
 */

export const FRESH_INSTALL_PACKAGE_DIR = 'supabase/packages/fresh_install';

/** @deprecated Prefer FRESH_INSTALL_COMPANION_MIGRATIONS — kept for IS-7a callers. */
export const FRESH_INSTALL_COMPANION_MIGRATION =
  'supabase/migrations/20261026120000_is7a_fresh_install_meter_baseline_ddl.sql';

export const FRESH_INSTALL_IS9A_COMPANION_MIGRATION =
  'supabase/migrations/20261028120000_is9a_fresh_install_book_auth_capital_tariff_ddl.sql';

export const FRESH_INSTALL_IS9B_COMPANION_MIGRATION =
  'supabase/migrations/20261029120000_is9b_fresh_install_complete_dependencies_ddl.sql';

/** IS-10d distributive neutralize — no-op on brownfield without install_distributive_flags. */
export const FRESH_INSTALL_IS10D_COMPANION_MIGRATION =
  'supabase/migrations/20261030120000_is10d_distributive_neutralize_amadeus11_sf_cutover.sql';

export const FRESH_INSTALL_COMPANION_MIGRATIONS = [
  FRESH_INSTALL_COMPANION_MIGRATION,
  FRESH_INSTALL_IS9A_COMPANION_MIGRATION,
  FRESH_INSTALL_IS9B_COMPANION_MIGRATION,
  FRESH_INSTALL_IS10D_COMPANION_MIGRATION,
] as const;

export const FRESH_INSTALL_ORDERED_FILES = [
  '00_preflight_refuse_populated.sql',
  '00_properties_baseline.sql',
  '05_auth_staff_helpers.sql',
  '10_water_meters.sql',
  '20_electricity_meters.sql',
  '40_property_registry_people.sql',
  '45_property_book_auth_helpers.sql',
  '46_property_book_portal_sync.sql',
  '30_meter_rls_enable.sql',
  '50_capital_repair_baseline.sql',
  '55_support_fee_ledger_baseline.sql',
  '57_general_meetings_baseline.sql',
  '58_pre_hardening_surface_baselines.sql',
  '60_module_catalog_baseline.sql',
  '70_tariff_catalog_shell.sql',
  '75_utilities_readings_ledgers.sql',
  '80_capital_repair_operational_rpcs.sql',
  '82_electricity_meter_assign_replace_rpcs.sql',
  '83_opening_readings_and_safe_corrections.sql',
  '83f_charged_paid_reading_corrections.sql',
  '84_utility_balance_payment_rpcs.sql',
  '85_tariff_versions_schema.sql',
  '85a_capital_repair_bulk_rpcs.sql',
  '86_distributive_block_amadeus11_sf_cutover.sql',
  '87_utility_submit_resolve_packaging.sql',
  '88_email_core_baseline.sql',
  '89_email_notification_policy.sql',
  '88b_r1_mt_hide_general_meeting.sql',
  '90_first_admin_bootstrap.sql',
  '91_r1_ui_polls_announcements_grants.sql',
  '92_r1_ui_cyrillic_role_literal_repair.sql',
  '93_r1_ui_admin_list_property_book_floor_cast.sql',
  '94_r1_ui_poll_votes_owner_select.sql',
  '95_r1_first_boot_invite.sql',
  '96_r1_module_catalog_implemented_parity.sql',
  '97_r1_rc8_restore_general_meeting.sql',
  '98_storage_buckets_baseline.sql',
  '99_r1_rc8_setup_adapter_catalog_parity.sql',
  '100_r1_rc8_property_book_shared_mixed_owners.sql',
  '101_r1_rc8_first_run_wizard.sql',
  '102_r1_rc8_meters_multi_opening_balance.sql',
  '103_r1_rc8_first_run_support_fee_opening.sql',
  '104_r1_rc8_support_fee_opening_close.sql',
  '105_r1_rc8_first_run_capital_repair_opening.sql',
  '106_r1_rc8_first_run_budget_stage.sql',
] as const;

export const FRESH_INSTALL_PACKAGE_STATUS = 'READY_FOR_ISOLATED_TEST' as const;

/** Relations this package aims to establish before chronological migrations. */
export const CANONICAL_METER_SCHEMA_PREREQUISITES = [
  'public.properties',
  'public.water_meters',
  'public.electricity_meters',
] as const;

export const CANONICAL_IS9A_SCHEMA_PREREQUISITES = [
  'public.staff',
  'public.property_registry_people',
  'public.property_absence_periods',
  'public.capital_repair_assessments',
  'public.capital_repair_ledger',
  'public.module_catalog',
  'public.building_modules',
  'public.tariff_catalog',
] as const;

export const CANONICAL_IS9B_SCHEMA_PREREQUISITES = [
  'public.water_tariffs',
  'public.water_readings',
  'public.water_ledger',
  'public.meter_readings',
  'public.electricity_tariffs',
  'public.electricity_charges',
  'public.electricity_ledger',
  'public.tariff_versions',
  'public.tariff_rate_items',
  'public.install_bootstrap_state',
] as const;

/** Explicit greenfield gaps after IS-9b / MTR-2 — isolated empty-env proof still required. */
export const REMAINING_GREENFIELD_MIGRATION_GAPS = [
  'publish_tariff_version_full_rpc_from_migrations',
  'full_property_book_import_transfer_rpc_surface_via_chronological_pkg_xfer_migrations',
  'rental_management_not_implemented',
] as const;

export type FreshInstallManifest = {
  packageId: string;
  phase: string;
  status?: string;
  applyBeforeMigrations: boolean;
  orderedFiles: string[];
  companionMigration: string;
  companionMigrations?: string[];
  requiredExtensions?: string[];
  requiredRelationsAfterPackage: string[];
  requiredFunctionsAfterPackage?: string[];
  dependencyChecks?: string[];
  safeFailureConditions?: string[];
  explicitRemainingGaps: string[];
  forbidden: string[];
  excludeFromCompanion?: string[];
};

export function parseFreshInstallManifest(raw: string): FreshInstallManifest {
  return JSON.parse(raw) as FreshInstallManifest;
}

/** Lexicographic migration order: IS-7a companion after IS-6a. */
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

/** IS-9a companion must sort after IS-8 opening migration. */
export function assertIs9aCompanionMigrationOrdering(migrationFileNames: string[]): {
  ok: boolean;
  companionPresent: boolean;
  afterIs8: boolean;
} {
  const companion = FRESH_INSTALL_IS9A_COMPANION_MIGRATION.split('/').pop()!;
  const sorted = [...migrationFileNames].sort();
  const companionPresent = sorted.includes(companion);
  const is8 = '20261027120000_is8_capital_repair_opening_state.sql';
  const afterIs8 =
    companionPresent &&
    sorted.indexOf(is8) >= 0 &&
    sorted.indexOf(companion) > sorted.indexOf(is8);
  return { ok: companionPresent && afterIs8, companionPresent, afterIs8 };
}

/** IS-9b companion must sort after IS-9a companion. */
export function assertIs9bCompanionMigrationOrdering(migrationFileNames: string[]): {
  ok: boolean;
  companionPresent: boolean;
  afterIs9a: boolean;
} {
  const companion = FRESH_INSTALL_IS9B_COMPANION_MIGRATION.split('/').pop()!;
  const is9a = FRESH_INSTALL_IS9A_COMPANION_MIGRATION.split('/').pop()!;
  const sorted = [...migrationFileNames].sort();
  const companionPresent = sorted.includes(companion);
  const afterIs9a =
    companionPresent &&
    sorted.indexOf(is9a) >= 0 &&
    sorted.indexOf(companion) > sorted.indexOf(is9a);
  return { ok: companionPresent && afterIs9a, companionPresent, afterIs9a };
}

const DANGEROUS_DDL =
  /\b(drop\s+table|truncate|cascade\s*;|delete\s+from\s+public\.(water_meters|electricity_meters|properties|staff|property_registry_people|capital_repair_ledger|capital_repair_assessments|tariff_catalog|water_ledger|electricity_ledger|meter_readings))\b/i;

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
  const noLegacyDoNotRun = !/(?:\\i|\\include|include)\s+.*DO_NOT_RUN/i.test(sql);
  return {
    ok: usesIfNotExists && noDangerousDdl && noLegacyDoNotRun,
    usesIfNotExists,
    noDangerousDdl,
    noLegacyDoNotRun,
  };
}

/** IS-9a companion: Book/auth/capital/tariff CREATE IF NOT EXISTS, no destructive ops. */
export function assertIs9aExistingInstallNoOpSafety(sql: string): {
  ok: boolean;
  usesIfNotExists: boolean;
  noDangerousDdl: boolean;
  noLegacyDoNotRun: boolean;
  noStaffInsert: boolean;
  noTariffVersionsInsert: boolean;
  noCredentials: boolean;
} {
  const usesIfNotExists =
    /create\s+table\s+if\s+not\s+exists\s+public\.staff/i.test(sql) &&
    /create\s+table\s+if\s+not\s+exists\s+public\.property_registry_people/i.test(sql) &&
    /create\s+table\s+if\s+not\s+exists\s+public\.capital_repair_assessments/i.test(sql) &&
    /create\s+table\s+if\s+not\s+exists\s+public\.capital_repair_ledger/i.test(sql) &&
    /create\s+table\s+if\s+not\s+exists\s+public\.tariff_catalog/i.test(sql);
  const noDangerousDdl = !DANGEROUS_DDL.test(sql);
  const noLegacyDoNotRun = !/(?:\\i|\\include|include)\s+.*DO_NOT_RUN/i.test(sql);
  const noStaffInsert = !/\binsert\s+into\s+public\.staff\b/i.test(sql);
  const noTariffVersionsInsert = !/\binsert\s+into\s+public\.tariff_versions\b/i.test(sql);
  const noCredentials =
    !/password\s*=/i.test(sql) &&
    !/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\./.test(sql);
  return {
    ok:
      usesIfNotExists &&
      noDangerousDdl &&
      noLegacyDoNotRun &&
      noStaffInsert &&
      noTariffVersionsInsert &&
      noCredentials,
    usesIfNotExists,
    noDangerousDdl,
    noLegacyDoNotRun,
    noStaffInsert,
    noTariffVersionsInsert,
    noCredentials,
  };
}

export function assertIs9bExistingInstallNoOpSafety(sql: string): {
  ok: boolean;
  usesIfNotExists: boolean;
  noDangerousDdl: boolean;
  noPreflight: boolean;
  noPublishedTariffInsert: boolean;
  noCredentials: boolean;
} {
  const usesIfNotExists =
    /create\s+table\s+if\s+not\s+exists\s+public\.water_readings/i.test(sql) &&
    /create\s+table\s+if\s+not\s+exists\s+public\.water_ledger/i.test(sql) &&
    /create\s+table\s+if\s+not\s+exists\s+public\.meter_readings/i.test(sql) &&
    /create\s+table\s+if\s+not\s+exists\s+public\.electricity_ledger/i.test(sql) &&
    /create\s+table\s+if\s+not\s+exists\s+public\.tariff_versions/i.test(sql);
  const noDangerousDdl = !DANGEROUS_DDL.test(sql);
  const noPreflight = !/fresh_install_preflight/i.test(sql);
  const noPublishedTariffInsert = !/\binsert\s+into\s+public\.tariff_versions\b/i.test(sql);
  const noCredentials =
    !/password\s*=/i.test(sql) &&
    !/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\./.test(sql);
  return {
    ok:
      usesIfNotExists &&
      noDangerousDdl &&
      noPreflight &&
      noPublishedTariffInsert &&
      noCredentials,
    usesIfNotExists,
    noDangerousDdl,
    noPreflight,
    noPublishedTariffInsert,
    noCredentials,
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

export function assertCanonicalIs9aSchemaSql(sql: string): {
  ok: boolean;
  hasStaff: boolean;
  hasRegistryPeople: boolean;
  hasCapitalAssessments: boolean;
  hasCapitalLedger: boolean;
  hasOpeningKinds: boolean;
  hasModuleCatalog: boolean;
  hasTariffCatalog: boolean;
  hasAuthHelpers: boolean;
  noOwnsPropertyInvention: boolean;
  noPublishedTariffVersions: boolean;
} {
  const hasStaff = /create\s+table\s+if\s+not\s+exists\s+public\.staff/i.test(sql);
  const hasRegistryPeople =
    /create\s+table\s+if\s+not\s+exists\s+public\.property_registry_people/i.test(sql);
  const hasCapitalAssessments =
    /create\s+table\s+if\s+not\s+exists\s+public\.capital_repair_assessments/i.test(sql);
  const hasCapitalLedger =
    /create\s+table\s+if\s+not\s+exists\s+public\.capital_repair_ledger/i.test(sql);
  const hasOpeningKinds =
    /opening_obligation/i.test(sql) &&
    /opening_historical_settlement/i.test(sql) &&
    /opening_credit/i.test(sql);
  const hasModuleCatalog =
    /create\s+table\s+if\s+not\s+exists\s+public\.module_catalog/i.test(sql);
  const hasTariffCatalog =
    /create\s+table\s+if\s+not\s+exists\s+public\.tariff_catalog/i.test(sql);
  const hasAuthHelpers =
    /create\s+or\s+replace\s+function\s+public\.is_staff\s*\(/i.test(sql) &&
    /create\s+or\s+replace\s+function\s+public\.has_staff_role\s*\(/i.test(sql) &&
    /set\s+search_path\s*=\s*''/i.test(sql);
  // IS-9b packages canonical owns_property — invention = portal owner_email path
  const noOwnsPropertyInvention = !/properties\.owner_email/i.test(
    sql.match(
      /create\s+or\s+replace\s+function\s+public\.owns_property[\s\S]*?\$fn\$;/i,
    )?.[0] ?? '',
  );
  // IS-10d may insert a CANCELLED distributive sentinel; published status is forbidden.
  // Bound to the insert statement ([^;]*) so later RLS checks for status='published' do not false-positive.
  const noPublishedTariffVersions =
    !/\binsert\s+into\s+public\.tariff_versions\b[\s\S]*?\bvalues\b[^;]*?'published'/i.test(
      sql,
    );
  return {
    ok:
      hasStaff &&
      hasRegistryPeople &&
      hasCapitalAssessments &&
      hasCapitalLedger &&
      hasOpeningKinds &&
      hasModuleCatalog &&
      hasTariffCatalog &&
      hasAuthHelpers &&
      noOwnsPropertyInvention &&
      noPublishedTariffVersions,
    hasStaff,
    hasRegistryPeople,
    hasCapitalAssessments,
    hasCapitalLedger,
    hasOpeningKinds,
    hasModuleCatalog,
    hasTariffCatalog,
    hasAuthHelpers,
    noOwnsPropertyInvention,
    noPublishedTariffVersions,
  };
}

/** R1-CLOSE: package must ship portal mirror sync (display only; never authorizes). */
export function assertPropertyBookPortalSyncSql(sql: string): {
  ok: boolean;
  hasSyncFn: boolean;
  hasMutationGuard: boolean;
  syncDoesNotAuthorize: boolean;
} {
  const hasSyncFn =
    /create\s+or\s+replace\s+function\s+public\.property_book_sync_portal_owner_fields\s*\(/i.test(
      sql,
    );
  const hasMutationGuard =
    /properties_block_independent_owner_mutation/i.test(sql) &&
    /property_book\.mutating/i.test(sql);
  // Sync may SET owner_email; must not appear inside owns_property body.
  const ownsBody =
    sql.match(
      /create\s+or\s+replace\s+function\s+public\.owns_property[\s\S]*?\$fn\$;/i,
    )?.[0] ?? '';
  const syncDoesNotAuthorize = !/properties\.owner_email/i.test(ownsBody);
  return {
    ok: hasSyncFn && hasMutationGuard && syncDoesNotAuthorize,
    hasSyncFn,
    hasMutationGuard,
    syncDoesNotAuthorize,
  };
}

export function assertCanonicalIs9bSchemaSql(sql: string): {
  ok: boolean;
  hasOwnsProperty: boolean;
  hasBookValidate: boolean;
  hasMeterReadings: boolean;
  hasWaterReadings: boolean;
  hasWaterLedger: boolean;
  hasElectricityLedger: boolean;
  hasCapitalPayment: boolean;
  hasCapitalBalance: boolean;
  hasCapitalCharge: boolean;
  hasTariffVersions: boolean;
  hasFirstAdminBootstrap: boolean;
  noPublishedPrices: boolean;
  hasPreflight: boolean;
} {
  const hasOwnsProperty =
    /create\s+or\s+replace\s+function\s+public\.owns_property\s*\(/i.test(sql) &&
    /property_book_active_owner_by_email/i.test(sql) &&
    /property_book_owner_row_access_ready/i.test(sql);
  const hasBookValidate =
    /create\s+or\s+replace\s+function\s+public\.property_book_validate\s*\(/i.test(sql);
  const hasMeterReadings =
    /create\s+table\s+if\s+not\s+exists\s+public\.meter_readings/i.test(sql);
  const hasWaterReadings =
    /create\s+table\s+if\s+not\s+exists\s+public\.water_readings/i.test(sql);
  const hasWaterLedger =
    /create\s+table\s+if\s+not\s+exists\s+public\.water_ledger/i.test(sql);
  const hasElectricityLedger =
    /create\s+table\s+if\s+not\s+exists\s+public\.electricity_ledger/i.test(sql);
  const hasCapitalPayment =
    /create\s+or\s+replace\s+function\s+public\.record_capital_repair_payment\s*\(/i.test(sql);
  const hasCapitalBalance =
    /create\s+or\s+replace\s+function\s+public\.get_capital_repair_balance\s*\(/i.test(sql) &&
    /opening_obligation/i.test(sql);
  const hasCapitalCharge =
    /create\s+or\s+replace\s+function\s+public\.charge_capital_repair\s*\(/i.test(sql);
  const hasTariffVersions =
    /create\s+table\s+if\s+not\s+exists\s+public\.tariff_versions/i.test(sql) &&
    /create\s+table\s+if\s+not\s+exists\s+public\.tariff_rate_items/i.test(sql);
  const hasFirstAdminBootstrap =
    /install_bootstrap_claim_first_admin/i.test(sql) &&
    /install_bootstrap_set_approval/i.test(sql) &&
    /service_role required/i.test(sql);
  // Allow cancelled distributive sentinels (IS-10d); forbid publishing prices.
  // Bound to the insert statement ([^;]*) so later RLS checks for status='published' do not false-positive.
  const noPublishedPrices =
    !/\binsert\s+into\s+public\.tariff_versions\b[\s\S]*?\bvalues\b[^;]*?'published'/i.test(
      sql,
    ) &&
    !/\binsert\s+into\s+public\.tariff_rate_items\b/i.test(sql) &&
    !/\binsert\s+into\s+public\.water_tariffs\b/i.test(sql) &&
    !/\binsert\s+into\s+public\.electricity_tariffs\b/i.test(sql);
  const hasPreflight = /fresh_install_preflight/i.test(sql);
  return {
    ok:
      hasOwnsProperty &&
      hasBookValidate &&
      hasMeterReadings &&
      hasWaterReadings &&
      hasWaterLedger &&
      hasElectricityLedger &&
      hasCapitalPayment &&
      hasCapitalBalance &&
      hasCapitalCharge &&
      hasTariffVersions &&
      hasFirstAdminBootstrap &&
      noPublishedPrices &&
      hasPreflight,
    hasOwnsProperty,
    hasBookValidate,
    hasMeterReadings,
    hasWaterReadings,
    hasWaterLedger,
    hasElectricityLedger,
    hasCapitalPayment,
    hasCapitalBalance,
    hasCapitalCharge,
    hasTariffVersions,
    hasFirstAdminBootstrap,
    noPublishedPrices,
    hasPreflight,
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

export function assertIs9aRlsCompleteness(sql: string): {
  ok: boolean;
  capitalRls: boolean;
  registryRls: boolean;
  staffRls: boolean;
  tariffRls: boolean;
  conditionalOwnsProperty: boolean;
} {
  const capitalRls =
    /alter\s+table\s+public\.capital_repair_assessments\s+enable\s+row\s+level\s+security/i.test(
      sql,
    ) &&
    /alter\s+table\s+public\.capital_repair_ledger\s+enable\s+row\s+level\s+security/i.test(sql);
  const registryRls =
    /alter\s+table\s+public\.property_registry_people\s+enable\s+row\s+level\s+security/i.test(
      sql,
    );
  const staffRls = /alter\s+table\s+public\.staff\s+enable\s+row\s+level\s+security/i.test(sql);
  const tariffRls =
    /alter\s+table\s+public\.tariff_catalog\s+enable\s+row\s+level\s+security/i.test(sql);
  const conditionalOwnsProperty =
    /to_regprocedure\('public\.owns_property\(bigint\)'\)/i.test(sql);
  return {
    ok: capitalRls && registryRls && staffRls && tariffRls && conditionalOwnsProperty,
    capitalRls,
    registryRls,
    staffRls,
    tariffRls,
    conditionalOwnsProperty,
  };
}

export function assertIs9bRlsAndSecurity(sql: string): {
  ok: boolean;
  utilitiesRls: boolean;
  bootstrapLeastPrivilege: boolean;
  noAnonBootstrapGrant: boolean;
} {
  const utilitiesRls =
    /alter\s+table\s+public\.water_ledger\s+enable\s+row\s+level\s+security/i.test(sql) &&
    /alter\s+table\s+public\.electricity_ledger\s+enable\s+row\s+level\s+security/i.test(sql) &&
    /alter\s+table\s+public\.meter_readings\s+enable\s+row\s+level\s+security/i.test(sql);
  const bootstrapLeastPrivilege =
    /revoke\s+all\s+on\s+function\s+public\.install_bootstrap_set_approval/i.test(sql) &&
    /grant\s+execute\s+on\s+function\s+public\.install_bootstrap_claim_first_admin/i.test(sql);
  const noAnonBootstrapGrant =
    !/grant\s+execute\s+on\s+function\s+public\.install_bootstrap_set_approval[^;]*\s+to\s+anon/i.test(
      sql,
    ) &&
    !/grant\s+execute\s+on\s+function\s+public\.install_bootstrap_set_approval[^;]*\s+to\s+authenticated/i.test(
      sql,
    );
  return {
    ok: utilitiesRls && bootstrapLeastPrivilege && noAnonBootstrapGrant,
    utilitiesRls,
    bootstrapLeastPrivilege,
    noAnonBootstrapGrant,
  };
}

/** No AMADEUS 11-specific apartment / owner production payloads. */
export function assertNoAmadeus11ProductionData(sql: string): {
  ok: boolean;
  noApartmentSeed: boolean;
  noOwnerEmailSeed: boolean;
} {
  // Literal seed rows only — PL/pgSQL inserts with bound variables (RC8 Book import) are allowed.
  const noApartmentSeed =
    !/\binsert\s+into\s+public\.properties\s*\([^)]*\)\s*values\s*\(\s*'/i.test(sql) &&
    !/\bapartment_number\s*=\s*'[^']+'/i.test(sql);
  const noOwnerEmailSeed = !/\binsert\s+into\s+public\.property_registry_people\b/i.test(sql);
  return {
    ok: noApartmentSeed && noOwnerEmailSeed,
    noApartmentSeed,
    noOwnerEmailSeed,
  };
}

/** Deterministic dependency order checks for MANIFEST orderedFiles. */
export function assertFreshInstallDependencyOrder(orderedFiles: readonly string[]): {
  ok: boolean;
  preflightFirst: boolean;
  registryBeforeBookAuth: boolean;
  bookAuthBeforeMeterRls: boolean;
  catalogBeforeTariffVersions: boolean;
  capitalTablesBeforeOps: boolean;
} {
  const idx = (name: string) => orderedFiles.indexOf(name);
  const preflightFirst = idx('00_preflight_refuse_populated.sql') === 0;
  const registryBeforeBookAuth =
    idx('40_property_registry_people.sql') >= 0 &&
    idx('45_property_book_auth_helpers.sql') > idx('40_property_registry_people.sql');
  const bookAuthBeforeMeterRls =
    idx('45_property_book_auth_helpers.sql') >= 0 &&
    idx('30_meter_rls_enable.sql') > idx('45_property_book_auth_helpers.sql');
  const catalogBeforeTariffVersions =
    idx('70_tariff_catalog_shell.sql') >= 0 &&
    idx('85_tariff_versions_schema.sql') > idx('70_tariff_catalog_shell.sql');
  const capitalTablesBeforeOps =
    idx('50_capital_repair_baseline.sql') >= 0 &&
    idx('80_capital_repair_operational_rpcs.sql') > idx('50_capital_repair_baseline.sql') &&
    idx('85_tariff_versions_schema.sql') > idx('50_capital_repair_baseline.sql');
  const meetingsBeforeTariffVersions =
    idx('57_general_meetings_baseline.sql') >= 0 &&
    idx('85_tariff_versions_schema.sql') > idx('57_general_meetings_baseline.sql');
  const electricityMetersBeforeAssign =
    idx('20_electricity_meters.sql') >= 0 &&
    idx('82_electricity_meter_assign_replace_rpcs.sql') > idx('20_electricity_meters.sql') &&
    idx('05_auth_staff_helpers.sql') >= 0 &&
    idx('82_electricity_meter_assign_replace_rpcs.sql') > idx('05_auth_staff_helpers.sql');
  const utilitiesBeforeOpeningRpcs =
    idx('75_utilities_readings_ledgers.sql') >= 0 &&
    idx('83_opening_readings_and_safe_corrections.sql') > idx('75_utilities_readings_ledgers.sql') &&
    idx('83_opening_readings_and_safe_corrections.sql') > idx('82_electricity_meter_assign_replace_rpcs.sql') &&
    idx('83f_charged_paid_reading_corrections.sql') > idx('83_opening_readings_and_safe_corrections.sql');
  const balanceBeforeTariffVersions =
    idx('84_utility_balance_payment_rpcs.sql') > idx('75_utilities_readings_ledgers.sql') &&
    idx('85_tariff_versions_schema.sql') > idx('84_utility_balance_payment_rpcs.sql');
  const submitAfterTariffVersions =
    idx('87_utility_submit_resolve_packaging.sql') > idx('85_tariff_versions_schema.sql');
  const emailCoreAfterBookAuth =
    idx('88_email_core_baseline.sql') > idx('45_property_book_auth_helpers.sql') &&
    idx('88_email_core_baseline.sql') > idx('05_auth_staff_helpers.sql') &&
    (idx('90_first_admin_bootstrap.sql') < 0 ||
      idx('88_email_core_baseline.sql') < idx('90_first_admin_bootstrap.sql'));
  const emailPolicyAfterEmailCore =
    idx('89_email_notification_policy.sql') < 0 ||
    (idx('89_email_notification_policy.sql') > idx('88_email_core_baseline.sql') &&
      (idx('90_first_admin_bootstrap.sql') < 0 ||
        idx('89_email_notification_policy.sql') < idx('90_first_admin_bootstrap.sql')));
  return {
    ok:
      preflightFirst &&
      registryBeforeBookAuth &&
      bookAuthBeforeMeterRls &&
      catalogBeforeTariffVersions &&
      capitalTablesBeforeOps &&
      meetingsBeforeTariffVersions &&
      electricityMetersBeforeAssign &&
      utilitiesBeforeOpeningRpcs &&
      balanceBeforeTariffVersions &&
      submitAfterTariffVersions &&
      emailCoreAfterBookAuth &&
      emailPolicyAfterEmailCore,
    preflightFirst,
    registryBeforeBookAuth,
    bookAuthBeforeMeterRls,
    catalogBeforeTariffVersions,
    capitalTablesBeforeOps,
  };
}

/** Detect missing required objects listed in manifest vs package SQL. */
export function assertPackageObjectCoverage(
  sql: string,
  requiredRelations: readonly string[],
  requiredFunctions: readonly string[],
): {
  ok: boolean;
  missingRelations: string[];
  missingFunctions: string[];
} {
  const missingRelations = requiredRelations.filter((rel) => {
    // Support public.foo and storage.buckets (non-public schemas).
    const parts = rel.split('.');
    const schema = parts.length > 1 ? parts[0] : 'public';
    const name = parts.length > 1 ? parts.slice(1).join('.') : parts[0];
    return !new RegExp(
      `create\\s+table\\s+if\\s+not\\s+exists\\s+${schema}\\.${name}\\b`,
      'i',
    ).test(sql);
  });
  const missingFunctions = requiredFunctions.filter((fn) => {
    const base = fn.replace(/^public\./, '').replace(/\(.*\)$/, '');
    return !new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${base}\\s*\\(`,
      'i',
    ).test(sql);
  });
  return {
    ok: missingRelations.length === 0 && missingFunctions.length === 0,
    missingRelations,
    missingFunctions,
  };
}
