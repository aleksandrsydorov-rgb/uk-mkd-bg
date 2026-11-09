/**
 * Post–first-run module setup catalog: which modules need attention and why.
 * Lifecycle state and building_modules.enabled are separate — do not collapse them.
 * First-run can enable UX without promoting module_lifecycle; readiness must use
 * completed first-run stages (and must not treat “any subscription exists” as enough).
 */

import {
  isPlatformCoreModuleKey,
  isRelease1DistributionExcluded,
  type BuildingModuleV2Row,
} from '@/lib/modules';
import { getModuleAdapter } from '@/lib/moduleCore/registry';
import type { ModuleLifecycleState } from '@/lib/moduleCore/types';

export type ModuleSetupCatalogStatus =
  | 'not_connected'
  | 'needs_setup'
  | 'setup_started'
  | 'complete';

export type ModuleSetupCatalogRow = {
  moduleKey: string;
  state: string;
  buildingEnabled: boolean;
  hasSetupDraft: boolean;
  catalogImplemented: boolean;
  category: string;
  sortOrder: number;
  defaultName: string;
  requiresInitialSetup: boolean;
  status: ModuleSetupCatalogStatus;
  /** Optional concrete gap when status is needs_setup / setup_started. */
  pendingReasonKey?: string | null;
};

/** First-run stage that proves opening/setup for a module (null = no dedicated stage). */
export const MODULE_FIRST_RUN_STAGE: Record<string, string> = {
  property_book: 'property_book',
  water: 'meters_water',
  electricity: 'meters_electricity',
  support_fee: 'support_fee_opening',
  capital_repair: 'capital_repair_opening',
  internet: 'internet_opening',
  budget: 'budget',
  uk_expenses: 'uk_expenses_opening',
};

const HIDDEN_ADAPTER_KEYS = new Set(['example', 'example_opening']);

export function firstRunStageForModule(moduleKey: string): string | null {
  return MODULE_FIRST_RUN_STAGE[moduleKey] ?? null;
}

export function isFirstRunStageComplete(
  moduleKey: string,
  completedStages: ReadonlySet<string> | null | undefined,
): boolean | null {
  const stage = firstRunStageForModule(moduleKey);
  if (!stage) return null;
  if (!completedStages) return false;
  return completedStages.has(stage);
}

/**
 * Workplace visibility for operational admin surfaces (Finance / Utilities menus,
 * deep-links, overview cards). Requires UX enabled AND setup/lifecycle complete.
 * Disabled modules stay out of workplaces even when history remains intact.
 * Does not use payments, debts, or readings as readiness signals.
 */
export function isModuleWorkplaceAvailable(args: {
  state: string;
  buildingEnabled: boolean;
  requiresInitialSetup: boolean;
  firstRunCompleted: boolean;
  firstRunStageComplete: boolean | null;
  hasSetupDraft?: boolean;
}): boolean {
  if (!args.buildingEnabled) return false;
  return (
    classifyModuleSetupStatus({
      state: args.state,
      buildingEnabled: true,
      hasSetupDraft: args.hasSetupDraft === true,
      requiresInitialSetup: args.requiresInitialSetup,
      firstRunCompleted: args.firstRunCompleted,
      firstRunStageComplete: args.firstRunStageComplete,
    }) === 'complete'
  );
}

