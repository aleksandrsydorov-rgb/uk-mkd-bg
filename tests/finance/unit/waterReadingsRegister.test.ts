import { describe, expect, it } from 'vitest';
import {
  buildWaterReadingRegisterRows,
  filterWaterReadingRegisterRows,
} from '@/lib/waterReadingsRegister';

describe('waterReadingsRegister', () => {
  const properties = [
    { id: 1, apartment_number: '10', section_code: 'Б', block_code: '1', owner_name: 'Иванов' },
    { id: 2, apartment_number: '2', section_code: 'A', block_code: '1', owner_name: 'Petrov' },
    { id: 3, apartment_number: '2', section_code: 'Б', block_code: '2', owner_name: null },
  ];

  const meters = [
    { id: 'm-b10', property_id: 1, meter_number: '00123', retired_at: null },
    { id: 'm-a2', property_id: 2, meter_number: '99', retired_at: null },
    { id: 'm-a2-b', property_id: 2, meter_number: '100', retired_at: null },
    { id: 'm-b2', property_id: 3, meter_number: 'x', retired_at: null },
    { id: 'retired', property_id: 2, meter_number: 'old', retired_at: '2019-05-01' },
  ];

  const readings = [
    {
      id: 'r-old',
      property_id: 1,
      meter_id: 'm-b10',
      reading_date: '2024-01-01',
      previous_value: 10,
      current_value: 20,
      submitted_by_email: 'a@x',
      status: 'active',
      reading_kind: 'regular',
      created_at: '2024-01-01T10:00:00Z',
    },
    {
      id: 'r-new',
      property_id: 1,
      meter_id: 'm-b10',
      reading_date: '2024-06-15',
      previous_value: 20,
      current_value: 0,
      submitted_by_email: 'b@x',
      status: 'active',
      reading_kind: 'regular',
      created_at: '2024-06-15T10:00:00Z',
    },
    {
      id: 'r-a2',
      property_id: 2,
      meter_id: 'm-a2',
      reading_date: '2024-03-01',
      previous_value: null,
      current_value: 5,
      submitted_by_email: null,
      status: 'active',
      reading_kind: 'opening',
      created_at: '2024-03-01T10:00:00Z',
    },
  ];

  it('one row per current meter; keeps meters without readings; preserves explicit zero', () => {
    const rows = buildWaterReadingRegisterRows(meters, readings, properties);
    expect(rows.map((r) => r.meterId)).toEqual(['m-a2', 'm-a2-b', 'm-b10', 'm-b2']);
    expect(rows.find((r) => r.meterId === 'm-a2-b')?.readingId).toBeNull();
    expect(rows.find((r) => r.meterId === 'm-b10')?.currentValue).toBe(0);
    expect(rows.find((r) => r.meterId === 'm-b10')?.readingId).toBe('r-new');
    expect(rows.find((r) => r.meterId === 'm-a2')?.statusCode).toBe('opening');
  });

  it('date range picks latest reading inside range', () => {
    const rows = buildWaterReadingRegisterRows(meters, readings, properties, '2024-01-01', '2024-02-01');
    expect(rows.find((r) => r.meterId === 'm-b10')?.readingId).toBe('r-old');
    expect(rows.find((r) => r.meterId === 'm-a2')?.readingId).toBeNull();
  });

  it('filters by apartment, owner, meter, section and block', () => {
    const rows = buildWaterReadingRegisterRows(meters, readings, properties);
    expect(filterWaterReadingRegisterRows(rows, {
      query: 'Иван',
      section: '',
      block: '',
      periodFrom: '',
      periodTo: '',
    }).map((r) => r.meterId)).toEqual(['m-b10']);
    expect(filterWaterReadingRegisterRows(rows, {
      query: '2',
      section: 'A',
      block: '',
      periodFrom: '',
      periodTo: '',
    }).map((r) => r.meterId)).toEqual(['m-a2', 'm-a2-b']);
    expect(filterWaterReadingRegisterRows(rows, {
      query: '',
      section: 'Б',
      block: '2',
      periodFrom: '',
      periodTo: '',
    }).map((r) => r.meterId)).toEqual(['m-b2']);
  });
});
