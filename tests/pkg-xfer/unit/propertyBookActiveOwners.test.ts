import { describe, expect, it } from 'vitest';
import {
  activeBookOwners,
  bookOwnerForEmail,
  displayedPropertyOwners,
  isActiveBookOwner,
  sessionOwnerDisplayName,
  type PropertyRegistryPerson,
} from '@/lib/propertyBook';

function person(partial: Partial<PropertyRegistryPerson> & Pick<PropertyRegistryPerson, 'id' | 'email'>): PropertyRegistryPerson {
  return {
    property_id: 9001,
    relation_type: 'owner',
    entity_kind: 'natural_person',
    first_name: 'Auto',
    middle_name: null,
    last_name: 'Owner',
    entity_name: null,
    eik_bulstat: null,
    registered_at: '2026-01-01',
    deregistered_at: null,
    lives_on_property: true,
    note: null,
    ownership_share_percent: 100,
    ideal_parts_percent: 1,
    ...partial,
  };
}

describe('PKG-XFER unit · current ownership = active Property Book only (Package 1)', () => {
  it('isActiveBookOwner ignores deregistered and non-owner rows', () => {
    const active = person({ id: 1, email: 'a@example.com' });
    const former = person({
      id: 2,
      email: 'b@example.com',
      deregistered_at: '2026-10-01',
    });
    const occupant = person({
      id: 3,
      email: 'c@example.com',
      relation_type: 'occupant',
    });
    expect(isActiveBookOwner(active)).toBe(true);
    expect(isActiveBookOwner(former)).toBe(false);
    expect(isActiveBookOwner(occupant)).toBe(false);
  });

  it('activeBookOwners excludes former owners after transfer exit', () => {
    const people = [
      person({ id: 1, email: 'keep@example.com', ownership_share_percent: 70, ideal_parts_percent: 0.7 }),
      person({
        id: 2,
        email: 'former@example.com',
        ownership_share_percent: 30,
        ideal_parts_percent: 0.3,
        deregistered_at: '2026-10-11',
      }),
      person({ id: 3, email: 'new@example.com', ownership_share_percent: 30, ideal_parts_percent: 0.3 }),
    ];
    const active = activeBookOwners(people);
    expect(active.map((p) => p.email)).toEqual(['keep@example.com', 'new@example.com']);
    expect(bookOwnerForEmail(people, 'former@example.com')).toBeNull();
    expect(sessionOwnerDisplayName(people, 'former@example.com')).toBeNull();
  });

  it('displayedPropertyOwners never uses legacy owner_* when Book has active rows', () => {
    const people = [
      person({
        id: 10,
        email: 'book@example.com',
        first_name: 'Book',
        last_name: 'Owner',
        ownership_share_percent: 100,
        ideal_parts_percent: 1,
      }),
    ];
    const shown = displayedPropertyOwners(
      { owner_name: 'LEGACY NAME', owner_email: 'legacy@example.com' },
      people
    );
    expect(shown).toHaveLength(1);
    expect(shown[0].email).toBe('book@example.com');
    expect(shown[0].name).toBe('Book Owner');
    expect(shown[0].ownershipSharePercent).toBe(100);
  });

  it('falls back to legacy property owner only when Book empty', () => {
    const shown = displayedPropertyOwners(
      { owner_name: 'Legacy', owner_email: 'legacy@example.com' },
      []
    );
    expect(shown).toEqual([
      expect.objectContaining({
        key: 'property-owner',
        name: 'Legacy',
        email: 'legacy@example.com',
      }),
    ]);
  });
});
