import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  isCapitalRepairLaunchYearBlocked,
  parseCapitalRepairLaunchContext,
  parseCapitalRepairYearChargeContext,
} from '@/lib/capitalRepairLaunch';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/20261130335000_r1_rc8_capital_repair_launch_year_charge_guard.sql',
);
const PKG_85A = path.resolve(
  process.cwd(),
  'supabase/packages/fresh_install/85a_capital_repair_bulk_rpcs.sql',
);

describe('capital repair launch-year charge guard', () => {
  it('migration wires helpers into ensure/year_bulk/charge/bulk', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toMatch(/capital_repair_launch_year_blocks/);
    expect(sql).toMatch(/capital_repair_min_charge_year/);
    expect(sql).toMatch(/capital_repair_launch_context/);
    expect(sql).toMatch(/launch_year_blocks_charge/);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.ensure_capital_repair_year_assessment/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.charge_capital_repair_year_bulk/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.charge_capital_repair\s*\(/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.charge_capital_repair_bulk/i);
    expect(sql).toMatch(/skipped_existing/);
  });

  it('fresh_install/85a mirrors launch guard + Jan1 decision_date', () => {
    const sql = readFileSync(PKG_85A, 'utf8');
    expect(sql).toMatch(/20261130333000/);
    expect(sql).toMatch(/20261130335000/);
    expect(sql).toMatch(/make_date\(p_billing_year,\s*1,\s*1\)/);
    expect(sql).toMatch(/capital_repair_launch_year_blocks/);
    expect(sql).toMatch(/launch_year_blocks_charge/);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.ensure_capital_repair_year_assessment/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.charge_capital_repair_year_bulk/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.charge_capital_repair_bulk/i);
  });

  it('UI helpers: launch 2026 blocks 2026, first charge 2027', () => {
    expect(isCapitalRepairLaunchYearBlocked(2026, 2026)).toBe(true);
    expect(isCapitalRepairLaunchYearBlocked(2027, 2026)).toBe(false);
    expect(isCapitalRepairLaunchYearBlocked(2027, 2027)).toBe(true);
    expect(isCapitalRepairLaunchYearBlocked(2028, 2027)).toBe(false);

    const launch = parseCapitalRepairLaunchContext({
      launch_year: 2026,
      min_charge_year: 2027,
      has_launch_year: true,
    });
    expect(launch).toEqual({ launchYear: 2026, minChargeYear: 2027, hasLaunchYear: true });

    const yearCtx = parseCapitalRepairYearChargeContext({
      billing_year: 2026,
      launch_year: 2026,
      min_charge_year: 2027,
      blocked: true,
      block_reason: 'launch_year_blocks_charge',
      apartments_total: 55,
      apartments_charged: 55,
      apartments_opening: 0,
      apartments_remaining: 0,
    });
    expect(yearCtx?.blocked).toBe(true);
    expect(yearCtx?.blockReason).toBe('launch_year_blocks_charge');
    expect(yearCtx?.apartmentsRemaining).toBe(0);
  });
});
