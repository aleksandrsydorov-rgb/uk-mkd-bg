/** Building Module Core (Phase 1). UX gating only — not the security boundary. */

export const BUILDING_MODULE_KEYS = [
  'water',
  'electricity',
  'internet',
  'parking',
  'security',
  'rental',
  'capital_repair',
] as const;

export type BuildingModuleKey = (typeof BUILDING_MODULE_KEYS)[number];

/** Modules with real product surfaces in Phase 1. */
export const IMPLEMENTED_MODULE_KEYS = ['water', 'electricity', 'capital_repair'] as const;

export type ImplementedModuleKey = (typeof IMPLEMENTED_MODULE_KEYS)[number];

/** Phase 1 admin may toggle only these keys. */
export const PHASE1_TOGGLEABLE_MODULE_KEYS = IMPLEMENTED_MODULE_KEYS;

export type BuildingModulesState = Record<BuildingModuleKey, boolean>;

export type BuildingModuleRow = {
  module_key: string;
  enabled: boolean;
};

export function emptyBuildingModulesState(): BuildingModulesState {
  return {
    water: false,
    electricity: false,
    internet: false,
    parking: false,
    security: false,
    rental: false,
    capital_repair: false,
  };
}

export function parseBuildingModuleKey(value: unknown): BuildingModuleKey | null {
  if (typeof value !== 'string') return null;
  return (BUILDING_MODULE_KEYS as readonly string[]).includes(value)
    ? (value as BuildingModuleKey)
    : null;
}

export function isImplementedModuleKey(value: unknown): value is ImplementedModuleKey {
  return (IMPLEMENTED_MODULE_KEYS as readonly string[]).includes(String(value ?? ''));
}

export function isPhase1ToggleableModuleKey(value: unknown): value is ImplementedModuleKey {
  return isImplementedModuleKey(value);
}

/**
 * Missing row = disabled.
 * Callers must not treat RPC load errors as enabled — pass null/empty instead.
 */
export function buildingModulesFromRows(
  rows: BuildingModuleRow[] | null | undefined,
): BuildingModulesState {
  const state = emptyBuildingModulesState();
  for (const row of rows ?? []) {
    const key = parseBuildingModuleKey(row.module_key);
    if (!key) continue;
    state[key] = row.enabled === true;
  }
  return state;
}

/** Deterministic: only explicit true counts as enabled. Missing / unknown = disabled. */
export function isBuildingModuleEnabled(
  state: BuildingModulesState | null | undefined,
  key: BuildingModuleKey,
): boolean {
  if (!state) return false;
  return state[key] === true;
}
