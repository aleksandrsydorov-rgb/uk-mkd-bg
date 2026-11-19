import { describe, expect, it } from 'vitest';
import {
  clampWaterPeriodRange,
  pickWaterSnapsForDateRange,
} from '@/lib/utilityModuleRegister';

const rows = [
  {
    property_id: 1,
    previous_value: 10,
    current_value: 20,
    consumption_m3: 10,
    reading_date: '2025-12-15',
    created_at: '2025-12-15T10:00:00Z',
    reversed_at: null,
    status: 'posted',
  },
  {
    property_id: 1,
    previous_value: 20,
    current_value: 35,
    consumption_m3: 15,
    reading_date: '2026-01-10',
    created_at: '2026-01-10T10:00:00Z',
    reversed_at: null,
    status: 'posted',
  },
  {
    property_id: 1,
    previous_value: 35,
    current_value: 50,
    consumption_m3: 15,
    reading_date: '2026-02-05',
    created_at: '2026-02-05T10:00:00Z',
    reversed_at: null,
    status: 'posted',
  },
  {
    property_id: 1,
    previous_value: 50,
    current_value: 60,
    consumption_m3: 10,
    reading_date: '2026-03-01',
    created_at: '2026-03-01T10:00:00Z',
    reversed_at: null,
    status: 'posted',
  },
  {
    property_id: 2,
    previous_value: 100,
    current_value: 110,
    consumption_m3: 10,
    reading_date: '2025-11-01',
    created_at: 'a',
    reversed_at: null,
    status: 'posted',
  },
  {
    property_id: 2,
    previous_value: 0,
    current_value: 5,
    consumption_m3: 5,
    reading_date: '2026-01-15',
    created_at: 'b',
    reversed_at: null,
    status: 'posted',
  },
  {
    property_id: 2,
    previous_value: 5,
    current_value: 12,
    consumption_m3: 7,
    reading_date: '2026-02-20',
    created_at: 'c',
    reversed_at: null,
    status: 'posted',
  },
  {
    property_id: 4,
    previous_value: 1,
    current_value: 2,
    consumption_m3: 1,
    reading_date: '2026-01-01',
    created_at: 'x',
    reversed_at: '2026-01-02',
    status: 'reversed',
  },
  {
    property_id: 4,
    previous_value: 1,
    current_value: 3,
    consumption_m3: 2,
    reading_date: '2026-01-20',
    created_at: 'y',
    reversed_at: null,
    status: 'posted',
  },
];

describe('pickWaterSnapsForDateRange', () => {
  it('one calendar day', () => {
    const snap = pickWaterSnapsForDateRange(rows, '2026-01-10', '2026-01-10').get(1);
    expect(snap).toMatchObject({
      previousValue: 20,
      currentValue: 35,
      consumptionM3: 15,
    });
  });

  it('multi-month inclusive', () => {
    const snap = pickWaterSnapsForDateRange(rows, '2026-01-01', '2026-02-28').get(1);
    expect(snap).toMatchObject({
      previousValue: 20,
      currentValue: 50,
      consumptionM3: 30,
    });
  });

  it('year boundary', () => {
    const snap = pickWaterSnapsForDateRange(rows, '2025-12-01', '2026-01-31').get(1);
    expect(snap).toMatchObject({
      previousValue: null,
      currentValue: 35,
      consumptionM3: 25,
    });
  });

  it('no readings in or before range → all null', () => {
    const snap = pickWaterSnapsForDateRange(rows, '2024-01-01', '2024-01-31').get(1);
    expect(snap).toMatchObject({
      previousValue: null,
      currentValue: null,
      consumptionM3: null,
    });
  });

  it('no readings in range but baseline before from', () => {
    const snap = pickWaterSnapsForDateRange(rows, '2026-02-10', '2026-02-20').get(1);
    expect(snap).toMatchObject({
      previousValue: 50,
      currentValue: null,
      consumptionM3: null,
    });
  });

  it('multi-meter segments sum stored consumption', () => {
    const snap = pickWaterSnapsForDateRange(rows, '2026-01-01', '2026-02-28').get(2);
    expect(snap).toMatchObject({
      previousValue: 110,
      currentValue: 12,
      consumptionM3: 12,
    });
  });

  it('skips reversed readings', () => {
    const snap = pickWaterSnapsForDateRange(rows, '2026-01-01', '2026-01-31').get(4);
    expect(snap).toMatchObject({
      previousValue: null,
      currentValue: 3,
      consumptionM3: 2,
    });
  });

  it('empty bounds → latest overall', () => {
    const snap = pickWaterSnapsForDateRange(rows, '', '').get(1);
    expect(snap).toMatchObject({
      previousValue: 50,
      currentValue: 60,
      consumptionM3: 10,
    });
  });

  it('clamps end before start', () => {
    expect(clampWaterPeriodRange('2026-02-01', '2026-01-01')).toEqual({
      periodFrom: '2026-02-01',
      periodTo: '2026-02-01',
    });
  });
});
