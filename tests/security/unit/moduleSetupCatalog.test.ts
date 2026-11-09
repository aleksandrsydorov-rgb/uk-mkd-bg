import { describe, expect, it, beforeEach } from 'vitest';
import {
  bootstrapModuleSetupAdapters,
  resetModuleSetupAdaptersForTests,
} from '@/lib/moduleCore/bootstrap';
import {
  buildModuleSetupCatalog,
  classifyModuleSetupStatus,
  isModuleWorkplaceAvailable,
  moduleWizardSteps,
} from '@/lib/moduleSetupCatalog';

const emptyStages = new Set<string>();

describe('moduleSetupCatalog', () => {
  beforeEach(() => {
    resetModuleSetupAdaptersForTests();
    bootstrapModuleSetupAdapters();
  });

  it('exposes workplace availability only when enabled and setup-complete', () => {
    expect(
      isModuleWorkplaceAvailable({
        state: 'ACTIVE',
        buildingEnabled: true,
        requiresInitialSetup: true,
        firstRunCompleted: true,
        firstRunStageComplete: true,
      }),
    ).toBe(true);

    // Zero balances / no payments are irrelevant — readiness is setup + enablement.
    expect(
      isModuleWorkplaceAvailable({
        state: 'DISABLED',
        buildingEnabled: true,
        requiresInitialSetup: true,
        firstRunCompleted: true,
        firstRunStageComplete: true,
      }),
    ).toBe(true);

    expect(
      isModuleWorkplaceAvailable({
        state: 'ACTIVE',
        buildingEnabled: false,
        requiresInitialSetup: true,
        firstRunCompleted: true,
        firstRunStageComplete: true,
      }),
    ).toBe(false);

    expect(
      isModuleWorkplaceAvailable({
        state: 'SETUP_IN_PROGRESS',
        buildingEnabled: true,
        requiresInitialSetup: true,
        firstRunCompleted: true,
        firstRunStageComplete: false,
      }),
    ).toBe(false);
  });

  it('classifies lifecycle and UX access separately', () => {
    expect(
      classifyModuleSetupStatus({
        state: 'ACTIVE',
        buildingEnabled: true,
        hasSetupDraft: false,
        requiresInitialSetup: true,
        firstRunCompleted: true,
        firstRunStageComplete: true,
      }),
    ).toBe('complete');

    // Explicitly disabled after setup — hide from catalog (do not nag reconnect).
    expect(
      classifyModuleSetupStatus({
        state: 'ACTIVE',
        buildingEnabled: false,
        hasSetupDraft: false,
        requiresInitialSetup: true,
        firstRunCompleted: true,
        firstRunStageComplete: true,
      }),
    ).toBe('complete');

    expect(
      classifyModuleSetupStatus({
        state: 'SETUP_IN_PROGRESS',
        buildingEnabled: true,
        hasSetupDraft: true,
        requiresInitialSetup: true,
        firstRunCompleted: true,
        firstRunStageComplete: false,
      }),
    ).toBe('setup_started');

    expect(
      classifyModuleSetupStatus({
        state: 'DISABLED',
        buildingEnabled: false,
        hasSetupDraft: false,
        requiresInitialSetup: false,
        firstRunCompleted: false,
        firstRunStageComplete: null,
      }),
    ).toBe('not_connected');
  });

  it('treats first-run stage complete + enabled as configured even when lifecycle lagged', () => {
    expect(
      classifyModuleSetupStatus({
        state: 'DISABLED',
        buildingEnabled: true,
        hasSetupDraft: false,
        requiresInitialSetup: true,
        firstRunCompleted: true,
        firstRunStageComplete: true,
      }),
    ).toBe('complete');
  });

  it('keeps incomplete opening in catalog with needs_setup', () => {
    expect(
      classifyModuleSetupStatus({
        state: 'DISABLED',
        buildingEnabled: true,
        hasSetupDraft: false,
        requiresInitialSetup: true,
        firstRunCompleted: true,
        firstRunStageComplete: false,
      }),
    ).toBe('needs_setup');
  });

  it('never-connected module stays not_connected', () => {
    expect(
      classifyModuleSetupStatus({
        state: 'DISABLED',
        buildingEnabled: false,
        hasSetupDraft: false,
        requiresInitialSetup: true,
        firstRunCompleted: true,
        firstRunStageComplete: false,
      }),
    ).toBe('not_connected');
  });

  it('explicitly disabled after first-run (no stage) stays hidden when setup not required', () => {
    expect(
      classifyModuleSetupStatus({
        state: 'DISABLED',
        buildingEnabled: false,
        hasSetupDraft: false,
        requiresInitialSetup: false,
        firstRunCompleted: true,
        firstRunStageComplete: null,
      }),
    ).toBe('complete');
  });

  it('hides complete and unrealized modules from the catalog', () => {
    const catalog = buildModuleSetupCatalog({
      lifecycle: [
        {
          module_key: 'chat',
          state: 'ACTIVE',
          building_enabled: true,
          has_setup_draft: false,
          catalog_implemented: true,
        },
        {
          module_key: 'internet',
          state: 'DISABLED',
          building_enabled: true,
          has_setup_draft: false,
          catalog_implemented: true,
        },
        {
          module_key: 'parking',
          state: 'DISABLED',
          building_enabled: false,
          has_setup_draft: false,
          catalog_implemented: false,
        },
        {
          module_key: 'platform_support',
          state: 'ACTIVE',
          building_enabled: true,
          has_setup_draft: false,
          catalog_implemented: true,
        },
        {
          module_key: 'inventory',
          state: 'DISABLED',
          building_enabled: true,
          has_setup_draft: false,
          catalog_implemented: true,
        },
        {
          module_key: 'cleaning',
          state: 'DISABLED',
          building_enabled: true,
          has_setup_draft: false,
          catalog_implemented: true,
        },
        {
          module_key: 'building_documents',
          state: 'ACTIVE',
          building_enabled: true,
          has_setup_draft: false,
          catalog_implemented: true,
        },
      ],
      buildingCatalog: [
        {
          module_key: 'chat',
          enabled: true,
          default_name: 'Chat',
          category: 'communication',
          sort_order: 1,
          implemented: true,
        },
        {
          module_key: 'internet',
          enabled: true,
          default_name: 'Internet',
          category: 'utilities',
          sort_order: 2,
          implemented: true,
        },
        {
          module_key: 'parking',
          enabled: false,
          default_name: 'Parking',
          category: 'services',
          sort_order: 3,
          implemented: false,
        },
        {
          module_key: 'platform_support',
          enabled: true,
          default_name: 'Support',
          category: 'services',
          sort_order: 4,
          implemented: true,
        },
        {
          module_key: 'inventory',
          enabled: true,
          default_name: 'Inventory',
          category: 'operations',
          sort_order: 5,
          implemented: true,
        },
        {
          module_key: 'cleaning',
          enabled: true,
          default_name: 'Cleaning',
          category: 'services',
          sort_order: 6,
          implemented: true,
        },
        {
          module_key: 'building_documents',
          enabled: true,
          default_name: 'Documents',
          category: 'documents',
          sort_order: 7,
          implemented: true,
        },
      ],
      firstRunCompleted: true,
      completedFirstRunStages: new Set(['internet_opening']),
    });

    // internet: FR stage complete → hidden
    // cleaning: FR done, no opening required → hidden
    // building_documents ACTIVE → must not reappear via catalog fallback
    // inventory: enabled but no opening done → needs_setup
    expect(catalog.map((row) => row.moduleKey)).toEqual(['inventory']);
    expect(catalog[0]?.status).toBe('needs_setup');
  });

  it('shows never-connected internet when stage incomplete and UX off', () => {
    const catalog = buildModuleSetupCatalog({
      lifecycle: [
        {
          module_key: 'internet',
          state: 'DISABLED',
          building_enabled: false,
          has_setup_draft: false,
          catalog_implemented: true,
        },
      ],
      buildingCatalog: [
        {
          module_key: 'internet',
          enabled: false,
          default_name: 'Internet',
          category: 'utilities',
          sort_order: 1,
          implemented: true,
        },
      ],
      firstRunCompleted: true,
      completedFirstRunStages: emptyStages,
    });
    expect(catalog.map((row) => row.moduleKey)).toEqual(['internet']);
    expect(catalog[0]?.status).toBe('not_connected');
  });

  it('picks wizard steps by module kind', () => {
    expect(moduleWizardSteps('chat')).toEqual(['confirm', 'activate']);
    expect(moduleWizardSteps('internet')).toEqual(['tariff', 'data', 'activate']);
    expect(moduleWizardSteps('inventory')).toEqual(['data', 'activate']);
  });
});
