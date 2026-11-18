/**
 * Isolated firstrun UAT for Group → Subgroup → Article budget.
 * Throwaway year 2099 is created and deleted. Skips when Docker DB is down.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildBudgetPlanTemplateBuffer,
  buildBudgetPreviewGroups,
  enrichBudgetPreviewWithExisting,
  parseBudgetPlanMatrix,
  readBudgetPlanWorkbook,
  validateBudgetPlanAgainstCatalog,
} from '@/lib/budgetPlanImport';
import { BUDGET_PLAN_IMPORT_SPEC, localizedTemplateFileName } from '@/lib/importTemplates';

const DB = 'supabase_db_amadeus11-rc8-firstrun-e2e';
const OUT = path.resolve('tmp/uat-budget-three-level');
const AUTH_SUB = '41fb7be1-8355-412d-af12-3f38655a5f5b';
const AUTH_EMAIL = 'admin@e2e.local';
const TEST_YEAR = 2099;

function dockerUp(): boolean {
  try {
    const names = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
    return names.includes(DB);
  } catch {
    return false;
  }
}

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
    { encoding: 'utf8' },
  ).trim();
}

function withAuth(sql: string): string {
  return `
    select set_config('request.jwt.claim.sub', '${AUTH_SUB}', true);
    select set_config('request.jwt.claim.email', '${AUTH_EMAIL}', true);
    select set_config('request.jwt.claim.role', 'authenticated', true);
    ${sql}
  `;
}

describe.runIf(dockerUp())('budget three-level firstrun UAT', () => {
  it('templates, path match, commit totals, legacy, cleanup', () => {
    fs.mkdirSync(OUT, { recursive: true });
    const propsBefore = Number(psql('select count(*) from properties'));
    const linesBefore = Number(
      psql(
        `select count(*) from budget_lines where year_id=(select id from budget_years where calendar_year=2026)`,
      ),
    );
    const stageBudget = psql(
      `select stage_key||':'||status from first_run_stage_progress where stage_key='budget'`,
    );
    const year2026 = psql(
      `select calendar_year||'|'||status from budget_years where calendar_year=2026`,
    );
    expect(propsBefore).toBe(115);
    expect(year2026).toMatch(/2026\|draft/);

    const catalog = JSON.parse(
      psql(`select coalesce(json_agg(json_build_object(
        'code', code,
        'name_ru', name_ru, 'name_en', name_en, 'name_bg', name_bg,
        'group_code', group_code,
        'group_name_ru', group_name_ru, 'group_name_en', group_name_en, 'group_name_bg', group_name_bg,
        'subgroup_code', subgroup_code,
        'subgroup_name_ru', subgroup_name_ru, 'subgroup_name_en', subgroup_name_en, 'subgroup_name_bg', subgroup_name_bg
      ) order by sort_order, code), '[]'::json) from budget_categories where active`),
    ) as Array<Record<string, string | null>>;

    const templatePaths: Record<string, string> = {};
    for (const locale of ['ru', 'bg', 'en'] as const) {
      const seed = catalog.map((cat) => {
        const group =
          locale === 'bg'
            ? cat.group_name_bg || cat.group_name_ru
            : locale === 'en'
              ? cat.group_name_en || cat.group_name_ru
              : cat.group_name_ru || cat.group_name_en;
        const subgroup =
          locale === 'bg'
            ? cat.subgroup_name_bg || cat.subgroup_name_ru || ''
            : locale === 'en'
              ? cat.subgroup_name_en || cat.subgroup_name_ru || ''
              : cat.subgroup_name_ru || cat.subgroup_name_en || '';
        const name =
          locale === 'bg'
            ? cat.name_bg || cat.name_ru
            : locale === 'en'
              ? cat.name_en || cat.name_ru
              : cat.name_ru || cat.name_en;
        return { group: String(group ?? ''), subgroup: String(subgroup ?? ''), name: String(name ?? ''), amount: '' };
      });
      const buf = buildBudgetPlanTemplateBuffer(locale, seed);
      const fileName = localizedTemplateFileName(BUDGET_PLAN_IMPORT_SPEC, locale);
      const filePath = path.join(OUT, fileName);
      fs.writeFileSync(filePath, Buffer.from(buf));
      templatePaths[locale] = filePath;

      const book = XLSX.read(buf, { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
        header: 1,
        defval: '',
      });
      const header = (matrix[0] || []).map(String);
      const joined = matrix.flat().map(String).join('|');
      expect(header.length).toBeGreaterThanOrEqual(4);
      // Internal catalog codes must not appear as cells (human labels are fine).
      expect(joined).not.toMatch(/(^|\|)(ops|svc_[a-z0-9_]+|group_code|subgroup_code)(\||$)/i);
      expect(header.some((h) => /код статьи|article code|код на статията/i.test(h))).toBe(false);
      const parsed = readBudgetPlanWorkbook(buf);
      expect(parsed.previewRows.length).toBeGreaterThanOrEqual(7);
    }
    fs.writeFileSync(path.join(OUT, 'template-paths.json'), JSON.stringify(templatePaths, null, 2));

    const sample = parseBudgetPlanMatrix([
      ['Группа', 'Подгруппа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['Содержание и обслуживание', '', 'Уборка', '50'],
      ['Содержание и обслуживание', '', 'Охрана', '0'],
      ['Содержание и обслуживание', '', 'Резерв', ''],
      ['Регулярные услуги', 'Охрана и контроль', 'Видеонаблюдение', '100'],
      ['Регулярные услуги', 'Клининг', 'Уборка холлов', '25'],
      ['Регулярные услуги', '', 'Резерв', '10'],
      ['Регулярные услуги', 'Клининг', 'Видеонаблюдение', '1'],
    ]);
    const validated = validateBudgetPlanAgainstCatalog(sample, catalog as never, 'ru', {
      subgroupColumnPresent: sample.subgroupColumnPresent,
    });
    expect(validated.previewRows.find((r) => r.row === 4)?.code).toBe('ops_reserve');
    expect(validated.articles.find((a) => a.code === 'svc_reserve')?.amount).toBe(10);
    expect(validated.previewRows.find((r) => r.code === 'cleaning')?.subgroup).toBe('');
    expect(validated.previewRows.find((r) => r.row === 8)?.willCreate).toBe(true);
    expect(validated.articles.find((a) => a.row === 8)?.name).toMatch(/Видеонаблюдение/);
    expect(validated.articles.find((a) => a.code === 'security')?.amount).toBe(0);
    expect(validated.articles.some((a) => a.code === 'ops_reserve')).toBe(false);

    const good = validateBudgetPlanAgainstCatalog(
      parseBudgetPlanMatrix([
        ['Группа', 'Подгруппа', 'Статья бюджета', 'Плановая сумма, EUR'],
        ['Содержание и обслуживание', '', 'Уборка', '50'],
        ['Содержание и обслуживание', '', 'Охрана', '0'],
        ['Регулярные услуги', 'Охрана и контроль', 'Видеонаблюдение', '100'],
        ['Регулярные услуги', 'Клининг', 'Уборка холлов', '25'],
        ['Регулярные услуги', '', 'Резерв', '10'],
      ]),
      catalog as never,
      'ru',
      { subgroupColumnPresent: true },
    );
    const grouped = buildBudgetPreviewGroups(
      enrichBudgetPreviewWithExisting(good, new Map()).previewRows,
    );
    expect(grouped.groups).toHaveLength(2);
    expect(grouped.groups.some((g) => g.subgroups.length >= 1)).toBe(true);
    expect(grouped.grandTotal).toBe(185);

    psql(`
      delete from budget_lines where year_id in (select id from budget_years where calendar_year=${TEST_YEAR});
      delete from budget_years where calendar_year=${TEST_YEAR};
    `);

    const rowsJson = JSON.stringify(
      good.articles.map((a) => ({
        row: a.row,
        code: a.code,
        name: a.name,
        group: a.group,
        subgroup: a.subgroup,
        amount: a.amount.toFixed(2),
      })),
    ).replace(/'/g, "''");

    const commit1 = JSON.parse(
      psql(
        withAuth(`select public.admin_commit_budget_plan(${TEST_YEAR}, '${rowsJson}'::jsonb)::text;`),
      )
        .split('\n')
        .pop()!,
    );
    expect(commit1.applied).toBe(true);
    expect(Number(commit1.total)).toBe(185);
    expect(Number(commit1.categories)).toBe(5);

    const commit2 = JSON.parse(
      psql(
        withAuth(`select public.admin_commit_budget_plan(${TEST_YEAR}, '${rowsJson}'::jsonb)::text;`),
      )
        .split('\n')
        .pop()!,
    );
    expect(commit2.idempotent).toBe(true);
    expect(commit2.applied).toBe(false);
    expect(
      Number(
        psql(
          `select count(*) from budget_lines where year_id=(select id from budget_years where calendar_year=${TEST_YEAR})`,
        ),
      ),
    ).toBe(5);

    const legacy = parseBudgetPlanMatrix([
      ['Код статьи', 'Название статьи', 'План на год, EUR'],
      ['cleaning', 'Уборка', '11'],
      ['svc_cctv', 'Видеонаблюдение', '22'],
    ]);
    const legacyV = validateBudgetPlanAgainstCatalog(legacy, catalog as never, 'ru', {
      subgroupColumnPresent: legacy.subgroupColumnPresent,
    });
    expect(legacyV.issues).toEqual([]);
    expect(legacyV.previewRows.find((r) => r.code === 'svc_cctv')?.subgroup).toMatch(/Охрана/);

    psql(`
      delete from budget_lines where year_id in (select id from budget_years where calendar_year=${TEST_YEAR});
      delete from budget_years where calendar_year=${TEST_YEAR};
    `);

    expect(Number(psql('select count(*) from properties'))).toBe(115);
    expect(
      Number(
        psql(
          `select count(*) from budget_lines where year_id=(select id from budget_years where calendar_year=2026)`,
        ),
      ),
    ).toBe(linesBefore);
    expect(
      psql(`select stage_key||':'||status from first_run_stage_progress where stage_key='budget'`),
    ).toBe(stageBudget);
    expect(psql(`select calendar_year||'|'||status from budget_years where calendar_year=2026`)).toBe(
      year2026,
    );
    expect(Number(psql(`select count(*) from budget_years where calendar_year=${TEST_YEAR}`))).toBe(0);
  });
});
