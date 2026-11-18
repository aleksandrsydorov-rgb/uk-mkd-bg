import { describe, expect, it } from 'vitest';
import {
  buildBudgetPreviewGroups,
  enrichBudgetPreviewWithExisting,
  parseBudgetPlanMatrix,
  validateBudgetPlanAgainstCatalog,
} from '@/lib/budgetPlanImport';

const CATALOG = [
  {
    code: 'cleaning',
    name_ru: 'Уборка',
    name_en: 'Cleaning',
    name_bg: 'Почистване',
    group_code: 'ops',
    group_name_ru: 'Содержание и обслуживание',
    group_name_en: 'Maintenance',
    group_name_bg: 'Поддръжка',
  },
  {
    code: 'security',
    name_ru: 'Охрана',
    name_en: 'Security',
    name_bg: 'Охрана',
    group_code: 'ops',
    group_name_ru: 'Содержание и обслуживание',
    group_name_en: 'Maintenance',
    group_name_bg: 'Поддръжка',
  },
  {
    code: 'svc_cctv',
    name_ru: 'Видеонаблюдение',
    name_en: 'CCTV',
    name_bg: 'Видеонаблюдение',
    group_code: 'svc',
    group_name_ru: 'Регулярные услуги',
    group_name_en: 'Services',
    group_name_bg: 'Услуги',
    subgroup_code: 'sg_sec',
    subgroup_name_ru: 'Охрана и контроль',
    subgroup_name_en: 'Security control',
    subgroup_name_bg: 'Охрана и контрол',
  },
  {
    code: 'svc_hall',
    name_ru: 'Уборка холлов',
    name_en: 'Hall cleaning',
    name_bg: 'Почистване на холове',
    group_code: 'svc',
    group_name_ru: 'Регулярные услуги',
    group_name_en: 'Services',
    group_name_bg: 'Услуги',
    subgroup_code: 'sg_clean',
    subgroup_name_ru: 'Клининг',
    subgroup_name_en: 'Cleaning',
    subgroup_name_bg: 'Клининг',
  },
];

describe('budget hierarchy display data', () => {
  it('groups multi-group / multi-subgroup / direct articles without inventing subgroups', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Группа', 'Подгруппа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['Содержание и обслуживание', '', 'Уборка', '50'],
      ['Содержание и обслуживание', '', 'Охрана', '0'],
      ['Регулярные услуги', 'Охрана и контроль', 'Видеонаблюдение', '100'],
      ['Регулярные услуги', 'Клининг', 'Уборка холлов', '25'],
      ['Своя группа А', 'Под А', 'Статья длинное название для переноса', '10'],
      ['Своя группа Б', '', 'Прямо в группе', '5'],
    ]);
    const validated = validateBudgetPlanAgainstCatalog(parsed, CATALOG, 'ru', {
      subgroupColumnPresent: true,
    });
    expect(validated.issues).toEqual([]);
    const enriched = enrichBudgetPreviewWithExisting(
      validated,
      new Map([['security', 20]]),
    );
    const grouped = buildBudgetPreviewGroups(enriched.previewRows);
    expect(grouped.groups.map((g) => g.label)).toEqual([
      'Содержание и обслуживание',
      'Регулярные услуги',
      'Своя группа А',
      'Своя группа Б',
    ]);
    const ops = grouped.groups[0]!;
    expect(ops.directRows.map((r) => r.name)).toEqual(['Уборка', 'Охрана']);
    expect(ops.subgroups).toHaveLength(0);
    const svc = grouped.groups[1]!;
    expect(svc.directRows).toHaveLength(0);
    expect(svc.subgroups.map((s) => s.label)).toEqual(['Охрана и контроль', 'Клининг']);
    expect(grouped.groups[3]!.directRows[0]?.name).toBe('Прямо в группе');
    expect(grouped.grandTotal).toBe(50 + 0 + 100 + 25 + 10 + 5);
  });

  it('blank amount keeps prior for display total semantics in enrich', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Группа', 'Подгруппа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['Содержание и обслуживание', '', 'Уборка', ''],
      ['Содержание и обслуживание', '', 'Охрана', '0'],
    ]);
    const validated = validateBudgetPlanAgainstCatalog(parsed, CATALOG, 'ru', {
      subgroupColumnPresent: true,
    });
    const enriched = enrichBudgetPreviewWithExisting(
      validated,
      new Map([
        ['cleaning', 40],
        ['security', 7],
      ]),
    );
    const cleaning = enriched.previewRows.find((r) => r.code === 'cleaning')!;
    expect(cleaning.amountBlank).toBe(true);
    expect(cleaning.priorAmount).toBe(40);
    expect(cleaning.action).toBe('unchanged');
    const security = enriched.previewRows.find((r) => r.code === 'security')!;
    expect(security.amount).toBe(0);
  });

  it('keeps blocking amount errors on the preview row', () => {
    const parsed = parseBudgetPlanMatrix([
      ['Группа', 'Подгруппа', 'Статья бюджета', 'Плановая сумма, EUR'],
      ['Содержание и обслуживание', '', 'Уборка', '-3'],
      ['Чужая', '', 'Новая', 'abc'],
    ]);
    const validated = validateBudgetPlanAgainstCatalog(parsed, CATALOG, 'ru', {
      subgroupColumnPresent: true,
    });
    expect(validated.previewRows[0]?.issues).toContain('negative_amount');
    expect(validated.previewRows[1]?.issues).toContain('invalid_amount');
    expect(validated.previewRows[1]?.willCreate).toBe(true);
    expect(validated.articles).toHaveLength(0);
  });
});
