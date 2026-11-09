import { describe, expect, it } from 'vitest';
import {
  internetCalendarDays,
  previewInternetPeriodAmount,
} from '@/lib/internet';

describe('internet package/day calendar billing', () => {
  it('counts inclusive calendar days without clock division', () => {
    expect(internetCalendarDays('2026-03-01', '2026-03-01')).toBe(1);
    expect(internetCalendarDays('2026-03-01', '2026-03-29')).toBe(29);
    expect(internetCalendarDays('2026-03-01', '2026-03-30')).toBe(30);
    expect(internetCalendarDays('2026-03-01', '2026-03-31')).toBe(31);
    expect(internetCalendarDays('2026-03-01', '2026-04-07')).toBe(38);
    expect(internetCalendarDays('2026-01-01', '2026-03-01')).toBe(60);
    expect(internetCalendarDays('2026-01-01', '2026-03-06')).toBe(65);
  });

  it('handles month/year/leap and Sofia DST boundaries as calendar dates', () => {
    expect(internetCalendarDays('2025-12-31', '2026-01-02')).toBe(3);
    expect(internetCalendarDays('2024-02-28', '2024-03-01')).toBe(3);
    expect(internetCalendarDays('2025-02-28', '2025-03-01')).toBe(2);
    // Europe/Sofia spring forward 2026-03-29 — still one calendar day.
    expect(internetCalendarDays('2026-03-29', '2026-03-29')).toBe(1);
    expect(internetCalendarDays('2026-03-28', '2026-03-30')).toBe(3);
  });

  it('rejects inverted or malformed ranges', () => {
    expect(internetCalendarDays('2026-03-02', '2026-03-01')).toBeNull();
    expect(internetCalendarDays('bad', '2026-03-01')).toBeNull();
  });

  it('keeps package and day rates independent (day ≠ package/30)', () => {
    const packageRate = 20;
    const dayRate = 1;
    expect(dayRate).not.toBeCloseTo(packageRate / 30);

    expect(previewInternetPeriodAmount(1, 'package_plus_days', packageRate, dayRate)).toEqual({
      package_count: 0,
      extra_days: 1,
      amount_eur: 1,
    });
    expect(previewInternetPeriodAmount(30, 'package_plus_days', packageRate, dayRate)).toEqual({
      package_count: 1,
      extra_days: 0,
      amount_eur: 20,
    });
    expect(previewInternetPeriodAmount(38, 'package_plus_days', packageRate, dayRate)).toEqual({
      package_count: 1,
      extra_days: 8,
      amount_eur: 28,
    });
    expect(previewInternetPeriodAmount(65, 'package_plus_days', packageRate, dayRate)).toEqual({
      package_count: 2,
      extra_days: 5,
      amount_eur: 45,
    });
    expect(previewInternetPeriodAmount(38, 'daily', packageRate, dayRate)).toEqual({
      package_count: 0,
      extra_days: 38,
      amount_eur: 38,
    });
  });
});
