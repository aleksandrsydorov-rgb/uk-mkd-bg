import type { ImportTemplateSpec } from '@/lib/importTemplates/types';
import {
  OPENING_IDENTITY_COLUMNS,
  OPENING_IDENTITY_FORMAT_NOTE,
} from '@/lib/importTemplates/identityColumns';
import {
  buildLocalizedImportWorkbook,
  toImportTemplateLocale,
} from '@/lib/importTemplates/workbook';

/**
 * Simple first-run capital-repair opening template.
 * Balance kind is encoded in the sign of «Сумма, EUR» (no separate kind column).
 */
export const CAPITAL_REPAIR_SIMPLE_IMPORT_SPEC: ImportTemplateSpec = {
  id: 'capital_repair_opening_simple',
  fileBaseName: {
    ru: 'шаблон-капремонт-начальные',
    bg: 'shablon-kapitalen-remont-nachalni',
    en: 'capital-repair-opening-template',
  },
  dataSheetName: {
    ru: 'Начальные остатки',
    bg: 'Начални салда',
    en: 'Opening balances',
  },
  legacySheetNames: ['opening_balances'],
  title: {
    ru: 'Капитальный ремонт — начальные остатки',
    bg: 'Капитален ремонт — начални остатъци',
    en: 'Capital repair — opening balances',
  },
  notes: {
    ru: [
      'Заполняйте только лист «Начальные остатки». Примеры в инструкции не импортируются.',
      OPENING_IDENTITY_FORMAT_NOTE.ru,
      'Одна строка — один апартамент и один год начисления. Вид остатка задаётся знаком суммы.',
      '70,70 → долг 70,70 €. −50,00 → переплата 50,00 €. 0 → подтверждённый нулевой остаток.',
      'Если квартира указана, а сумма пустая — остаток можно внести позже. Одиночный дефис «-» — ошибка.',
      'Дату перехода и документ-основание укажите один раз в мастере перед загрузкой (не в этом файле).',
    ],
    bg: [
      'Попълвайте само листа «Начални салда». Примерите в инструкцията не се импортират.',
      OPENING_IDENTITY_FORMAT_NOTE.bg,
      'Един ред — един апартамент и една година на начисляване. Видът на остатъка се определя от знака на сумата.',
      '70,70 → дълг 70,70 €. −50,00 → преплата 50,00 €. 0 → потвърден нулев остатък.',
      'Ако апартаментът е посочен, а сумата е празна — остатъкът може да се въведе по-късно. Самостоятелен дефис «-» е грешка.',
      'Датата на преминаване и документът-основание се задават веднъж в съветника преди качването.',
    ],
    en: [
      'Fill only the Opening balances sheet. Instruction examples are not imported.',
      OPENING_IDENTITY_FORMAT_NOTE.en,
      'One row per apartment and billing year. Balance kind is taken from the amount sign.',
      '70.70 → debt 70.70 €. −50.00 → overpayment 50.00 €. 0 → confirmed zero balance.',
      'If the apartment is filled but the amount is empty — enter the balance later. A lone hyphen “-” is an error.',
      'Set transition date and source document once in the wizard before upload (not in this file).',
    ],
  },
  columns: [
    ...OPENING_IDENTITY_COLUMNS,
    {
      key: 'billing_year',
      required: true,
      format: 'number',
      width: 16,
      label: {
        ru: 'Год начисления',
        bg: 'Година на начисляване',
        en: 'Billing year',
      },
      aliases: ['year', 'год', 'година'],
      instruction: {
        ru: 'Год, за который учитывается остаток (четыре цифры). Обязательно.',
        bg: 'Година, за която се отчита остатъкът (четири цифри). Задължително.',
        en: 'Year the balance applies to (four digits). Required.',
      },
      example: '2026',
    },
    {
      key: 'opening_balance_eur',
      required: false,
      format: 'money',
      width: 18,
      label: {
        ru: 'Сумма, EUR',
        bg: 'Сума, EUR',
        en: 'Amount, EUR',
      },
      aliases: [
        'amount',
        'opening_balance',
        'сумма',
        'сума',
        'сумма (eur)',
        'amount eur',
        'остаток',
        'остатък',
      ],
      instruction: {
        ru: 'Знак суммы: плюс или без знака — долг; минус — переплата; 0 — ноль. Пусто — внести позже. Принимаются числа Excel и текст с запятой или точкой.',
        bg: 'Знак на сумата: плюс или без знак — дълг; минус — преплата; 0 — нула. Празно — по-късно. Приемат се числа от Excel и текст със запетая или точка.',
        en: 'Amount sign: plus or unsigned — debt; minus — overpayment; 0 — zero. Empty — enter later. Excel numbers and comma/dot text are accepted.',
      },
      example: '70.70',
    },
  ],
  instructionScenarios: [
    {
      title: {
        ru: 'Три варианта суммы (не импортируются)',
        bg: 'Три варианта на сумата (не се импортират)',
        en: 'Three amount variants (not imported)',
      },
      rows: [
        {
          apartment_number: '2',
          section_code: 'A',
          block_code: '',
          billing_year: '2026',
          opening_balance_eur: '70,70',
        },
        {
          apartment_number: '8',
          section_code: 'A',
          block_code: '',
          billing_year: '2026',
          opening_balance_eur: '-50,00',
        },
        {
          apartment_number: '10',
          section_code: 'A',
          block_code: '',
          billing_year: '2026',
          opening_balance_eur: '0',
        },
        {
          apartment_number: '12',
          section_code: 'B',
          block_code: '',
          billing_year: '2026',
          opening_balance_eur: '',
        },
      ],
    },
    {
      title: {
        ru: 'Когда указывать секцию и блок',
        bg: 'Кога да посочите секция и блок',
        en: 'When to fill section and block',
      },
      rows: [
        {
          apartment_number: '33',
          section_code: 'A',
          block_code: '',
          billing_year: '2026',
          opening_balance_eur: '109,08',
        },
        {
          apartment_number: '33',
          section_code: 'В',
          block_code: '',
          billing_year: '2026',
          opening_balance_eur: '109,08',
        },
      ],
    },
  ],
  templateInputRows: 120,
};

export function buildCapitalRepairSimpleTemplateBuffer(
  locale: 'ru' | 'bg' | 'en' | string = 'ru',
): ArrayBuffer {
  return buildLocalizedImportWorkbook(
    CAPITAL_REPAIR_SIMPLE_IMPORT_SPEC,
    toImportTemplateLocale(locale),
  );
}