export function classifyModuleSetupStatus(args: {
  state: string;
  buildingEnabled: boolean;
  hasSetupDraft: boolean;
  requiresInitialSetup: boolean;
  /** Complex finished mandatory first-run. */
  firstRunCompleted: boolean;
  /**
   * true/false when module has a mapped first-run stage;
   * null when the module has no dedicated first-run opening stage.
   */
  firstRunStageComplete: boolean | null;
}): ModuleSetupCatalogStatus {
  const state = String(args.state ?? '').toUpperCase();

  // UX off: hide if already configured (re-enable is Settings — do not nag reconnect).
  // Never flip enabled here; catalog only decides visibility.
  if (!args.buildingEnabled) {
    if (state === 'ACTIVE') return 'complete';
    if (args.firstRunStageComplete === true) return 'complete';
    if (
      args.firstRunCompleted &&
      !args.requiresInitialSetup &&
      args.firstRunStageComplete == null
    ) {
      return 'complete';
    }
    return 'not_connected';
  }

  // UX on + lifecycle active → fully connected.
  if (state === 'ACTIVE') return 'complete';

  // UX on + first-run opening stage complete → treat as configured even if lifecycle
  // lagged behind (first-run historically enabled building_modules without ACTIVE).
  if (args.firstRunStageComplete === true) return 'complete';

  // UX on, no dedicated opening stage, no initial setup required, first-run done
  // (e.g. chat/cleaning selected at modules_select) → configured.
  if (
    args.firstRunCompleted &&
    !args.requiresInitialSetup &&
    args.firstRunStageComplete == null
  ) {
    return 'complete';
  }

  if (state === 'SETUP_IN_PROGRESS') return 'setup_started';

  if (args.hasSetupDraft && state !== 'DISABLED') {
    return 'setup_started';
  }

  if (state === 'READY' || state === 'SETUP_REQUIRED' || state === 'SUSPENDED') {
    return 'needs_setup';
  }

  // Enabled in UX but opening/setup never finished (e.g. inventory after first-run).
  if (args.requiresInitialSetup) return 'needs_setup';

  return 'not_connected';
}

export function moduleSetupPendingReasonKey(
  status: ModuleSetupCatalogStatus,
  args: {
    moduleKey: string;
    requiresInitialSetup: boolean;
    firstRunStageComplete: boolean | null;
  },
): string | null {
  if (status === 'complete' || status === 'not_connected') return null;
  const stage = firstRunStageForModule(args.moduleKey);
  if (args.requiresInitialSetup && args.firstRunStageComplete === false && stage) {
    return `admin.moduleSetupPendingStage_${args.moduleKey}`;
  }
  if (args.requiresInitialSetup) return 'admin.moduleSetupPendingOpening';
  return 'admin.moduleSetupPendingActivation';
}

export function moduleSetupCatalogAction(
  status: ModuleSetupCatalogStatus,
): 'configure' | 'continue' | null {
  if (status === 'not_connected' || status === 'needs_setup') return 'configure';
  if (status === 'setup_started') return 'continue';
  return null;
}

export type BuildModuleCatalogArgs = {
  lifecycle: Array<{
    module_key: string;
    state: string;
    building_enabled: boolean;
    has_setup_draft: boolean;
    catalog_implemented: boolean;
  }>;
  buildingCatalog: BuildingModuleV2Row[];
  firstRunCompleted: boolean;
  completedFirstRunStages: ReadonlySet<string>;
  /** When true, keep configured modules (Settings catalog). Default: hide complete. */
  includeComplete?: boolean;
  /** When true, include tariffs (Settings). Setup-only lists still skip it. */
  includeTariffs?: boolean;
};

