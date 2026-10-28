/**
 * IS-7a — Tariff readiness gate for Initial Setup (Tariff Core / list_tariffs).
 * Read-only evaluation. Never publishes tariffs or changes module lifecycle.
 */

import type { TariffKey } from '@/lib/tariffs';

/** Modules that declare tariff-related Initial Setup readiness. */
export type TariffGateModuleKey =
  | 'support_fee'
  | 'internet'
  | 'water'
  | 'electricity'
  | 'capital_repair';

export type TariffReadinessKind = 'import' | 'billing_activation';

export type TariffListSnapshot = {
  tariff_key: string;
  module_key?: string | null;
  active?: boolean | null;
  current_version_id: string | null;
  current_published_at?: string | null;
};

export type TariffGateRule = {
  moduleKey: TariffGateModuleKey;
  tariffKey: TariffKey;
  /**
   * Opening inventarisation / inventory import requires a published applicable tariff.
   * Water/electricity meter inventory does NOT — billing tariffs are separate.
   */
  requiresPublishedForImport: boolean;
  /** Operational billing / charge paths require published applicable tariff. */
  requiresPublishedForBilling: boolean;
  missingMessageKey: string;
  billingMissingMessageKey: string;
};

/**
 * Extensible registry. Future modules append rules without changing gate evaluators.
 */
export const TARIFF_SETUP_GATE_RULES: readonly TariffGateRule[] = [
  {
    moduleKey: 'support_fee',
    tariffKey: 'support_fee',
    // R1-RC8: historical opening inventarisation does not need a published tariff;
    // billing/future charges still do.
    requiresPublishedForImport: false,
    requiresPublishedForBilling: true,
    missingMessageKey: 'is7aTariffOptionalSupportFeeOpening',
    billingMissingMessageKey: 'is7aTariffMissingSupportFee',
  },
  {
    moduleKey: 'internet',
    tariffKey: 'internet',
    requiresPublishedForImport: true,
    requiresPublishedForBilling: true,
    missingMessageKey: 'is7aTariffMissingInternet',
    billingMissingMessageKey: 'is7aTariffMissingInternet',
  },
  {
    moduleKey: 'water',
    tariffKey: 'water',
    requiresPublishedForImport: false,
    requiresPublishedForBilling: true,
    missingMessageKey: 'is7aMeterInventoryIndependentWater',
    billingMissingMessageKey: 'is7aTariffMissingWaterBilling',
  },
  {
    moduleKey: 'electricity',
    tariffKey: 'electricity',
    requiresPublishedForImport: false,
    requiresPublishedForBilling: true,
    missingMessageKey: 'is7aMeterInventoryIndependentElectricity',
    billingMissingMessageKey: 'is7aTariffMissingElectricityBilling',
  },
  {
    moduleKey: 'capital_repair',
    tariffKey: 'capital_repair',
    requiresPublishedForImport: false,
    requiresPublishedForBilling: true,
    missingMessageKey: 'is7aTariffMissingCapitalBilling',
    billingMissingMessageKey: 'is7aTariffMissingCapitalBilling',
  },
] as const;

export type ModuleTariffReadiness = {
  moduleKey: TariffGateModuleKey;
  tariffKey: TariffKey;
  hasPublishedApplicable: boolean;
  /** Inventory/opening import blocked solely by missing tariff */
  importBlockedByMissingTariff: boolean;
  /** Billing/operational activation blocked by missing tariff */
  billingBlockedByMissingTariff: boolean;
  importReady: boolean;
  billingReady: boolean;
  missingMessageKey: string | null;
  billingMissingMessageKey: string | null;
};

export function isPublishedApplicableTariff(
  row: TariffListSnapshot | null | undefined,
): boolean {
  if (!row) return false;
  return row.current_version_id != null && String(row.current_version_id).trim().length > 0;
}

export function findTariffRow(
  rows: readonly TariffListSnapshot[],
  tariffKey: string,
): TariffListSnapshot | null {
  const key = String(tariffKey).toLowerCase();
  return (
    rows.find((r) => String(r.tariff_key ?? '').toLowerCase() === key) ??
    rows.find((r) => String(r.module_key ?? '').toLowerCase() === key) ??
    null
  );
}

export function getTariffGateRule(moduleKey: string): TariffGateRule | null {
  return TARIFF_SETUP_GATE_RULES.find((r) => r.moduleKey === moduleKey) ?? null;
}

export function evaluateTariffSetupGate(
  moduleKey: string,
  rows: readonly TariffListSnapshot[],
): ModuleTariffReadiness | null {
  const rule = getTariffGateRule(moduleKey);
  if (!rule) return null;
  const published = isPublishedApplicableTariff(findTariffRow(rows, rule.tariffKey));
  const importBlocked = rule.requiresPublishedForImport && !published;
  const billingBlocked = rule.requiresPublishedForBilling && !published;
  return {
    moduleKey: rule.moduleKey,
    tariffKey: rule.tariffKey,
    hasPublishedApplicable: published,
    importBlockedByMissingTariff: importBlocked,
    billingBlockedByMissingTariff: billingBlocked,
    importReady: !importBlocked,
    billingReady: !billingBlocked,
    missingMessageKey: importBlocked ? rule.missingMessageKey : null,
    billingMissingMessageKey: billingBlocked ? rule.billingMissingMessageKey : null,
  };
}

export function evaluateAllTariffSetupGates(
  rows: readonly TariffListSnapshot[],
): ModuleTariffReadiness[] {
  return TARIFF_SETUP_GATE_RULES.map((r) => evaluateTariffSetupGate(r.moduleKey, rows)!);
}

/** Property Book must be ready before property-dependent setup modules. */
export function propertyBookBlocksDependentSetup(args: {
  moduleKey: string;
  propertyBookReadyOrVerified: boolean;
}): boolean {
  const dependents = new Set([
    'water',
    'electricity',
    'support_fee',
    'internet',
    'capital_repair',
  ]);
  if (!dependents.has(args.moduleKey)) return false;
  return !args.propertyBookReadyOrVerified;
}

/**
 * Gate does not activate modules. Callers must never transition lifecycle from readiness alone.
 */
export function tariffGateChangesModuleActivation(): false {
  return false;
}

export function supportFeeRequiresPublishedTariffForImport(ready: ModuleTariffReadiness | null): boolean {
  return ready?.moduleKey === 'support_fee' ? ready.importBlockedByMissingTariff : false;
}

export function internetRequiresPublishedTariffForImport(ready: ModuleTariffReadiness | null): boolean {
  return ready?.moduleKey === 'internet' ? ready.importBlockedByMissingTariff : false;
}

export function meterInventoryIndependentOfBillingTariff(moduleKey: 'water' | 'electricity'): boolean {
  const rule = getTariffGateRule(moduleKey);
  return rule != null && rule.requiresPublishedForImport === false;
}
