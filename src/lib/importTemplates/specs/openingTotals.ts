import type { ImportTemplateSpec } from '@/lib/importTemplates/types';

/**
 * Opening expense totals per budget article.
 * Same keys and header vocabulary as budgetPlanImport (code / name / amount).
 */
export const OPENING_TOTALS_IMPORT_SPEC: ImportTemplateSpec = {
  id: 'opening_totals',
  fileBaseName: {
    ru: 'шаблон-израсходовано-начальные',
    bg: 'shablon-izrazhodvano-nachalni',
    en: 'opening-spent-template',
  },
  dataSheetName: {
    ru: 'Израсходовано',
    bg: 'Изразходвано',
    en: 'Opening',
  },
  legacySheetNames: ['opening'],
  title: {
    ru: 'Начальные расходы по статьям бюджета',
    bg: 'Начални разходи по бюджетни статии',
    en: 'Opening spent amounts by budget article',
  },
  notes: {
    ru: [
      'Заполняйте только лист «Израсходовано». Примеры в этой инструкции не импортируются.',
      'Коды статей берутся из утверждённого бюджета; незнакомый код будет отмечен как ошибка.',
      'Укажите, сколько уже израсходовано по статье на начало учёта. Если сумма больше плана, вы увидите предупреждение.',
    ],
    bg: [
      'Попълвайте само листа «Изразходвано». Примерите в тази инструкция не се импортират.',
      'Кодовете на статиите са от утвърдения бюджет; непознат код се отбелязва като грешка.',
      'Посочете колко вече е изразходвано по статията в началото на отчета. Ако сумата надвишава плана, ще видите предупреждение.',
    ],
    en: [
      'Fill only the Opening sheet. Examples on this Instructions sheet are not imported.',
      'Article codes come from the approved budget; an unknown code is reported as an error.',
      'Enter how much has already been spent on the article at the start of tracking. An amount above plan shows a warning.',
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
        ru: 'Код статьи из бюджета, например 1.1. Обязательно.',
        bg: 'Код на статията от бюджета, напр. 1.1. Задължително.',
        en: 'Article code from the budget, e.g. 1.1. Required.',
      },
      example: '1.1',
    },
    {
      key: 'name',
      required: false,
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
        ru: 'Название статьи — только для удобства, при загрузке берётся из бюджета. Необязательно.',
        bg: 'Наименование на статията — за удобство, при зареждане се взема от бюджета. По желание.',
        en: 'Article name — for convenience only; the budget name is used on import. Optional.',
      },
      example: 'Уборка',
    },
    {
      key: 'amount',
      required: true,
      format: 'money',
      width: 24,
      label: {
        ru: 'Уже израсходовано, EUR',
        bg: 'Вече изразходвано, EUR',
        en: 'Already spent, EUR',
      },
      aliases: [
        'уже израсходовано, eur',
        'already spent, eur',
        'вече изразходвано, eur',
        'план на год, eur',
        'annual plan, eur',
        'план за годината, eur',
        'amount',
        'сумма',
        'сума',
      ],
      instruction: {
        ru: 'Уже израсходованная сумма в EUR (≥ 0). Если расходов не было — 0. Обязательно.',
        bg: 'Вече изразходвана сума в EUR (≥ 0). Ако няма разходи — 0. Задължително.',
        en: 'Amount already spent in EUR (≥ 0). Use 0 if nothing was spent. Required.',
      },
      example: '350.00',
    },
  ],
};
