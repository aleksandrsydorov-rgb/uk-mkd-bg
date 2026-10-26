import { describe, expect, it } from 'vitest';
import { moduleCatalogStatusKind } from '@/components/admin/AdminModuleCatalogPanel';
import { parseSettingsTab, SETTINGS_TABS } from '@/components/admin/AdminSettingsHub';

describe('moduleCatalogStatusKind', () => {
  it('separates not_implemented from disabled', () => {
    expect(
      moduleCatalogStatusKind({
        implemented: false,
        enabled: false,
        moduleKey: 'water',
      }),
    ).toBe('not_implemented');
    expect(
      moduleCatalogStatusKind({
        implemented: true,
        enabled: false,
        moduleKey: 'water',
      }),
    ).toBe('disabled');
    expect(
      moduleCatalogStatusKind({
        implemented: true,
        enabled: true,
        moduleKey: 'water',
      }),
    ).toBe('enabled');
  });

  it('marks Rental as r1_unavailable; Meetings follows implemented/enabled (RC8)', () => {
    expect(
      moduleCatalogStatusKind({
        implemented: true,
        enabled: true,
        moduleKey: 'general_meeting',
      }),
    ).toBe('enabled');
    expect(
      moduleCatalogStatusKind({
        implemented: true,
        enabled: false,
        moduleKey: 'general_meeting',
      }),
    ).toBe('disabled');
    expect(
      moduleCatalogStatusKind({
        implemented: false,
        enabled: false,
        moduleKey: 'rental',
      }),
    ).toBe('r1_unavailable');
  });

  it('saving overrides other kinds', () => {
    expect(
      moduleCatalogStatusKind({
        implemented: true,
        enabled: true,
        moduleKey: 'water',
        saving: true,
      }),
    ).toBe('saving');
  });
});

describe('parseSettingsTab', () => {
  it('defaults to hub and accepts known tabs', () => {
    expect(parseSettingsTab(null)).toBe('hub');
    expect(parseSettingsTab('finance')).toBe('finance');
    expect(parseSettingsTab('nope')).toBe('hub');
    expect(SETTINGS_TABS).toContain('modules');
  });
});
