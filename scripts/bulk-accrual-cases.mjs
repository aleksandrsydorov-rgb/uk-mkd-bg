import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'supabase', 'migrations');
const migrationName = readdirSync(migrationsDir).find((name) => name.endsWith('_bulk_accrual_hotfix.sql'));
if (!migrationName) throw new Error('canonical bulk accrual migration is missing');
const sql = readFileSync(join(migrationsDir, migrationName), 'utf8');

function classify(result) {
  if (result === 'unique_violation') return 'skipped_existing';
  if (result.applied) return 'created';
  if (result.idempotent || result.reason === 'charge_already_exists') return 'skipped_existing';
  return 'not_applied';
}

function summarize(results) {
  const outcomes = results.map(classify);
  return {
    total: outcomes.length,
    created: outcomes.filter((item) => item === 'created').length,
    skipped_existing: outcomes.filter((item) => item === 'skipped_existing').length,
  };
}

function assertCase(name, actual, expected) {
  const ok = Object.entries(expected).every(([key, value]) => actual[key] === value);
  if (!ok) {
    console.error(name, actual, expected);
    process.exit(1);
  }
}

const n = 100;
assertCase('case 1 first bulk', summarize(Array.from({ length: n }, () => ({ applied: true }))), {
  total: n,
  created: n,
  skipped_existing: 0,
});
assertCase('case 2 repeated bulk', summarize(Array.from({ length: n }, () => ({ applied: false, idempotent: true }))), {
  total: n,
  created: 0,
  skipped_existing: n,
});
assertCase(
  'case 3 partial',
  summarize([
    ...Array.from({ length: 50 }, () => 'unique_violation'),
    ...Array.from({ length: 50 }, () => ({ applied: true })),
  ]),
  { total: 100, created: 50, skipped_existing: 50 },
);
assertCase('case 4 individual charge already exists', summarize([{ applied: false, reason: 'charge_already_exists' }]), {
  total: 1,
  created: 0,
  skipped_existing: 1,
});
assertCase('case 5 new year or decision', summarize([{ applied: true }]), {
  total: 1,
  created: 1,
  skipped_existing: 0,
});

const supportFn = sql.slice(sql.indexOf('charge_support_fee_bulk'), sql.indexOf('charge_capital_repair_bulk'));
const capitalFn = sql.slice(sql.indexOf('charge_capital_repair_bulk'));

function mustInclude(label, source, needle) {
  if (!source.includes(needle)) {
    console.error(label, 'missing', needle);
    process.exit(1);
  }
}

mustInclude('support', supportFn, 'public.charge_support_fee');
mustInclude('support', supportFn, 'when unique_violation');
mustInclude('support', supportFn, 'charge_already_exists');
mustInclude('support', supportFn, 'can_manage_support_fees');
mustInclude('capital', capitalFn, 'on conflict (property_id, assessment_id) where kind = \'charge\' and assessment_id is not null');
mustInclude('capital', capitalFn, 'do nothing');
mustInclude('capital', capitalFn, "has_staff_role('администрация')");
mustInclude('capital', capitalFn, "has_staff_role('бухгалтер')");

if (/update\s+public\.capital_repair_ledger/i.test(capitalFn)) {
  console.error('capital bulk must not update existing charges');
  process.exit(1);
}
if (/area_sqm|support_fee_base_amount|early_discount/.test(supportFn)) {
  console.error('support bulk must not copy the fee formula');
  process.exit(1);
}

console.log('bulk accrual cases ok');
