import type { ModuleRegistration, ModuleSetupAdapter } from '@/lib/moduleCore/types';

/**
 * In-process adapter registry. Lifecycle engine discovers modules via this
 * contract — never a hardcoded fixed list of 12/35 keys inside transitions.
 * Catalog UX keys remain in src/lib/modules.ts (building_modules source of truth).
 *
 * Survives Turbopack/Next HMR of sibling modules via globalThis so re-bootstrap
 * does not see an empty Map while callers still hold old registrations (or the
 * inverse). Re-registering the same logical adapter is idempotent; a different
 * adapter under the same key still throws.
 */
const REGISTRY_GLOBAL_KEY = '__amadeus11_module_setup_adapters__';

type RegistryGlobal = typeof globalThis & {
  [REGISTRY_GLOBAL_KEY]?: Map<string, ModuleSetupAdapter>;
};

function adaptersMap(): Map<string, ModuleSetupAdapter> {
  const g = globalThis as RegistryGlobal;
  if (!g[REGISTRY_GLOBAL_KEY]) {
    g[REGISTRY_GLOBAL_KEY] = new Map();
  }
  return g[REGISTRY_GLOBAL_KEY]!;
}

/** Stable identity of a registration for idempotent re-bootstrap / HMR. */
export function moduleRegistrationFingerprint(reg: ModuleRegistration): string {
  return JSON.stringify({
    moduleKey: reg.moduleKey,
    version: reg.version,
    nameKey: reg.nameKey,
    descriptionKey: reg.descriptionKey,
    dependencies: reg.dependencies ?? [],
    requiredRoles: reg.requiredRoles ?? [],
    requiresInitialSetup: reg.requiresInitialSetup === true,
    activationPrerequisites: reg.activationPrerequisites ?? [],
    setup: reg.setup
      ? {
          schemaVersion: reg.setup.schemaVersion,
          importMethods: reg.setup.importMethods ?? [],
          idempotent: reg.setup.idempotent === true,
          completionCriteria: reg.setup.completionCriteria ?? [],
          steps: (reg.setup.steps ?? []).map((s) => ({
            id: s.id,
            titleKey: s.titleKey,
            fields: (s.fields ?? []).map((f) => ({
              key: f.key,
              required: f.required === true,
              valueType: f.valueType,
            })),
          })),
          xlsx: reg.setup.xlsx
            ? {
                schemaVersion: reg.setup.xlsx.schemaVersion,
                sheetName: reg.setup.xlsx.sheetName,
                maxRows: reg.setup.xlsx.maxRows,
                maxBytes: reg.setup.xlsx.maxBytes,
                columns: (reg.setup.xlsx.columns ?? []).map((c) => ({
                  key: c.key,
                  required: c.required === true,
                  labelKey: c.labelKey,
                })),
              }
            : null,
        }
      : null,
  });
}

function sameAdapter(existing: ModuleSetupAdapter, next: ModuleSetupAdapter): boolean {
  if (existing === next) return true;
  return (
    moduleRegistrationFingerprint(existing.registration) ===
    moduleRegistrationFingerprint(next.registration)
  );
}

export function registerModuleAdapter(adapter: ModuleSetupAdapter): void {
  const key = adapter.registration.moduleKey.trim();
  if (!key) throw new Error('moduleCore: moduleKey required');
  const adapters = adaptersMap();
  const prior = adapters.get(key);
  if (prior) {
    if (sameAdapter(prior, adapter)) {
      // Idempotent: repeated bootstrap / HMR / Strict Mode remount.
      adapters.set(key, adapter);
      return;
    }
    throw new Error(`moduleCore: duplicate registration for ${key}`);
  }
  adapters.set(key, adapter);
}

/** Test/dev helper — not used in production paths. */
export function clearModuleAdapterRegistry(): void {
  adaptersMap().clear();
}

export function getModuleAdapter(moduleKey: string): ModuleSetupAdapter | null {
  return adaptersMap().get(moduleKey) ?? null;
}

export function listRegisteredModuleAdapters(): ModuleSetupAdapter[] {
  return [...adaptersMap().values()].sort((a, b) =>
    a.registration.moduleKey.localeCompare(b.registration.moduleKey),
  );
}

export function listRegisteredModuleKeys(): string[] {
  return listRegisteredModuleAdapters().map((a) => a.registration.moduleKey);
}

export function getModuleRegistration(moduleKey: string): ModuleRegistration | null {
  return getModuleAdapter(moduleKey)?.registration ?? null;
}

export function dependenciesSatisfied(
  registration: ModuleRegistration,
  activeOrReadyKeys: ReadonlySet<string>,
): boolean {
  return registration.dependencies.every((dep) => activeOrReadyKeys.has(dep));
}

export function activationBlockedReasons(
  registration: ModuleRegistration,
  args: {
    lifecycleState: string;
    activeOrReadyKeys: ReadonlySet<string>;
    setupComplete: boolean;
  },
): string[] {
  const reasons: string[] = [];
  if (!dependenciesSatisfied(registration, args.activeOrReadyKeys)) {
    reasons.push('dependencies');
  }
  if (registration.requiresInitialSetup && !args.setupComplete) {
    reasons.push('setup_incomplete');
  }
  if (args.lifecycleState !== 'READY' && args.lifecycleState !== 'SUSPENDED') {
    if (args.lifecycleState !== 'ACTIVE') reasons.push('not_ready');
  }
  return reasons;
}
