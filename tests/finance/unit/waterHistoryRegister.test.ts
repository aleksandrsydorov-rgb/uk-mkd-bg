import { describe, expect, it } from 'vitest';
import {
  buildWaterHistoryRegisterRows,
  filterWaterHistoryRegisterRows,
} from '@/lib/waterHistoryRegister';

describe('waterHistoryRegister', () => {
  const properties = [
    { id: 1, apartment_number: '10', section_code: 'Б', block_code: '1', owner_name: 'Иванов' },
    { id: 2, apartment_number: '2', section_code: 'A', block_code: '1', owner_name: 'Petrov' },
    { id: 3, apartment_number: '2', section_code: 'Б', block_code: '2', owner_name: null },
    { id: 4, apartment_number: '23', section_code: 'A', block_code: '1', owner_name: null },
    { id: 5, apartment_number: '23', section_code: 'В', block_code: '1', owner_name: 'X' },
  ];

  const meters = [
    { property_id: 1, meter_number: '00100' },
    { property_id: 2, meter_number: '99' },
    { property_id: 2, meter_number: 'old-retired' },
    { property_id: 3, meter_number: 'x' },
  ];

  const readings = [
    { property_id: 1, reading_date: '2024-01-01' },
    { property_id: 1, reading_date: '2024-06-15' },
    { property_id: 2, reading_date: '2024-03-01' },
  ];

  it('keeps every property; empty history stays; sorts section→block→apt', () => {
    const rows = buildWaterHistoryRegisterRows(meters, readings, properties);
    expect(rows.map((r) => r.propertyId)).toEqual([2, 4, 1, 3, 5]);
    expect(rows.find((r) => r.propertyId === 4)?.lastEventDate).toBeNull();
    expect(rows.find((r) => r.propertyId === 1)?.lastEventDate).toBe('2024-06-15');
    // Same apt number, different sections stay separate
    expect(rows.filter((r) => r.apartmentNumber === '2').map((r) => r.propertyId).sort()).toEqual([
      2, 3,
    ]);
    expect(rows.filter((r) => r.apartmentNumber === '23')).toHaveLength(2);
  });

  it('date range affects last event only; empty apt remains', () => {
    const rows = buildWaterHistoryRegisterRows(meters, readings, properties, '2024-01-01', '2024-02-01');
    expect(rows.find((r) => r.propertyId === 1)?.lastEventDate).toBe('2024-01-01');
    expect(rows.find((r) => r.propertyId === 2)?.lastEventDate).toBeNull();
    expect(rows).toHaveLength(5);
  });

  it('search matches apt, owner, meter including retired numbers', () => {
    const rows = buildWaterHistoryRegisterRows(meters, readings, properties);
    expect(filterWaterHistoryRegisterRows(rows, {
      query: 'Иванов',
      section: '',
      block: '',
      periodFrom: '',
      periodTo: '',
    }).map((r) => r.propertyId)).toEqual([1]);
    expect(filterWaterHistoryRegisterRows(rows, {
      query: 'old-retired',
      section: '',
      block: '',
      periodFrom: '',
      periodTo: '',
    }).map((r) => r.propertyId)).toEqual([2]);
    expect(filterWaterHistoryRegisterRows(rows, {
      query: '23',
      section: '',
      block: '',
      periodFrom: '',
      periodTo: '',
    }).map((r) => r.propertyId).sort()).toEqual([4, 5]);
  });
});