/** Modules for setup attention list, or full Settings catalog when includeComplete. */
export function buildModuleSetupCatalog(args: BuildModuleCatalogArgs): ModuleSetupCatalogRow[] {
  const includeComplete = args.includeComplete === true;
  const includeTariffs = args.includeTariffs === true;
  const byKey = new Map(args.buildingCatalog.map((row) => [row.module_key, row]));
  const seen = new Set<string>();
  const out: ModuleSetupCatalogRow[] = [];

  for (const row of args.lifecycle) {
    const key = row.module_key;
    if (HIDDEN_ADAPTER_KEYS.has(key)) continue;
    if (isPlatformCoreModuleKey(key)) continue;
    if (isRelease1DistributionExcluded(key)) continue;
    if (key === 'tariffs' && !includeTariffs) continue;

    const catalog = byKey.get(key);
    const implemented = row.catalog_implemented === true || catalog?.implemented === true;
    if (!implemented) continue;

    seen.add(key);

    const adapter = getModuleAdapter(key);
    const requiresInitialSetup = adapter?.registration.requiresInitialSetup ?? false;
    const firstRunStageComplete = isFirstRunStageComplete(key, args.completedFirstRunStages);
    const status = classifyModuleSetupStatus({
      state: row.state,
      buildingEnabled: row.building_enabled === true,
      hasSetupDraft: row.has_setup_draft === true,
      requiresInitialSetup,
      firstRunCompleted: args.firstRunCompleted,
      firstRunStageComplete,
    });
    if (!includeComplete && status === 'complete') continue;

    out.push({
      moduleKey: key,
      state: row.state,
      buildingEnabled: row.building_enabled === true,
      hasSetupDraft: row.has_setup_draft === true,
      catalogImplemented: implemented,
      category: catalog?.category ?? 'services',
      sortOrder: catalog?.sort_order ?? 999,
      defaultName: catalog?.default_name ?? key,
      requiresInitialSetup,
      status,
      pendingReasonKey: moduleSetupPendingReasonKey(status, {
        moduleKey: key,
        requiresInitialSetup,
        firstRunStageComplete,
      }),
    });
  }

  // Implemented catalog modules missing from lifecycle (never touched).
  for (const cat of args.buildingCatalog) {
    if (seen.has(cat.module_key)) continue;
    if (HIDDEN_ADAPTER_KEYS.has(cat.module_key)) continue;
    if (isPlatformCoreModuleKey(cat.module_key)) continue;
    if (isRelease1DistributionExcluded(cat.module_key)) continue;
    if (cat.module_key === 'tariffs' && !includeTariffs) continue;
    if (cat.implemented !== true) continue;

    seen.add(cat.module_key);

    const adapter = getModuleAdapter(cat.module_key);
    const requiresInitialSetup = adapter?.registration.requiresInitialSetup ?? false;
    const firstRunStageComplete = isFirstRunStageComplete(
      cat.module_key,
      args.completedFirstRunStages,
    );
    const status = classifyModuleSetupStatus({
      state: 'DISABLED',
      buildingEnabled: cat.enabled === true,
      hasSetupDraft: false,
      requiresInitialSetup,
      firstRunCompleted: args.firstRunCompleted,
      firstRunStageComplete,
    });
    if (!includeComplete && status === 'complete') continue;

    out.push({
      moduleKey: cat.module_key,
      state: 'DISABLED',
      buildingEnabled: cat.enabled === true,
      hasSetupDraft: false,
      catalogImplemented: true,
      category: cat.category,
      sortOrder: cat.sort_order,
      defaultName: cat.default_name,
      requiresInitialSetup,
      status,
      pendingReasonKey: moduleSetupPendingReasonKey(status, {
        moduleKey: cat.module_key,
        requiresInitialSetup,
        firstRunStageComplete,
      }),
    });
  }

  return out;
}

export type ModuleWizardStepId = 'tariff' | 'data' | 'confirm' | 'activate';

/** Applicable wizard steps for a module (order matters). */
export function moduleWizardSteps(moduleKey: string): ModuleWizardStepId[] {
  const adapter = getModuleAdapter(moduleKey);
  const requiresSetup = adapter?.registration.requiresInitialSetup ?? false;
  const hasImport = Boolean(
    adapter?.registration.setup?.importMethods.some((m) => m === 'xlsx' || m === 'manual'),
  );
  const tariffModules = new Set([
    'support_fee',
    'internet',
    'water',
    'electricity',
    'capital_repair',
  ]);

  if (!requiresSetup) {
    return ['confirm', 'activate'];
  }
  if (tariffModules.has(moduleKey)) {
    return ['tariff', 'data', 'activate'];
  }
  if (hasImport || requiresSetup) {
    return ['data', 'activate'];
  }
  return ['confirm', 'activate'];
}

export function isLifecycleState(value: string): value is ModuleLifecycleState {
  return ['DISABLED', 'SETUP_REQUIRED', 'SETUP_IN_PROGRESS', 'READY', 'ACTIVE', 'SUSPENDED'].includes(
    value,
  );
}
