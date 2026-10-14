import { exampleOpeningAdapter } from '@/lib/moduleCore/adapters/exampleOpeningAdapter';
import { clearModuleAdapterRegistry, registerModuleAdapter } from '@/lib/moduleCore/registry';
import type { ModuleSetupAdapter } from '@/lib/moduleCore/types';

let bootstrapped = false;

/** Thin adapters: declare setup policy without domain importers (IS-1). */
function metadataAdapter(
  moduleKey: string,
  args: { requiresInitialSetup: boolean; dependencies?: string[] },
): ModuleSetupAdapter {
  return {
    registration: {
      moduleKey,
      version: '1.0.0',
      nameKey: `module_${moduleKey}`,
      descriptionKey: `module_${moduleKey}_desc`,
      dependencies: args.dependencies ?? [],
      requiredRoles: ['администрация'],
      requiresInitialSetup: args.requiresInitialSetup,
      activationPrerequisites: [],
      setup: args.requiresInitialSetup
        ? {
            schemaVersion: '1.0',
            importMethods: ['manual'],
            idempotent: true,
            completionCriteria: ['admin_confirm'],
            steps: [
              {
                id: 'confirm',
                titleKey: 'is1ConfirmSetupStep',
                fields: [{ key: 'confirmed', required: true, valueType: 'boolean' }],
              },
            ],
          }
        : {
            schemaVersion: '1.0',
            importMethods: ['none'],
            idempotent: true,
            completionCriteria: [],
            steps: [],
          },
    },
  };
}

/**
 * Registers known setup policies. Lifecycle engine does not hardcode this list —
 * it only discovers whatever is registered here or by future modules.
 */
export function bootstrapModuleSetupAdapters(): void {
  if (bootstrapped) return;
  registerModuleAdapter(exampleOpeningAdapter);
  // No initial data required — may go DISABLED → READY.
  registerModuleAdapter(metadataAdapter('guest_mode', { requiresInitialSetup: false }));
  registerModuleAdapter(metadataAdapter('chat', { requiresInitialSetup: false }));
  registerModuleAdapter(metadataAdapter('requests', { requiresInitialSetup: false }));
  registerModuleAdapter(metadataAdapter('announcements', { requiresInitialSetup: false }));
  // Property Book remains canonical; future book adapter will own XLSX — not IS-1.
  registerModuleAdapter(
    metadataAdapter('building_documents', {
      requiresInitialSetup: true,
      dependencies: [],
    }),
  );
  bootstrapped = true;
}

/** Vitest only */
export function resetModuleSetupAdaptersForTests(): void {
  clearModuleAdapterRegistry();
  bootstrapped = false;
}
