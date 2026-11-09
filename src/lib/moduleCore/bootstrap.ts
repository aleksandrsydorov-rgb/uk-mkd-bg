import { electricityOpeningAdapter } from '@/lib/moduleCore/adapters/electricityOpeningAdapter';
import { exampleOpeningAdapter } from '@/lib/moduleCore/adapters/exampleOpeningAdapter';
import { internetOpeningAdapter } from '@/lib/moduleCore/adapters/internetOpeningAdapter';
import { propertyBookOpeningAdapter } from '@/lib/moduleCore/adapters/propertyBookOpeningAdapter';
import { capitalRepairOpeningAdapter } from '@/lib/moduleCore/adapters/capitalRepairOpeningAdapter';
import { inventoryOpeningAdapter } from '@/lib/moduleCore/adapters/inventoryOpeningAdapter';
import { supportFeeOpeningAdapter } from '@/lib/moduleCore/adapters/supportFeeOpeningAdapter';
import { ukExpensesOpeningAdapter } from '@/lib/moduleCore/adapters/ukExpensesOpeningAdapter';
import { waterOpeningAdapter } from '@/lib/moduleCore/adapters/waterOpeningAdapter';
import {
  clearModuleAdapterRegistry,
  getModuleAdapter,
  registerModuleAdapter,
} from '@/lib/moduleCore/registry';
import type { ModuleSetupAdapter } from '@/lib/moduleCore/types';

/**
 * Module-local flag resets when this file is HMR-replaced. globalThis keeps the
 * "already bootstrapped" signal aligned with the durable registry Map.
 */
const BOOT_GLOBAL_KEY = '__amadeus11_module_setup_bootstrapped__';

type BootGlobal = typeof globalThis & {
  [BOOT_GLOBAL_KEY]?: boolean;
};

function readBootstrapped(): boolean {
  return (globalThis as BootGlobal)[BOOT_GLOBAL_KEY] === true;
}

function writeBootstrapped(value: boolean): void {
  (globalThis as BootGlobal)[BOOT_GLOBAL_KEY] = value;
}

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
 *
 * Safe to call repeatedly (admin remount, Initial Setup, Turbopack HMR):
 * `registerModuleAdapter` is idempotent for the same logical registration and
 * still throws when two different adapters claim one key.
 */
export function bootstrapModuleSetupAdapters(): void {
  // Fast path when this module instance and global registry already agree.
  if (readBootstrapped() && getModuleAdapter('example_opening_roster')) return;

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
  // IS-6a: Historical UK expenses inventarisation (import_uk_expense_opening_row; optional).
  registerModuleAdapter(ukExpensesOpeningAdapter);
  // IS-8: Capital Repair opening inventarisation (import_capital_repair_opening_state; optional history).
  registerModuleAdapter(capitalRepairOpeningAdapter);
  // INV-6: Inventory opening (empty / manual / XLSX / optional physical session).
  registerModuleAdapter(inventoryOpeningAdapter);
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
  writeBootstrapped(true);
}

/** Vitest only */
export function resetModuleSetupAdaptersForTests(): void {
  clearModuleAdapterRegistry();
  writeBootstrapped(false);
}

