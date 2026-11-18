import type { ImportTemplateSpec } from '@/lib/importTemplates/types';
import {
  buildLocalizedImportWorkbook,
  buildLocalizedImportWorkbookWithRows,
  toImportTemplateLocale,
} from '@/lib/importTemplates/workbook';

/**
 * Keys: code / group / name / amount.
 * Two levels only: Group → Budget article (no subgroups).
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
      'Два уровня: Группа → Статья бюджета. Подгрупп нет.',
      'Код, группа и статья предзаполнены из справочника. Код храните текстом: 1.10 не должен стать 1.1 или датой.',
      'Одна строка — одна статья. Итоги групп и бюджета считает система — отдельные итоговые строки не нужны.',
      'Пустая сумма не обнуляет уже сохранённый план; явный 0 сохраняется. Совпадение кода, группы и статьи обязательно.',
      'Старый файл без колонки «Группа» принимается: группа берётся из справочника по коду.',
      'Год бюджета выбирается в мастере отдельно.',
    ],
    bg: [
      'Попълвайте само листа «Бюджет». Примерите в инструкцията не се импортират.',
      'Две нива: Група → Статия на бюджета. Няма подгрупи.',
      'Кодът, групата и статията са попълнени от справочника. Кодът е текст: 1.10 не става 1.1 или дата.',
      'Един ред — една статия. Итогите на групите и бюджета се смятат от системата.',
      'Празна сума не нулира вече записания план; явна 0 се записва. Код, група и статия трябва да съвпадат.',
      'Стар файл без колона «Група» се приема: групата се взима от справочника по кода.',
      'Годината на бюджета се избира отделно в съветника.',
    ],
    en: [
      'Fill only the Budget sheet. Examples on the Instructions sheet are not imported.',
      'Two levels: Group → Budget article. No subgroups.',
      'Code, group and article are prefilled from the catalog. Keep the code as text: 1.10 must not become 1.1 or a date.',
      'One row is one article. Group and budget totals are calculated by the system — do not import total rows.',
      'A blank amount does not clear a saved plan; an explicit 0 is saved. Code, group and article must match the catalog.',
      'A legacy file without a Group column is accepted: the group is taken from the catalog by code.',
      'The budget year is chosen separately in the wizard.',
    ],
  },
  columns: [
    {
      key: 'code',
      required: true,
      format: 'text',
      width: 14,
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
        ru: 'Код статьи из справочника, например 1.10. Текст, не число Excel. Обязательно.',
        bg: 'Код на статията от справочника, напр. 1.10. Текст, не число от Excel. Задължително.',
        en: 'Article code from the catalog, e.g. 1.10. Text, not an Excel number. Required.',
      },
      example: '1.10',
    },
    {
      key: 'group',
      required: false,
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
        ru: 'Группа статьи из справочника. При старом файле без этой колонки группа определяется по коду.',
        bg: 'Група на статията от справочника. При стар файл без колоната групата се определя по кода.',
        en: 'Article group from the catalog. On a legacy file without this column, the group is resolved from the code.',
      },
      example: 'Содержание и текущие расходы',
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
        ru: 'Название статьи из справочника. Должно совпадать с кодом. Обязательно.',
        bg: 'Име на статията от справочника. Трябва да съвпада с кода. Задължително.',
        en: 'Article name from the catalog. Must match the code. Required.',
      },
      example: 'Резерв группы 1',
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
        ru: 'План в EUR. 0 — сохранить ноль; пусто — не менять уже сохранённую сумму. Итоги не вводите.',
        bg: 'План в EUR. 0 — записва нула; празно — не пипа вече записаната сума. Не въвеждайте итози.',
        en: 'Plan in EUR. 0 saves zero; blank leaves an existing amount unchanged. Do not enter totals.',
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
          code: '1.10',
          group: 'Содержание и текущие расходы',
          name: 'Резерв группы 1',
          amount: '50',
        },
        {
          code: 'cleaning',
          group: 'Содержание и обслуживание',
          name: 'Уборка',
          amount: '0',
        },
        {
          code: 'security',
          group: 'Содержание и обслуживание',
          name: 'Охрана',
          amount: '',
        },
      ],
    },
  ],
  templateInputRows: 80,
};

export type BudgetCatalogSeed = {
  code: string;
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
    code: String(r.code ?? ''),
    group: String(r.group ?? ''),
    name: String(r.name ?? ''),
    amount: r.amount != null ? String(r.amount) : '',
  }));
  return buildLocalizedImportWorkbookWithRows(BUDGET_PLAN_IMPORT_SPEC, loc, rows, {
    extraBlankRows: 20,
  });
}
