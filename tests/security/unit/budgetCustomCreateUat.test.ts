import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  buildBudgetPreviewGroups,
  enrichBudgetPreviewWithExisting,
  readBudgetPlanWorkbook,
  validateBudgetPlanAgainstCatalog,
} from '@/lib/budgetPlanImport';

const DB = 'supabase_db_amadeus11-rc8-firstrun-e2e';
const AUTH_SUB = '41fb7be1-8355-412d-af12-3f38655a5f5b';
const AUTH_EMAIL = 'admin@e2e.local';
const TEST_YEAR = 2097;
const FILE =
  'C:/Users/aleks/Desktop/АМАДЕУС 11 Данные/08 заполненный-бюджет-плана.xlsx';

function dockerUp(): boolean {
  try {
    return execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' }).includes(DB);
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

describe('budget custom structure create-on-confirm', () => {
  it.runIf(dockerUp() && fs.existsSync(FILE))(
    'Amadeus filled plan: 21 articles, 85500 EUR, create once, reimport no dupes',
    () => {
      const propsBefore = Number(psql('select count(*) from properties'));
      const catsBefore = Number(psql('select count(*) from budget_categories'));
      const lines2026 = Number(
        psql(
          `select count(*) from budget_lines where year_id=(select id from budget_years where calendar_year=2026)`,
        ),
      );
      const stageBefore = psql(
        `select first_run_status||'|'||coalesce(first_run_stage,'') from platform_installations limit 1`,
      );
      expect(propsBefore).toBe(115);

      const catalog = JSON.parse(
        psql(`select coalesce(json_agg(json_build_object(
          'code', code,
          'name_ru', name_ru, 'name_en', name_en, 'name_bg', name_bg,
          'group_code', group_code,
          'group_name_ru', group_name_ru, 'group_name_en', group_name_en, 'group_name_bg', group_name_bg,
          'subgroup_code', subgroup_code,
          'subgroup_name_ru', subgroup_name_ru, 'subgroup_name_en', subgroup_name_en, 'subgroup_name_bg', subgroup_name_bg
        ) order by sort_order, code), '[]'::json) from budget_categories where active`),
      );

      const buf = fs.readFileSync(FILE);
      const parsed = readBudgetPlanWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      expect(parsed.subgroupColumnPresent).toBe(true);
      const validated = validateBudgetPlanAgainstCatalog(parsed, catalog, 'ru', {
        subgroupColumnPresent: true,
      });
      expect(validated.issues).toEqual([]);
      expect(validated.articles).toHaveLength(21);
      expect(validated.previewRows.filter((r) => r.willCreate).length).toBe(21);

      const enriched = enrichBudgetPreviewWithExisting(validated, new Map());
      const grouped = buildBudgetPreviewGroups(enriched.previewRows);
      // File uses two distinct group labels (ст 50 block + management block) — do not invent more.
      expect(grouped.groups.length).toBe(2);
      expect(grouped.grandTotal).toBe(85500);
      expect(enriched.previewRows.every((r) => r.action === 'create')).toBe(true);

      psql(`
        delete from budget_lines where year_id in (select id from budget_years where calendar_year=${TEST_YEAR});
        delete from budget_years where calendar_year=${TEST_YEAR};
        delete from budget_categories where code like 'usr_%';
      `);

      const rowsJson = JSON.stringify(
        validated.articles.map((a) => ({
          row: a.row,
          code: a.code || '',
          name: a.name,
          group: a.group,
          subgroup: a.subgroup,
          amount: a.amount.toFixed(2),
        })),
      ).replace(/'/g, "''");

      const commit1 = JSON.parse(
        psql(withAuth(`select public.admin_commit_budget_plan(${TEST_YEAR}, '${rowsJson}'::jsonb)::text;`))
          .split('\n')
          .pop()!,
      );
      expect(commit1.applied).toBe(true);
      expect(Number(commit1.categories)).toBe(21);
      expect(Number(commit1.created)).toBe(21);
      expect(Number(commit1.total)).toBe(85500);

      const saved = JSON.parse(
        psql(`select jsonb_build_object(
          'lines', (select count(*) from budget_lines l join budget_years y on y.id=l.year_id where y.calendar_year=${TEST_YEAR}),
          'usr_cats', (select count(*) from budget_categories where code like 'usr_%'),
          'total', (select coalesce(sum(l.planned_amount_eur),0) from budget_lines l join budget_years y on y.id=l.year_id where y.calendar_year=${TEST_YEAR}),
          'groups', (select count(distinct group_name_ru) from budget_categories where code like 'usr_%')
        )::text`),
      );
      expect(Number(saved.lines)).toBe(21);
      expect(Number(saved.usr_cats)).toBe(21);
      expect(Number(saved.total)).toBe(85500);
      expect(Number(saved.groups)).toBe(2);

      const branchTotals = JSON.parse(
        psql(`select coalesce(json_object_agg(g, t), '{}'::json)::text from (
          select c.group_name_ru as g, sum(l.planned_amount_eur) as t
          from budget_lines l
          join budget_years y on y.id = l.year_id
          join budget_categories c on c.id = l.category_id
          where y.calendar_year = ${TEST_YEAR}
          group by c.group_name_ru
        ) s`),
      ) as Record<string, number>;
      const values = Object.values(branchTotals).map(Number).sort((a, b) => a - b);
      expect(values).toEqual([34400, 51100]);

      const commit2 = JSON.parse(
        psql(withAuth(`select public.admin_commit_budget_plan(${TEST_YEAR}, '${rowsJson}'::jsonb)::text;`))
          .split('\n')
          .pop()!,
      );
      expect(commit2.idempotent === true || commit2.applied === true).toBe(true);
      expect(Number(commit2.categories)).toBe(21);
      expect(Number(commit2.total)).toBe(85500);
      expect(Number(psql(`select count(*) from budget_categories where code like 'usr_%'`))).toBe(21);
      expect(
        Number(
          psql(
            `select count(*) from budget_lines l join budget_years y on y.id=l.year_id where y.calendar_year=${TEST_YEAR}`,
          ),
        ),
      ).toBe(21);

      // Cleanup isolated year + custom cats only.
      psql(`
        delete from budget_lines where year_id in (select id from budget_years where calendar_year=${TEST_YEAR});
        delete from budget_years where calendar_year=${TEST_YEAR};
        delete from budget_categories where code like 'usr_%';
      `);

      expect(Number(psql('select count(*) from properties'))).toBe(115);
      expect(Number(psql('select count(*) from budget_categories'))).toBe(catsBefore);
      expect(
        Number(
          psql(
            `select count(*) from budget_lines where year_id=(select id from budget_years where calendar_year=2026)`,
          ),
        ),
      ).toBe(lines2026);
      expect(
        psql(`select first_run_status||'|'||coalesce(first_run_stage,'') from platform_installations limit 1`),
      ).toBe(stageBefore);

      fs.mkdirSync(path.resolve('tmp/uat-budget-custom-create'), { recursive: true });
      fs.writeFileSync(
        path.resolve('tmp/uat-budget-custom-create/report.json'),
        JSON.stringify(
          {
            articles: 21,
            total: 85500,
            groups: 2,
            branchTotals,
            commit1,
            commit2,
          },
          null,
          2,
        ),
      );
    },
  );
});
