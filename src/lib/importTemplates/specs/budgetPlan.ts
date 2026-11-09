import type { ImportTemplateSpec } from '@/lib/importTemplates/types';

/**
 * Keys match budgetPlanImport (code / name / amount).
 * Aliases include every header accepted by CODE_HEADERS / NAME_HEADERS / AMOUNT_HEADERS there.
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
      'Заполняйте только лист «Бюджет». Примеры в этой инструкции не импортируются.',
      'Код статьи хранится как текст: 1.1 и 01 не преобразуются. Строки разделов и итогов статьями не становятся.',
      'Суммы читаются из значения ячейки, а не из её формата в Excel.',
      'Год бюджета выбирается в мастере отдельно. Загрузка не утверждает план собранием.',
    ],
    bg: [
      'Попълвайте само листа «Бюджет». Примерите в тази инструкция не се импортират.',
      'Кодът на статията е текст: 1.1 и 01 не се преобразуват. Редовете за раздели и общи суми не стават статии.',
      'Сумите се четат от стойността на клетката, а не от формата ѝ в Excel.',
      'Годината на бюджета се избира отделно в съветника. Зареждането не утвърждава плана със събрание.',
    ],
    en: [
      'Fill only the Budget sheet. Examples on this Instructions sheet are not imported.',
      'The article code is stored as text: 1.1 and 01 are not converted. Section and total rows do not become articles.',
      'Amounts are read from the cell value, not from its Excel number format.',
      'The budget year is chosen separately in the wizard. Uploading does not approve the plan at a meeting.',
    ],
  },
  columns: [
    {
      key: 'code',
      required: true,
      format: 'text',
      width: 18,
      label: {
        ru: 'Код статьи',
        bg: 'Код на статията',
        en: 'Category code',
      },
      aliases: [
        'код статьи',
        'category code',
        'код на статията',
        'code',
        'код',
      ],
      instruction: {
        ru: 'Код статьи бюджета, например 1.1. Уникален в файле. Обязательно.',
        bg: 'Код на бюджетната статия, напр. 1.1. Уникален във файла. Задължително.',
        en: 'Budget article code, e.g. 1.1. Unique in the file. Required.',
      },
      example: '1.1',
    },
    {
      key: 'name',
      required: true,
      format: 'text',
      width: 36,
      label: {
        ru: 'Название статьи',
        bg: 'Наименование на статията',
        en: 'Category name',
      },
      aliases: [
        'название статьи',
        'category name',
        'наименование',
        'name',
        'наименование на статията',
        'име на статията',
        'название',
      ],
      instruction: {
        ru: 'Название статьи бюджета. Обязательно.',
        bg: 'Наименование на бюджетната статия. Задължително.',
        en: 'Budget article name. Required.',
      },
      example: 'Уборка',
    },
    {
      key: 'amount',
      required: true,
      format: 'money',
      width: 18,
      label: {
        ru: 'План на год, EUR',
        bg: 'План за годината, EUR',
        en: 'Annual plan, EUR',
      },
      aliases: [
        'план на год, eur',
        'annual plan, eur',
        'план за годината, eur',
        'уже израсходовано, eur',
        'already spent, eur',
        'вече изразходвано, eur',
        'amount',
        'сумма',
        'сума',
      ],
      instruction: {
        ru: 'Плановая сумма на год в EUR (≥ 0). Число, не текст. Обязательно.',
        bg: 'Планова сума за годината в EUR (≥ 0). Число, не текст. Задължително.',
        en: 'Planned amount for the year in EUR (≥ 0). A number, not text. Required.',
      },
      example: '2400.00',
    },
  ],
};
