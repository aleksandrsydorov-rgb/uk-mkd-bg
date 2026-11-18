import type { ImportTemplateSpec } from '@/lib/importTemplates/types';
import {
  buildLocalizedImportWorkbook,
  buildLocalizedImportWorkbookWithRows,
  toImportTemplateLocale,
} from '@/lib/importTemplates/workbook';

/**
 * User template: Group | Budget article | Planned amount.
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
      'Внесите плановые суммы по предзаполненным группам и статьям из справочника.',
      '0 — сохранить ноль. Пустая ячейка — не менять уже сохранённую сумму по этой статье.',
      'Итоги групп и всего бюджета считает система — итоговые строки не нужны.',
      'Год бюджета выбирается в мастере отдельно.',
    ],
    bg: [
      'Попълвайте само листа «Бюджет». Примерите в инструкцията не се импортират.',
      'Въведете плановите суми по предварително попълнените групи и статии от справочника.',
      '0 — записва нула. Празна клетка — не променя вече записаната сума за тази статия.',
      'Итогите на групите и на целия бюджет се смятат от системата — не са нужни редове с итог.',
      'Годината на бюджета се избира отделно в съветника.',
    ],
    en: [
      'Fill only the Budget sheet. Examples on the Instructions sheet are not imported.',
      'Enter planned amounts for the prefilled groups and articles from the catalog.',
      '0 saves zero. A blank cell leaves the saved amount for that article unchanged.',
      'Group and budget totals are calculated by the system — do not add total rows.',
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
        ru: 'Устаревшая колонка. В новом шаблоне не используется.',
        bg: 'Остаряла колона. В новия шаблон не се използва.',
        en: 'Legacy column. Not used in the current template.',
      },
      example: '',
    },
    {
      key: 'group',
      required: true,
      format: 'text',
      width: 32,
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
      key: 'name',
      required: true,
      format: 'text',
      width: 36,
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
          name: 'Уборка',
          amount: '0',
        },
        {
          group: 'Содержание и обслуживание',
          name: 'Охрана',
          amount: '1200.00',
        },
        {
          group: 'Содержание и обслуживание',
          name: 'Ремонт',
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
    name: String(r.name ?? ''),
    amount: r.amount != null ? String(r.amount) : '',
  }));
  return buildLocalizedImportWorkbookWithRows(BUDGET_PLAN_IMPORT_SPEC, loc, rows, {
    extraBlankRows: 20,
  });
}
