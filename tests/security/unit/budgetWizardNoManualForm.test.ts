import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  buildBudgetPlanTemplateBuffer,
  buildBudgetPreviewGroups,
  parseBudgetPlanMatrix,
  validateBudgetPlanAgainstCatalog,
} from '@/lib/budgetPlanImport';
import { budgetGroupLabel, budgetSubgroupLabel, categoryLabel } from '@/lib/budget';

const DB = 'supabase_db_amadeus11-rc8-firstrun-e2e';
const AUTH_SUB = '41fb7be1-8355-412d-af12-3f38655a5f5b';
const AUTH_EMAIL = 'admin@e2e.local';
const TEST_YEAR = 2098;
const WIZARD = path.resolve('src/components/admin/AdminFirstRunBudget.tsx');

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

describe('first-run budget wizard without manual form', () => {
  it('source has no manual category form or basis note UI', () => {
    const src = fs.readFileSync(WIZARD, 'utf8');
    expect(src).not.toMatch(/firstRunBudgetBasisNote/);
    expect(src).not.toMatch(/commitPlanFromAmounts/);
    expect(src).not.toMatch(/onSaveAmounts/);
    expect(src).not.toMatch(/setAmounts/);
    expect(src).toMatch(/SavedBudgetStructureTable/);
    expect(src).toMatch(/onConfirmImport/);
    expect(src).toMatch(/onGoToReview/);
    // Publish must not rewrite plan from a form
    expect(src).toMatch(/Publish already-imported lines only/);
  });

  it.runIf(dockerUp())('import → saved structure → reimport does not zero other lines; cleanup', () => {
    const propsBefore = Number(psql('select count(*) from properties'));
    const linesUserBefore = Number(
      psql(`select count(*) from budget_lines where year_id=(select id from budget_years where calendar_year=2026)`),
    );
    const stageBefore = psql(
      `select stage_key||':'||status from first_run_stage_progress where stage_key='budget'`,
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

    psql(`
      delete from budget_lines where year_id in (select id from budget_years where calendar_year=${TEST_YEAR});
      delete from budget_years where calendar_year=${TEST_YEAR};
    `);

    const matrix = [
      ['Группа', 'Подгруппа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['Содержание и обслуживание', '', 'Уборка', '50'],
      ['Содержание и обслуживание', '', 'Охрана', '0'],
      ['Регулярные услуги', 'Охрана и контроль', 'Видеонаблюдение', '100'],
    ];
    const parsed = parseBudgetPlanMatrix(matrix);
    const validated = validateBudgetPlanAgainstCatalog(parsed, catalog, 'ru', {
      subgroupColumnPresent: true,
    });
    expect(validated.issues).toEqual([]);
    const grouped = buildBudgetPreviewGroups(validated.previewRows);
    expect(grouped.grandTotal).toBe(150);
    expect(grouped.groups.some((g) => g.subgroups.length > 0)).toBe(true);

    const rowsJson = JSON.stringify(
      validated.articles.map((a) => ({
        row: a.row,
        code: a.code,
        name: a.name,
        group: a.group,
        subgroup: a.subgroup,
        amount: a.amount.toFixed(2),
      })),
    ).replace(/'/g, "''");

    const commit = JSON.parse(
      psql(withAuth(`select public.admin_commit_budget_plan(${TEST_YEAR}, '${rowsJson}'::jsonb)::text;`))
        .split('\n')
        .pop()!,
    );
    expect(commit.applied).toBe(true);
    expect(Number(commit.total)).toBe(150);

    const saved = JSON.parse(
      psql(`select coalesce(json_agg(json_build_object(
        'code', c.code, 'amount', l.planned_amount_eur,
        'group', c.group_name_ru, 'subgroup', coalesce(c.subgroup_name_ru,''),
        'name', c.name_ru
      ) order by c.sort_order), '[]'::json)
      from budget_lines l
      join budget_categories c on c.id = l.category_id
      where l.year_id = (select id from budget_years where calendar_year=${TEST_YEAR})`),
    ) as Array<{ code: string; amount: number; group: string; subgroup: string; name: string }>;
    expect(saved).toHaveLength(3);
    expect(saved.find((r) => r.code === 'security')?.amount).toBe(0);
    expect(saved.find((r) => r.code === 'svc_cctv')?.subgroup).toMatch(/Охрана/);

    // Partial reimport must not invent zeros for articles not in the file
    // (blank skip behavior of admin_commit_budget_plan).
    const partialJson = JSON.stringify([
      {
        row: 2,
        code: 'cleaning',
        name: 'Уборка',
        group: 'Содержание и обслуживание',
        subgroup: '',
        amount: '55.00',
      },
    ]).replace(/'/g, "''");
    const partial = JSON.parse(
      psql(withAuth(`select public.admin_commit_budget_plan(${TEST_YEAR}, '${partialJson}'::jsonb)::text;`))
        .split('\n')
        .pop()!,
    );
    expect(partial.applied === true || partial.idempotent === true).toBe(true);
    const afterPartial = JSON.parse(
      psql(`select coalesce(json_object_agg(c.code, l.planned_amount_eur), '{}'::json)
      from budget_lines l
      join budget_categories c on c.id = l.category_id
      where l.year_id = (select id from budget_years where calendar_year=${TEST_YEAR})`),
    ) as Record<string, number>;
    expect(Number(afterPartial.cleaning)).toBe(55);
    expect(Number(afterPartial.security)).toBe(0);
    expect(Number(afterPartial.svc_cctv)).toBe(100);

    // Template still has no tech codes
    const buf = buildBudgetPlanTemplateBuffer(
      'ru',
      catalog.map((cat: {
        group_name_ru?: string;
        subgroup_name_ru?: string;
        name_ru?: string;
        group_code?: string;
        subgroup_code?: string;
        name_en?: string;
        name_bg?: string;
        group_name_en?: string;
        group_name_bg?: string;
        subgroup_name_en?: string;
        subgroup_name_bg?: string;
      }) => ({
        group: budgetGroupLabel(cat as never, 'ru'),
        subgroup: budgetSubgroupLabel(cat as never, 'ru'),
        name: categoryLabel(cat as never, 'ru'),
        amount: '',
      })),
    );
    expect(Buffer.from(buf).byteLength).toBeGreaterThan(1000);

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
    ).toBe(linesUserBefore);
    expect(
      psql(`select stage_key||':'||status from first_run_stage_progress where stage_key='budget'`),
    ).toBe(stageBefore);
    expect(Number(psql(`select count(*) from budget_years where calendar_year=${TEST_YEAR}`))).toBe(0);
  });
});
