import { electricityOpeningAdapter } from '@/lib/moduleCore/adapters/electricityOpeningAdapter';
import { exampleOpeningAdapter } from '@/lib/moduleCore/adapters/exampleOpeningAdapter';
import { internetOpeningAdapter } from '@/lib/moduleCore/adapters/internetOpeningAdapter';
import { propertyBookOpeningAdapter } from '@/lib/moduleCore/adapters/propertyBookOpeningAdapter';
import { supportFeeOpeningAdapter } from '@/lib/moduleCore/adapters/supportFeeOpeningAdapter';
import { waterOpeningAdapter } from '@/lib/moduleCore/adapters/waterOpeningAdapter';
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
  // IS-2: Property Book opening adapter (canonical Book RPCs; no duplicate tables).
  registerModuleAdapter(propertyBookOpeningAdapter);
  // IS-3: water / electricity inventory adapters (assign_*; reading-row commit BLOCKED).
  registerModuleAdapter(waterOpeningAdapter);
  registerModuleAdapter(electricityOpeningAdapter);
  // IS-4: Support Fee opening inventarisation (import_support_fee_opening_state).
  registerModuleAdapter(supportFeeOpeningAdapter);
  // IS-5: Internet opening inventarisation (import_internet_opening_state).
  registerModuleAdapter(internetOpeningAdapter);
  // No initial data required — may go DISABLED → READY.
  registerModuleAdapter(metadataAdapter('guest_mode', { requiresInitialSetup: false }));
  registerModuleAdapter(metadataAdapter('chat', { requiresInitialSetup: false }));
  registerModuleAdapter(metadataAdapter('requests', { requiresInitialSetup: false }));
  registerModuleAdapter(metadataAdapter('announcements', { requiresInitialSetup: false }));
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
