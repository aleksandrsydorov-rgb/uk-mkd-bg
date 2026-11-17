import type { ImportTemplateSpec } from '@/lib/importTemplates/types';
import {
  OPENING_IDENTITY_COLUMNS,
  OPENING_IDENTITY_FORMAT_NOTE,
} from '@/lib/importTemplates/identityColumns';
import {
  buildLocalizedImportWorkbook,
  toImportTemplateLocale,
} from '@/lib/importTemplates/workbook';

/** Simple first-run support-fee opening template: balance kind + amount only. */
export const SUPPORT_FEE_SIMPLE_IMPORT_SPEC: ImportTemplateSpec = {
  id: 'support_fee_opening_simple',
  fileBaseName: {
    ru: 'шаблон-такса-начальные-остатки',
    bg: 'shablon-taksa-nachalni-ostatatsi',
    en: 'support-fee-opening-balances',
  },
  dataSheetName: {
    ru: 'Начальные остатки',
    bg: 'Начални салда',
    en: 'Opening balances',
  },
  legacySheetNames: ['opening_balances'],
  title: {
    ru: 'Такса поддержки — начальные остатки',
    bg: 'Такса поддръжка — начални остатъци',
    en: 'Support fee — opening balances',
  },
  notes: {
    ru: [
      'Заполняйте только лист «Начальные остатки». Примеры в инструкции не импортируются.',
      OPENING_IDENTITY_FORMAT_NOTE.ru,
      'Одна строка — один апартамент. Укажите вид остатка (Долг / Переплата / Ноль) и сумму.',
      'Если квартира известна, а вид и сумма пустые — остаток можно внести позже в карточке.',
      'Дату перехода и основание задайте один раз в мастере перед импортом (не в этом файле).',
    ],
    bg: [
      'Попълвайте само листа «Начални салда». Примерите в инструкцията не се импортират.',
      OPENING_IDENTITY_FORMAT_NOTE.bg,
      'Един ред — един апартамент. Посочете вида на остатъка (Дълг / Преплата / Нула) и сумата.',
      'Ако апартаментът е известен, а видът и сумата са празни — остатъкът може да се въведе по-късно.',
      'Датата на преминаване и основанието се задават веднъж в съветника преди импорта.',
    ],
    en: [
      'Fill only the Opening balances sheet. Instruction examples are not imported.',
      OPENING_IDENTITY_FORMAT_NOTE.en,
      'One row per apartment. Set balance kind (Debt / Overpayment / Zero) and the amount.',
      'If the apartment is known but kind and amount are empty — enter the balance later on the card.',
      'Set transition date and source once in the wizard before import (not in this file).',
    ],
  },
  columns: [
    ...OPENING_IDENTITY_COLUMNS,
    {
      key: 'opening_balance_kind',
      required: false,
      format: 'text',
      width: 24,
      label: {
        ru: 'Вид начального остатка',
        bg: 'Вид на началния остатък',
        en: 'Opening balance kind',
      },
      aliases: [
        'balance_kind',
        'kind',
        'вид остатка',
        'тип остатка',
        'opening balance kind',
        'opening_balance_type',
      ],
      listValidation: ['debt', 'overpayment', 'zero'],
      listValidationByLocale: {
        ru: ['Долг', 'Переплата', 'Ноль'],
        bg: ['Дълг', 'Преплата', 'Нула'],
        en: ['Debt', 'Overpayment', 'Zero'],
      },
      instruction: {
        ru: 'Долг / Переплата / Ноль. Пусто вместе с пустой суммой — «можно внести позже».',
        bg: 'Дълг / Преплата / Нула. Празно заедно с празна сума — «може по-късно».',
        en: 'Debt / Overpayment / Zero. Empty with empty amount — “can enter later”.',
      },
      example: 'debt',
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
      ],
      instruction: {
        ru: 'Для долга и переплаты — сумма > 0. Для «Ноль» — 0 или пусто.',
        bg: 'За дълг и преплата — сума > 0. За «Нула» — 0 или празно.',
        en: 'For debt/overpayment — amount > 0. For Zero — 0 or empty.',
      },
      example: '707.00',
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
          apartment_number: '8',
          section_code: 'A',
          block_code: '',
          opening_balance_kind: 'debt',
          opening_balance_eur: '707.00',
        },
        {
          apartment_number: '9',
          section_code: 'A',
          block_code: '',
          opening_balance_kind: 'overpayment',
          opening_balance_eur: '50.00',
        },
        {
          apartment_number: '10',
          section_code: 'A',
          block_code: '',
          opening_balance_kind: 'zero',
          opening_balance_eur: '0',
        },
        {
          apartment_number: '12',
          section_code: 'B',
          block_code: '',
          opening_balance_kind: '',
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
          apartment_number: '12',
          section_code: 'A',
          block_code: '1',
          opening_balance_kind: 'debt',
          opening_balance_eur: '120.50',
        },
        {
          apartment_number: '12',
          section_code: 'B',
          block_code: '',
          opening_balance_kind: 'zero',
          opening_balance_eur: '',
        },
      ],
    },
  ],
  templateInputRows: 120,
};

export function buildSupportFeeSimpleTemplateBuffer(
  locale: 'ru' | 'bg' | 'en' | string = 'ru',
): ArrayBuffer {
  return buildLocalizedImportWorkbook(
    SUPPORT_FEE_SIMPLE_IMPORT_SPEC,
    toImportTemplateLocale(locale),
  );
}
