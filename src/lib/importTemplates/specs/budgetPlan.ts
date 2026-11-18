import type { ImportTemplateSpec } from '@/lib/importTemplates/types';
import {
  buildLocalizedImportWorkbook,
  buildLocalizedImportWorkbookWithRows,
  toImportTemplateLocale,
} from '@/lib/importTemplates/workbook';

/**
 * User template: Group | Subgroup | Budget article | Planned amount.
 * Internal codes stay parseable for legacy files (includeInTemplate: false).
 */
export const BUDGET_PLAN_IMPORT_SPEC: ImportTemplateSpec = {
  id: 'budget_plan',
  fileBaseName: {
    ru: 'шаблон-бюджет-плана',
    bg: 'shablon-byudzhet-plan',
    en: 'budget-plan-template',
  },
  dataSheetName: {
    ru: 'Бюджет',
    bg: 'Бюджет',
    en: 'Budget',
  },
  legacySheetNames: ['budget'],
  title: {
    ru: 'Годовой бюджет — план по статьям',
    bg: 'Годишен бюджет — план по статии',
    en: 'Annual budget — plan by article',
  },
  notes: {
    ru: [
      'Заполняйте только лист «Бюджет». Примеры на листе инструкции не импортируются.',
      'Классификация уже предзаполнена из справочника: Группа → Подгруппа → Статья бюджета.',
      'Внесите только «Плановая сумма, EUR». Подгруппа может быть пустой — тогда статья относится прямо к группе.',
      '0 — сохранить ноль. Пустая ячейка — не менять уже сохранённую сумму по этой статье.',
      'Итоги подгрупп, групп и всего бюджета считает система — итоговые строки не нужны.',
      'Год бюджета выбирается в мастере отдельно.',
    ],
    bg: [
      'Попълвайте само листа «Бюджет». Примерите в инструкцията не се импортират.',
      'Класификацията е предварително попълнена от справочника: Група → Подгрупа → Статия на бюджета.',
      'Въведете само «Планова сума, EUR». Подгрупата може да е празна — тогава статията е директно в групата.',
      '0 — записва нула. Празна клетка — не променя вече записаната сума за тази статия.',
      'Итогите на подгрупите, групите и на целия бюджет се смятат от системата — не са нужни редове с итог.',
      'Годината на бюджета се избира отделно в съветника.',
    ],
    en: [
      'Fill only the Budget sheet. Examples on the Instructions sheet are not imported.',
      'Classification is prefilled from the catalog: Group → Subgroup → Budget article.',
      'Enter only Planned amount, EUR. An empty Subgroup means the article sits directly under the group.',
      '0 saves zero. A blank cell leaves the saved amount for that article unchanged.',
      'Subgroup, group and budget totals are calculated by the system — do not add total rows.',
      'The budget year is chosen separately in the wizard.',
    ],
  },
  columns: [
    {
      key: 'code',
      required: false,
      format: 'text',
      width: 14,
      includeInTemplate: false,
      label: {
        ru: 'Код статьи',
        bg: 'Код на статията',
        en: 'Article code',
      },
      aliases: [
        'код статьи',
        'category code',
        'код на статията',
        'article code',
        'code',
        'код',
      ],
      instruction: {
        ru: 'Служебная колонка. В пользовательском шаблоне не используется.',
        bg: 'Служебна колона. В потребителския шаблон не се използва.',
        en: 'Internal column. Not used in the user template.',
      },
      example: '',
    },
    {
      key: 'group',
      required: true,
      format: 'text',
      width: 28,
      label: {
        ru: 'Группа',
        bg: 'Група',
        en: 'Group',
      },
      aliases: [
        'группа',
        'група',
        'group',
        'group_name',
        'group name',
        'наименование группы',
        'име на групата',
      ],
      instruction: {
        ru: 'Группа из справочника. Предзаполнена — не меняйте без необходимости.',
        bg: 'Група от справочника. Предварително попълнена — не я променяйте без нужда.',
        en: 'Group from the catalog. Prefill — change only if needed.',
      },
      example: 'Содержание и обслуживание',
    },
    {
      key: 'subgroup',
      required: false,
      format: 'text',
      width: 28,
      label: {
        ru: 'Подгруппа',
        bg: 'Подгрупа',
        en: 'Subgroup',
      },
      aliases: [
        'подгруппа',
        'подгрупа',
        'subgroup',
        'subgroup_name',
        'subgroup name',
        'наименование подгруппы',
        'име на подгрупата',
      ],
      instruction: {
        ru: 'Подгруппа из справочника. Может быть пустой — статья тогда относится прямо к группе.',
        bg: 'Подгрупа от справочника. Може да е празна — тогава статията е директно в групата.',
        en: 'Subgroup from the catalog. May be blank — then the article sits directly under the group.',
      },
      example: '',
    },
    {
      key: 'name',
      required: true,
      format: 'text',
      width: 32,
      label: {
        ru: 'Статья бюджета',
        bg: 'Статия на бюджета',
        en: 'Budget article',
      },
      aliases: [
        'статья бюджета',
        'статия на бюджета',
        'название статьи',
        'category name',
        'budget article',
        'наименование',
        'name',
        'наименование на статията',
        'име на статията',
        'название',
      ],
      instruction: {
        ru: 'Название статьи из справочника. Предзаполнено.',
        bg: 'Име на статията от справочника. Предварително попълнено.',
        en: 'Article name from the catalog. Prefill.',
      },
      example: 'Уборка',
    },
    {
      key: 'amount',
      required: false,
      format: 'money',
      width: 20,
      label: {
        ru: 'Плановая сумма, EUR',
        bg: 'Планова сума, EUR',
        en: 'Planned amount, EUR',
      },
      aliases: [
        'плановая сумма, eur',
        'планова сума, eur',
        'planned amount, eur',
        'план на год, eur',
        'annual plan, eur',
        'план за годината, eur',
        'amount',
        'сумма',
        'сума',
      ],
      instruction: {
        ru: 'План в EUR. 0 — ноль; пусто — не менять сохранённую сумму.',
        bg: 'План в EUR. 0 — нула; празно — не пипа записаната сума.',
        en: 'Plan in EUR. 0 is zero; blank leaves the saved amount unchanged.',
      },
      example: '1000.00',
    },
  ],
  instructionScenarios: [
    {
      title: {
        ru: 'Примеры (не импортируются)',
        bg: 'Примери (не се импортират)',
        en: 'Examples (not imported)',
      },
      rows: [
        {
          group: 'Содержание и обслуживание',
          subgroup: '',
          name: 'Уборка',
          amount: '0',
        },
        {
          group: 'Регулярные услуги',
          subgroup: 'Охрана и контроль',
          name: 'Видеонаблюдение',
          amount: '1200.00',
        },
        {
          group: 'Регулярные услуги',
          subgroup: 'Клининг',
          name: 'Уборка холлов',
          amount: '',
        },
      ],
    },
  ],
  templateInputRows: 80,
};

export type BudgetCatalogSeed = {
  /** Internal stable code — omitted from the downloaded template. */
  code?: string;
  name: string;
  group: string;
  /** Empty string = article directly under the group. */
  subgroup?: string;
  amount?: string;
};

export function buildBudgetPlanTemplateBuffer(
  locale: 'ru' | 'bg' | 'en' | string = 'ru',
  catalogRows?: BudgetCatalogSeed[],
): ArrayBuffer {
  const loc = toImportTemplateLocale(locale);
  if (!catalogRows?.length) {
    return buildLocalizedImportWorkbook(BUDGET_PLAN_IMPORT_SPEC, loc);
  }
  const rows = catalogRows.map((r) => ({
    group: String(r.group ?? ''),
    subgroup: String(r.subgroup ?? ''),
    name: String(r.name ?? ''),
    amount: r.amount != null ? String(r.amount) : '',
  }));
  return buildLocalizedImportWorkbookWithRows(BUDGET_PLAN_IMPORT_SPEC, loc, rows, {
    extraBlankRows: 20,
  });
}
