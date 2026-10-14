import type { ModuleRegistration, ModuleSetupContract } from '@/lib/moduleCore/types';

export function setupIsOptional(registration: ModuleRegistration): boolean {
  return !registration.requiresInitialSetup;
}

export function setupSupportsXlsx(setup: ModuleSetupContract | undefined): boolean {
  return Boolean(setup?.importMethods.includes('xlsx') && setup.xlsx);
}

export function setupSupportsManual(setup: ModuleSetupContract | undefined): boolean {
  return Boolean(setup?.importMethods.includes('manual'));
}

export function setupCompleteFromDraft(
  registration: ModuleRegistration,
  draft: Record<string, unknown> | null | undefined,
): boolean {
  if (!registration.requiresInitialSetup) return true;
  const setup = registration.setup;
  if (!setup) return false;
  const requiredKeys = setup.steps.flatMap((s) =>
    s.fields.filter((f) => f.required).map((f) => f.key),
  );
  if (!draft) return requiredKeys.length === 0;
  return requiredKeys.every((key) => {
    const v = draft[key];
    if (v == null) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    return true;
  });
}

export function mergeSetupDraft(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...current, ...patch };
}
