import type { ModuleRegistration, ModuleSetupAdapter } from '@/lib/moduleCore/types';

/**
 * In-process adapter registry. Lifecycle engine discovers modules via this
 * contract — never a hardcoded fixed list of 12/35 keys inside transitions.
 * Catalog UX keys remain in src/lib/modules.ts (building_modules source of truth).
 */
const adapters = new Map<string, ModuleSetupAdapter>();

export function registerModuleAdapter(adapter: ModuleSetupAdapter): void {
  const key = adapter.registration.moduleKey.trim();
  if (!key) throw new Error('moduleCore: moduleKey required');
  if (adapters.has(key)) {
    throw new Error(`moduleCore: duplicate registration for ${key}`);
  }
  adapters.set(key, adapter);
}

/** Test/dev helper — not used in production paths. */
export function clearModuleAdapterRegistry(): void {
  adapters.clear();
}

export function getModuleAdapter(moduleKey: string): ModuleSetupAdapter | null {
  return adapters.get(moduleKey) ?? null;
}

export function listRegisteredModuleAdapters(): ModuleSetupAdapter[] {
  return [...adapters.values()].sort((a, b) =>
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
