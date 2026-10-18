import { describe, expect, it } from 'vitest';
import { isPlatformCoreModuleKey } from '@/lib/modules';
import {
  RESIDENCE_STATUS_MODULE_KEY,
  canMutateResidenceStatus,
  parseResidenceOccupancyStatus,
  residenceDoesNotReplacePropertyBook,
  validateResidenceSave,
} from '@/lib/residenceStatus';

describe('Residence Status · occupancy fields + catalog identity', () => {
  it('registers residence_status as platform-core catalog key (not occupancy gate)', () => {
    expect(RESIDENCE_STATUS_MODULE_KEY).toBe('residence_status');
    expect(isPlatformCoreModuleKey(RESIDENCE_STATUS_MODULE_KEY)).toBe(true);
  });
  it('parses only canonical occupancy statuses', () => {
    expect(parseResidenceOccupancyStatus('owner')).toBe('owner');
    expect(parseResidenceOccupancyStatus('STANDBY')).toBe('standby');
    expect(parseResidenceOccupancyStatus('rented')).toBe('rented');
    expect(parseResidenceOccupancyStatus('tenant')).toBeNull();
  });

  it('validateResidenceSave requires until for rented and coherent dates', () => {
    expect(
      validateResidenceSave({ occupancy_status: 'owner', occupant_until: null }),
    ).toEqual([]);
    expect(
      validateResidenceSave({ occupancy_status: 'rented', occupant_until: null }),
    ).toContain('rented_requires_until');
    expect(
      validateResidenceSave({
        occupancy_status: 'rented',
        occupant_until: '2026-12-31',
        effective_from: '2027-01-01',
      }),
    ).toContain('effective_from_after_until');
  });

  it('Guest Mode cannot mutate residence; owner/admin can', () => {
    expect(
      canMutateResidenceStatus({ isOwner: false, isStaffAdmin: false, isGuestOnly: true }),
    ).toBe(false);
    expect(
      canMutateResidenceStatus({ isOwner: true, isStaffAdmin: false, isGuestOnly: false }),
    ).toBe(true);
    expect(
      canMutateResidenceStatus({ isOwner: false, isStaffAdmin: true, isGuestOnly: false }),
    ).toBe(true);
  });

  it('residence never claims Property Book ownership SoT', () => {
    expect(residenceDoesNotReplacePropertyBook()).toBe(true);
  });
});
