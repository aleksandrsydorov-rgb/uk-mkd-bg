import { describe, expect, it } from 'vitest';
import {
  buildWaterMeterRegisterRows,
  filterWaterMeterRegisterRows,
} from '@/lib/waterMetersRegister';

describe('waterMetersRegister', () => {
  const properties = [
    { id: 1, apartment_number: '10', section_code: 'Б', block_code: '1' },
    { id: 2, apartment_number: '2', section_code: 'A', block_code: '1' },
    { id: 3, apartment_number: '2', section_code: 'Б', block_code: '2' },
  ];

  const meters = [
    {
      id: 'm-b10',
      property_id: 1,
      meter_number: '00123',
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
      id: 'm-b2',
      property_id: 3,
      meter_number: null as unknown as string,
      installed_at: null,
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

  it('lists current meters sorted section → block → apartment; keeps leading zeros', () => {
    const rows = buildWaterMeterRegisterRows(meters, properties);
    expect(rows.map((r) => r.meterId)).toEqual(['m-a2', 'm-b10', 'm-b2']);
    expect(rows[0]?.meterNumber).toBe('99');
    expect(rows[1]?.meterNumber).toBe('00123');
    expect(rows[2]?.meterNumber).toBe('');
    expect(rows[2]?.installedAt).toBeNull();
  });

  it('filters by apartment, meter number, section and block', () => {
    const rows = buildWaterMeterRegisterRows(meters, properties);
    expect(filterWaterMeterRegisterRows(rows, { query: '001', section: '', block: '' })).toHaveLength(1);
    expect(filterWaterMeterRegisterRows(rows, { query: '2', section: 'A', block: '' }).map((r) => r.meterId)).toEqual([
      'm-a2',
    ]);
    expect(filterWaterMeterRegisterRows(rows, { query: '', section: 'Б', block: '2' }).map((r) => r.meterId)).toEqual([
      'm-b2',
    ]);
  });
});
