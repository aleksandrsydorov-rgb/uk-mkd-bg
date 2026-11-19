import { describe, expect, it } from 'vitest';
import {
  apartmentQueryMatches,
  buildWaterMeterRegisterRows,
  countWaterMeterRegisterStats,
  filterWaterMeterRegisterRows,
} from '@/lib/waterMetersRegister';

describe('waterMetersRegister', () => {
  const properties = [
    { id: 1, apartment_number: '10', section_code: 'Б', block_code: '1' },
    { id: 2, apartment_number: '2', section_code: 'A', block_code: '1' },
    { id: 3, apartment_number: '2', section_code: 'Б', block_code: '2' },
    { id: 4, apartment_number: '23', section_code: 'A', block_code: '1' },
    { id: 5, apartment_number: '23', section_code: 'Б', block_code: '1' },
    { id: 6, apartment_number: '123', section_code: 'A', block_code: '1' },
  ];

  const meters = [
    {
      id: 'm-b10',
      property_id: 1,
      meter_number: '00100',
      installed_at: '2020-01-01',
      retired_at: null,
    },
    {
      id: 'm-a2',
      property_id: 2,
      meter_number: '99',
      installed_at: '2019-06-01',
      retired_at: null,
    },
    {
      id: 'm-a2-b',
      property_id: 2,
      meter_number: '100',
      installed_at: '2021-01-01',
      retired_at: null,
    },
    {
      id: 'm-b2',
      property_id: 3,
      meter_number: null as unknown as string,
      installed_at: null,
      retired_at: null,
    },
    {
      id: 'm-a23',
      property_id: 4,
      meter_number: 'W23',
      installed_at: '2022-01-01',
      retired_at: null,
    },
    {
      id: 'retired',
      property_id: 2,
      meter_number: 'old',
      installed_at: '2010-01-01',
      retired_at: '2019-05-01',
    },
  ];

  it('lists every property; empty meter row when none; multi-meter expands rows', () => {
    const rows = buildWaterMeterRegisterRows(meters, properties);
    expect(new Set(rows.map((r) => r.propertyId)).size).toBe(6);
    expect(rows.filter((r) => r.propertyId === 5)).toEqual([
      expect.objectContaining({
        meterId: null,
        meterNumber: '',
        installedAt: null,
        apartmentNumber: '23',
        sectionCode: 'Б',
      }),
    ]);
    expect(rows.filter((r) => r.propertyId === 2).map((r) => r.meterId)).toEqual(['m-a2', 'm-a2-b']);
    const stats = countWaterMeterRegisterStats(rows);
    expect(stats.apartments).toBe(6);
    expect(stats.meters).toBe(5);
    expect(stats.rows).toBe(7);
  });

  it('search 23 finds all apt №23 across sections, not 123', () => {
    const rows = buildWaterMeterRegisterRows(meters, properties);
    const hit = filterWaterMeterRegisterRows(rows, { query: '23', section: '', block: '' });
    expect(hit.map((r) => r.propertyId).sort()).toEqual([4, 5]);
    expect(apartmentQueryMatches('23', '23')).toBe(true);
    expect(apartmentQueryMatches('123', '23')).toBe(false);
  });

  it('filters by section and block without dropping book apartments', () => {
    const rows = buildWaterMeterRegisterRows(meters, properties);
    expect(
      filterWaterMeterRegisterRows(rows, { query: '', section: 'Б', block: '2' }).map((r) => r.propertyId),
    ).toEqual([3]);
  });
});
