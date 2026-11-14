import { describe, expect, it } from 'vitest';
import {
  buildApartmentIdentityLookup,
  resolveApartmentPropertyId,
} from '@/lib/propertyBookIdentity';
import { classifyWaterMeterOpeningRows } from '@/lib/moduleCore/adapters/metersOpening';

describe('apartment identity lookup for dependent imports', () => {
  const lookup = buildApartmentIdentityLookup([
    { property_id: 10, apartment_number: '1', section_code: 'A', block_code: '' },
    { property_id: 20, apartment_number: '1', section_code: 'B', block_code: '' },
    { property_id: 30, apartment_number: '2', section_code: 'A', block_code: '' },
  ]);

  it('resolves unique apartment numbers without section', () => {
    expect(resolveApartmentPropertyId(lookup, { apartment_number: '2' })).toEqual({
      propertyId: 30,
    });
  });

  it('requires section when the same number exists in two entrances', () => {
    expect(resolveApartmentPropertyId(lookup, { apartment_number: '1' })).toEqual({
      error: 'section_code_required_for_disambiguation',
    });
  });

  it('binds A/1 and B/1 separately', () => {
    expect(
      resolveApartmentPropertyId(lookup, { apartment_number: '1', section_code: 'A' }),
    ).toEqual({ propertyId: 10 });
    expect(
      resolveApartmentPropertyId(lookup, { apartment_number: '1', section_code: 'B' }),
    ).toEqual({ propertyId: 20 });
  });

  it('classifies water meters for A/1 and B/1 without cross-binding', () => {
    const preview = classifyWaterMeterOpeningRows(
      [
        {
          apartment_number: '1',
          section_code: 'A',
          meter_number: 'W-A1',
          initial_reading: '10',
          installed_at: '2026-01-01',
          opening_balance_kind: 'zero',
          opening_balance_eur: '',
        },
        {
          apartment_number: '1',
          section_code: 'B',
          meter_number: 'W-B1',
          initial_reading: '20',
          installed_at: '2026-01-01',
          opening_balance_kind: 'zero',
          opening_balance_eur: '',
        },
        {
          apartment_number: '1',
          section_code: '',
          meter_number: 'W-AMB',
          initial_reading: '1',
          installed_at: '2026-01-01',
          opening_balance_kind: 'zero',
          opening_balance_eur: '',
        },
      ],
      {
        apartmentsByNumber: lookup,
        existingActiveSerials: new Set(),
        existingMetersBySerial: new Map(),
      },
    );
    expect(preview.createCount).toBe(2);
    expect(preview.errorCount).toBe(1);
    expect(preview.rows[0]?.data.resolved_property_id).toBe('10');
    expect(preview.rows[1]?.data.resolved_property_id).toBe('20');
    expect(preview.rows[2]?.errors).toContain('section_code_required_for_disambiguation');
  });
});
