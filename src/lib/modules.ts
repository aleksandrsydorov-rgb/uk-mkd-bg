/** Building Module Core v2. UX gating only — not the security boundary.
 *  Canon: docs/architecture-cores.md · new modules: docs/module-template.md
 */

export const BUILDING_MODULE_KEYS = [
  'tariffs',
  'support_fee',
  'capital_repair',
  'water',
  'electricity',
  'requests',
  'chat',
  'polls',
  'announcements',
  'general_meeting',
  'building_documents',
  'internet',
  'parking',
  'security',
  'rental',
  'cleaning',
  'maintenance',
  'access_control',
  'contractors',
  'inventory',
  'common_areas',
  'commercial_rentals',
] as const;

export type BuildingModuleKey = (typeof BUILDING_MODULE_KEYS)[number];

/** Catalog keys that have product surfaces (must match seeded implemented=true). */
export const IMPLEMENTED_MODULE_KEYS = [
  'tariffs',
  'support_fee',
  'capital_repair',
  'water',
  'electricity',
  'requests',
  'chat',
  'polls',
  'announcements',
  'general_meeting',
  'building_documents',
] as const;

export type ImplementedModuleKey = (typeof IMPLEMENTED_MODULE_KEYS)[number];

export const MODULE_CATEGORIES = [
  'finance',
  'utilities',
  'communication',
  'documents',
  'services',
  'commercial',
] as const;

export type ModuleCategory = (typeof MODULE_CATEGORIES)[number];

export type BuildingModulesState = Record<BuildingModuleKey, boolean>;

export type BuildingModuleRow = {
  module_key: string;
  enabled: boolean;
};

export type BuildingModuleV2Row = {
  module_key: string;
  enabled: boolean;
  default_name: string;
  category: string;
  sort_order: number;
  implemented: boolean;
};

export function emptyBuildingModulesState(): BuildingModulesState {
  return {
    tariffs: false,
    support_fee: false,
    capital_repair: false,
    water: false,
    electricity: false,
    requests: false,
    chat: false,
    polls: false,
    announcements: false,
    general_meeting: false,
    building_documents: false,
    internet: false,
    parking: false,
    security: false,
    rental: false,
    cleaning: false,
    maintenance: false,
    access_control: false,
    contractors: false,
    inventory: false,
    common_areas: false,
    commercial_rentals: false,
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

export function buildingModulesFromV2Rows(
  rows: BuildingModuleV2Row[] | null | undefined,
): { state: BuildingModulesState; catalog: BuildingModuleV2Row[] } {
  const state = buildingModulesFromRows(rows);
  const catalog = [...(rows ?? [])].sort((a, b) => {
    const cat = String(a.category).localeCompare(String(b.category));
    if (cat !== 0) return cat;
    return Number(a.sort_order) - Number(b.sort_order) || String(a.module_key).localeCompare(String(b.module_key));
  });
  return { state, catalog };
}

/** Deterministic: only explicit true counts as enabled. Missing / unknown = disabled. */
export function isBuildingModuleEnabled(
  state: BuildingModulesState | null | undefined,
  key: BuildingModuleKey,
): boolean {
  if (!state) return false;
  return state[key] === true;
}

/** Display/catalog grouping: fee + capital sit with utilities (коммунальные). */
const MODULE_CATEGORY_OVERRIDE: Partial<Record<string, string>> = {
  support_fee: 'utilities',
  capital_repair: 'utilities',
};

export function groupModulesByCategory(rows: BuildingModuleV2Row[]) {
  const groups = new Map<string, BuildingModuleV2Row[]>();
  for (const row of rows) {
    const cat = MODULE_CATEGORY_OVERRIDE[row.module_key] ?? (row.category || 'other');
    const list = groups.get(cat) ?? [];
    list.push(row);
    groups.set(cat, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => Number(a.sort_order) - Number(b.sort_order) || a.module_key.localeCompare(b.module_key));
  }
  const ordered = MODULE_CATEGORIES.filter((c) => groups.has(c));
  const extras = [...groups.keys()].filter((c) => !(MODULE_CATEGORIES as readonly string[]).includes(c)).sort();
  return [...ordered, ...extras].map((category) => ({
    category,
    modules: groups.get(category) ?? [],
  }));
}

/** i18n message key under admin.* for a module_key; fallback to default_name in UI. */
export function moduleLabelMessageKey(key: string): string | null {
  const map: Record<string, string> = {
    tariffs: 'moduleTariffs',
    support_fee: 'moduleSupportFee',
    capital_repair: 'moduleCapitalRepair',
    water: 'moduleWater',
    electricity: 'moduleElectricity',
    requests: 'moduleRequests',
    chat: 'moduleChat',
    polls: 'modulePolls',
    announcements: 'moduleAnnouncements',
    general_meeting: 'moduleGeneralMeeting',
    building_documents: 'moduleBuildingDocuments',
    internet: 'moduleInternet',
    parking: 'moduleParking',
    security: 'moduleSecurity',
    rental: 'moduleRental',
    cleaning: 'moduleCleaning',
    maintenance: 'moduleMaintenance',
    access_control: 'moduleAccessControl',
    contractors: 'moduleContractors',
    inventory: 'moduleInventory',
    common_areas: 'moduleCommonAreas',
    commercial_rentals: 'moduleCommercialRentals',
  };
  return map[key] ?? null;
}

export function moduleCategoryMessageKey(category: string): string | null {
  const map: Record<string, string> = {
    finance: 'moduleCategoryFinance',
    utilities: 'moduleCategoryUtilities',
    communication: 'moduleCategoryCommunication',
    documents: 'moduleCategoryDocuments',
    services: 'moduleCategoryServices',
    commercial: 'moduleCategoryCommercial',
  };
  return map[category] ?? null;
}
