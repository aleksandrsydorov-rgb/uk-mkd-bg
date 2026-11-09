import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIG = path.resolve(
  process.cwd(),
  'supabase/migrations/20261130320700_r1_rc8_capital_repair_per_sqm.sql',
);

/** Client mirror of server formula: round(area_sqm × rate, 2). */
function capitalRepairAnnualAmount(areaSqm: number, rateEurPerSqmYear: number): number {
  return Math.round(Math.round(areaSqm * 1000) / 1000 * rateEurPerSqmYear * 100) / 100;
}

describe('Capital repair · €/m²·year (area × rate)', () => {
  const sql = readFileSync(MIG, 'utf8');

  it('migration switches catalog to m2/per_unit and multiplies area_sqm', () => {
    expect(sql).toContain("unit_code = 'm2'");
    expect(sql).toContain("calculation_type = 'per_unit'");
    expect(sql).toContain('capital_repair_charge_amount_for_year');
    expect(sql).toMatch(/amount_eur\s*:=\s*round\(\s*round\(v_area,\s*3\)\s*\*\s*v_rate,\s*2\)/);
    expect(sql).toContain('p.area_sqm');
    expect(sql).toContain('area_sqm_snapshot');
    expect(sql).toContain('rate_eur_per_sqm_year_snapshot');
    expect(sql).not.toMatch(/ideal_parts|owner_share|apartment_count/i);
  });

  it('mirrors acceptance amounts 50×2=100 and 75.5×2=151', () => {
    expect(capitalRepairAnnualAmount(50, 2)).toBe(100);
    expect(capitalRepairAnnualAmount(75.5, 2)).toBe(151);
    expect(capitalRepairAnnualAmount(35, 2)).toBe(70);
  });
});
