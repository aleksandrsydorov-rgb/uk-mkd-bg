import {
  MODULE_LIFECYCLE_STATES,
  type ModuleLifecycleState,
} from '@/lib/moduleCore/types';

/** Strict IS-1 transitions (mirrors SQL module_lifecycle_transition_allowed). */
const ALLOWED: Record<ModuleLifecycleState, readonly ModuleLifecycleState[]> = {
  DISABLED: ['SETUP_REQUIRED', 'READY'],
  SETUP_REQUIRED: ['SETUP_IN_PROGRESS', 'DISABLED'],
  SETUP_IN_PROGRESS: ['READY', 'SETUP_REQUIRED', 'DISABLED'],
  READY: ['ACTIVE', 'SETUP_IN_PROGRESS', 'DISABLED'],
  ACTIVE: ['SUSPENDED', 'DISABLED'],
  SUSPENDED: ['ACTIVE', 'READY', 'DISABLED'],
};

export function isModuleLifecycleState(value: unknown): value is ModuleLifecycleState {
  return (MODULE_LIFECYCLE_STATES as readonly string[]).includes(String(value ?? ''));
}

export function canTransitionModuleLifecycle(
  from: ModuleLifecycleState | null | undefined,
  to: ModuleLifecycleState,
): boolean {
  if (!isModuleLifecycleState(to)) return false;
  if (from == null) return to === 'DISABLED';
  if (from === to) return false;
  return ALLOWED[from].includes(to);
}

/** Modules without setup may go DISABLED → READY when prerequisites hold. */
export function initialTargetState(args: {
  requiresInitialSetup: boolean;
  prerequisitesSatisfied: boolean;
}): ModuleLifecycleState | null {
  if (!args.prerequisitesSatisfied) return null;
  return args.requiresInitialSetup ? 'SETUP_REQUIRED' : 'READY';
}

/** Suspension preserves domain data; reactivation reuses READY/ACTIVE path. */
export function suspensionPreservesData(from: ModuleLifecycleState, to: ModuleLifecycleState): boolean {
  return from === 'ACTIVE' && to === 'SUSPENDED';
}

export function reactivationReusesSetup(from: ModuleLifecycleState, to: ModuleLifecycleState): boolean {
  return from === 'SUSPENDED' && (to === 'ACTIVE' || to === 'READY');
}
