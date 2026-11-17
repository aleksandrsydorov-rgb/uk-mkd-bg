/**
 * Isolated UAT for internet simple opening (firstrun DB docker).
 * Does not touch VPS / prod. Cleans only its own test pending/import rows.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as XLSX from 'xlsx';
import {
  buildInternetSimpleTemplateBuffer,
  INTERNET_SIMPLE_IMPORT_SPEC,
} from '../src/lib/importTemplates/specs/internetSimple.ts';
import { parseInternetOpeningWorkbook } from '../src/lib/internetSimpleOpening.ts';
import {
  buildLocalizedImportWorkbookWithRows,
  localizedTemplateFileName,
  toImportTemplateLocale,
} from '../src/lib/importTemplates/workbook.ts';

const DB = 'supabase_db_amadeus11-rc8-firstrun-e2e';
const OUT = path.resolve('tmp/uat-internet-opening');
const AUTH_SUB = '41fb7be1-8355-412d-af12-3f38655a5f5b';
const AUTH_EMAIL = 'admin@e2e.local';
fs.mkdirSync(OUT, { recursive: true });

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
    { encoding: 'utf8' },
  ).trim();
}

function withAuth(sql) {
  return `
    select set_config('request.jwt.claim.sub', '${AUTH_SUB}', true);
    select set_config('request.jwt.claim.email', '${AUTH_EMAIL}', true);
    select set_config('request.jwt.claim.role', 'authenticated', true);
    ${sql}
  `;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const report = [];
function ok(msg) {
  report.push(`PASS ${msg}`);
  console.log('PASS', msg);
}
function info(msg) {
  report.push(`INFO ${msg}`);
  console.log('INFO', msg);
}

const propCount = Number(psql('select count(*) from properties'));
assert(propCount === 115, `expected 115 properties, got ${propCount}`);
ok(`properties=${propCount}`);

const stageBefore = psql(
  "select stage_key||':'||status from first_run_stage_progress where stage_key in ('internet_opening','tariffs') order by 1",
);
info(`wizard stages before: ${stageBefore.replace(/\n/g, ', ')}`);

const seeds = JSON.parse(
  psql(`select coalesce(json_agg(json_build_object(
    'apartment_number', apartment_number,
    'section_code', coalesce(section_code,''),
    'block_code', coalesce(block_code,'')
  ) order by section_code nulls last, apartment_number), '[]'::json)
  from properties`),
);
assert(seeds.length === 115, `seed count ${seeds.length}`);

const templatePaths = {};
for (const locale of ['ru', 'bg', 'en']) {
  const buf = buildInternetSimpleTemplateBuffer(locale, seeds);
  const name = localizedTemplateFileName(INTERNET_SIMPLE_IMPORT_SPEC, locale);
  const filePath = path.join(OUT, name);
  fs.writeFileSync(filePath, Buffer.from(buf));
  templatePaths[locale] = filePath;

  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  const sheetName = INTERNET_SIMPLE_IMPORT_SPEC.dataSheetName[locale];
  assert(wb.SheetNames.includes(sheetName), `missing sheet ${sheetName}`);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
  const header = rows[0].map((c) => String(c).trim());
  assert(header.length === 4, `expected 4 columns, got ${header.length}: ${header.join('|')}`);
  const dataRows = rows.slice(1).filter((r) => String(r[0] ?? '').trim());
  assert(dataRows.length === 115, `${locale} data rows ${dataRows.length}`);
  // Round-trip reopen
  const reopened = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' });
  assert(reopened.SheetNames.includes(sheetName), `${locale} reopen failed`);
  ok(`${locale} template ${name}: 4 cols, ${dataRows.length} apts, opens clean`);
}

const pick = seeds.slice(0, 5);
const [aDebt, aCredit, aZero, aBlank, aConflict] = pick;

function scenarioBuffer(locale, mapByApt) {
  const rows = seeds.map((s) => ({
    apartment_number: s.apartment_number,
    section_code: s.section_code,
    block_code: s.block_code,
    opening_balance_eur: mapByApt[s.apartment_number] ?? '',
  }));
  return buildLocalizedImportWorkbookWithRows(
    INTERNET_SIMPLE_IMPORT_SPEC,
    toImportTemplateLocale(locale),
    rows,
    { extraBlankRows: 0 },
  );
}

const amountMap = {
  [aDebt.apartment_number]: '50',
  [aCredit.apartment_number]: '-50',
  [aZero.apartment_number]: '0',
  [aBlank.apartment_number]: '',
  [aConflict.apartment_number]: '25',
};
const hyphenMap = { ...amountMap, [aBlank.apartment_number]: '-' };

const scenarioBuf = scenarioBuffer('ru', amountMap);
fs.writeFileSync(path.join(OUT, 'scenario-ru.xlsx'), Buffer.from(scenarioBuf));

const hyphenParsed = parseInternetOpeningWorkbook(scenarioBuffer('ru', hyphenMap), 'ru');
assert(hyphenParsed.ok, 'hyphen file should still parse workbook');
assert(
  hyphenParsed.clientErrors.some((e) => String(e.reason).includes('hyphen')),
  'expected hyphen client error',
);
ok(`hyphen rejected client-side (${hyphenParsed.clientErrors.length} errors)`);

const parsed = parseInternetOpeningWorkbook(scenarioBuf, 'ru');
assert(parsed.ok && parsed.mode === 'simple', `parse mode=${parsed.ok && parsed.mode}`);
ok(`client parse: mode=${parsed.mode}, rpcRows=${parsed.rows.length}`);

function pid(apt) {
  return Number(
    psql(
      `select id from properties where apartment_number='${String(apt).replace(/'/g, "''")}' order by id limit 1`,
    ),
  );
}
const ids = {
  debt: pid(aDebt.apartment_number),
  credit: pid(aCredit.apartment_number),
  zero: pid(aZero.apartment_number),
  blank: pid(aBlank.apartment_number),
  conflict: pid(aConflict.apartment_number),
};
const idList = Object.values(ids).join(',');

psql(`
  delete from utility_opening_pending where utility='internet' and property_id in (${idList});
  delete from internet_opening_imports where property_id in (${idList});
  delete from internet_ledger where property_id in (${idList}) and kind in ('opening_debit','opening_credit');
  delete from internet_subscriptions where property_id in (${idList});
`);
ok('cleaned prior test rows for 5 apartments');

const testApts = new Set(pick.map((p) => p.apartment_number));
const rpcRows = parsed.rows.filter((r) => testApts.has(r.apartment_number));
assert(rpcRows.length >= 4, `rpcRows for test apts ${rpcRows.length}`);

function callImport(rows, dry) {
  const json = JSON.stringify(rows).replace(/'/g, "''");
  const out = psql(
    withAuth(`select public.admin_import_internet_opening('${json}'::jsonb, ${dry}, false, null)::text;`),
  );
  const lines = out.split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

const dryJson = callImport(rpcRows, true);
assert(dryJson.ok === true, `dry not ok: ${JSON.stringify(dryJson.errors || dryJson).slice(0, 500)}`);
ok(`dry-run ok defer=${(dryJson.rows || []).filter((r) => r.outcome === 'DEFER').length}`);

const applyJson = callImport(rpcRows, false);
assert(applyJson.ok === true, `apply not ok: ${JSON.stringify(applyJson.errors || applyJson).slice(0, 500)}`);
ok(`apply ok`);

const pendingCount = Number(
  psql(
    `select count(*) from utility_opening_pending where utility='internet' and status='needs_initial' and property_id in (${idList})`,
  ),
);
const subCount = Number(psql(`select count(*) from internet_subscriptions where property_id in (${idList})`));
const ledgerOpen = Number(
  psql(
    `select count(*) from internet_ledger where property_id in (${idList}) and kind in ('opening_debit','opening_credit')`,
  ),
);
assert(pendingCount >= 3, `expected pending>=3 got ${pendingCount}`);
assert(subCount === 0, `no auto subscriptions expected, got ${subCount}`);
assert(ledgerOpen === 0, `no opening ledger before confirm, got ${ledgerOpen}`);
ok(`pending=${pendingCount} subscriptions=${subCount} opening_ledger=${ledgerOpen}`);

const debtPayload = psql(
  `select payload->>'debt' from utility_opening_pending where property_id=${ids.debt} and utility='internet' and status='needs_initial'`,
);
const creditPayload = psql(
  `select payload->>'credit' from utility_opening_pending where property_id=${ids.credit} and utility='internet' and status='needs_initial'`,
);
assert(Number(debtPayload) === 50, `debt payload ${debtPayload}`);
assert(Number(creditPayload) === 50, `credit payload ${creditPayload}`);
ok(`payloads debt=${debtPayload} credit=${creditPayload}`);

const reSame = callImport(rpcRows, true);
assert((reSame.rows || []).filter((r) => r.outcome === 'SKIP').length >= 3, 'expected SKIP on match');
ok(`reimport match SKIP=${(reSame.rows || []).filter((r) => r.outcome === 'SKIP').length}`);

const blankRows = rpcRows.map((r) => ({ ...r, opening_debt: '', opening_credit: '' }));
const reBlank = callImport(blankRows, false);
assert(reBlank.ok === true, 'blank reimport should ok');
const stillDebt = psql(
  `select payload->>'debt' from utility_opening_pending where property_id=${ids.debt} and utility='internet' and status='needs_initial'`,
);
assert(Number(stillDebt) === 50, `blank wiped debt? ${stillDebt}`);
ok(`blank reimport preserved debt=${stillDebt}`);

const conflictRows = rpcRows
  .filter((r) => r.apartment_number === aDebt.apartment_number)
  .map((r) => ({ ...r, opening_debt: '99', opening_credit: '0' }));
const reConflict = callImport(conflictRows, true);
assert(reConflict.ok === false, 'conflict should fail ok');
assert(
  JSON.stringify(reConflict.errors || []).includes('conflict:existing_opening_import_mismatch'),
  `expected mismatch, got ${JSON.stringify(reConflict.errors).slice(0, 300)}`,
);
ok('conflict mismatch reported without overwrite');

const confirmOut = psql(
  withAuth(
    `select public.admin_confirm_internet_opening(${ids.debt}, 'active', current_date, null, null, null, null, null, null)::text;`,
  ),
);
const confirmJson = JSON.parse(confirmOut.split(/\r?\n/).filter(Boolean).pop());
assert(confirmJson.ok === true, `confirm failed ${confirmOut}`);
const subAfter = psql(
  `select status||':'||(opening_confirmed_at is not null) from internet_subscriptions where property_id=${ids.debt}`,
);
const ledgerDebt = psql(
  `select coalesce(sum(amount_eur),0) from internet_ledger where property_id=${ids.debt} and kind='opening_debit'`,
);
assert(subAfter.startsWith('active:'), `sub ${subAfter}`);
assert(Number(ledgerDebt) === 50, `ledger debt ${ledgerDebt}`);
const ready = psql(`select public.internet_opening_is_billing_ready(${ids.debt})`);
assert(ready === 't' || ready === 'true', `billing ready ${ready}`);
ok(`confirm applied debt=50, sub=${subAfter}, billing_ready=${ready}`);

psql(`
  delete from internet_ledger where property_id in (${idList}) and kind in ('opening_debit','opening_credit');
  delete from internet_opening_imports where property_id in (${idList});
  delete from internet_subscriptions where property_id in (${idList});
  delete from utility_opening_pending where utility='internet' and property_id in (${idList});
`);
assert(
  Number(
    psql(
      `select count(*) from utility_opening_pending where utility='internet' and property_id in (${idList})`,
    ),
  ) === 0,
  'test leftovers remain',
);
ok('cleaned test leftovers');

assert(Number(psql('select count(*) from properties')) === 115, 'properties changed');
const stageAfter = psql(
  "select stage_key||':'||status from first_run_stage_progress where stage_key in ('internet_opening','tariffs') order by 1",
);
assert(stageAfter === stageBefore, 'wizard progress changed');
ok('115 apartments + wizard progress preserved');

fs.writeFileSync(path.join(OUT, 'REPORT.txt'), report.join('\n') + '\n');
console.log('\nTemplates:');
for (const [loc, p] of Object.entries(templatePaths)) console.log(`  ${loc}: ${p}`);
console.log('UAT OK');
