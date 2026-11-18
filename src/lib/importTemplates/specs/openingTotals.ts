import type { ImportTemplateSpec } from '@/lib/importTemplates/types';

/**
 * Opening expense totals per budget article.
 * Template: article name + already spent (no groups/codes).
 * Legacy files with a category code column are still accepted by the custom parser.
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
      'Статьи бюджета уже заполнены. Внесите только фактические суммы.',
      '0 — расходов по статье не было. Пустая ячейка — не менять ранее сохранённый факт.',
      'Перед подтверждением проверьте предпросмотр: план, факт и разницу.',
    ],
    bg: [
      'Бюджетните статии са попълнени. Въведете само фактическите суми.',
      '0 — няма разходи по статията. Празна клетка — не променяйте вече записания факт.',
      'Преди потвърждение проверете прегледа: план, факт и разлика.',
    ],
    en: [
      'Budget articles are prefilled. Enter only the actual amounts spent.',
      '0 means no spend on that article. A blank cell leaves any previously saved fact unchanged.',
      'Before confirming, review the preview: plan, fact, and difference.',
    ],
  },
  columns: [
    {
      key: 'name',
      required: true,
      format: 'text',
      width: 48,
      label: {
        ru: 'Статья бюджета',
        bg: 'Бюджетна статия',
        en: 'Budget article',
      },
      aliases: [
        'статья бюджета',
        'название статьи',
        'category name',
        'budget article',
        'наименование',
        'name',
        'наименование на статията',
        'име на статията',
        'статия на бюджета',
        'название',
      ],
      instruction: {
        ru: 'Название статьи из сохранённого бюджета (уже заполнено). Не меняйте, если нет уточнения в скобках для одноимённых статей.',
        bg: 'Име на статията от записания бюджет (вече попълнено). Не го променяйте, освен ако има уточнение в скоби за едноименни статии.',
        en: 'Article name from the saved budget (prefilled). Do not change it unless a parenthetical note disambiguates same-named articles.',
      },
      example: 'Уборка',
    },
    {
      key: 'amount',
      required: false,
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
        ru: 'Фактическая сумма в EUR. 0 — расходов не было. Пусто — не менять сохранённый факт. Допустимы точка и запятая.',
        bg: 'Фактическа сума в EUR. 0 — няма разходи. Празно — не променяйте записания факт. Точка и запетая са допустими.',
        en: 'Actual amount in EUR. 0 means no spend. Blank leaves the saved fact unchanged. Dot or comma decimals are accepted.',
      },
      example: '350.00',
      requiredLabel: {
        ru: 'По желанию',
        bg: 'По желание',
        en: 'Optional',
      },
    },
  ],
};
