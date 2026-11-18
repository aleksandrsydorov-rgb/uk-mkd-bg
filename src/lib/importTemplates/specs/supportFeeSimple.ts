import type { ImportTemplateSpec } from '@/lib/importTemplates/types';
import {
  AMOUNT_DUE_COLUMN_ALIASES,
  AMOUNT_DUE_COLUMN_INSTRUCTION,
  AMOUNT_DUE_COLUMN_LABEL,
  AMOUNT_DUE_COLUMN_NOTES,
} from '@/lib/importTemplates/amountDueColumn';
import {
  OPENING_IDENTITY_COLUMNS,
  OPENING_IDENTITY_FORMAT_NOTE,
} from '@/lib/importTemplates/identityColumns';
import {
  buildLocalizedImportWorkbook,
  buildLocalizedImportWorkbookWithRows,
  toImportTemplateLocale,
} from '@/lib/importTemplates/workbook';
import { sortPropertyBookOwnerIdentitySeeds } from '@/lib/propertyBookAdmin';

/**
 * Simple first-run support-fee opening template (4 columns).
 * Balance kind is encoded in the sign of «Сумма к оплате, EUR».
 * Billing year / transition / source are not in the file — resolved by the wizard.
 */
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
      'Заполняйте только лист «Начальные остатки». Примеры на листе инструкции не импортируются.',
      OPENING_IDENTITY_FORMAT_NOTE.ru,
      'Первые три колонки уже заполнены из Книги собственности. Сохраняйте их без изменений.',
      AMOUNT_DUE_COLUMN_NOTES.ru,
      'Год начисления определяется автоматически по году активации комплекса. Пустое значение не становится нулём. Повторный импорт с пустыми суммами не стирает уже сохранённые остатки.',
    ],
    bg: [
      'Попълвайте само листа «Начални салда». Примерите в инструкцията не се импортират.',
      OPENING_IDENTITY_FORMAT_NOTE.bg,
      'Първите три колони са попълнени от Книгата на собствеността. Не ги променяйте.',
      AMOUNT_DUE_COLUMN_NOTES.bg,
      'Годината на начисляване се определя автоматично по годината на активиране на комплекса. Празно не става нула. Повторен импорт с празни суми не изтрива вече записаните остатъци.',
    ],
    en: [
      'Fill only the Opening balances sheet. Examples on the Instructions sheet are not imported.',
      OPENING_IDENTITY_FORMAT_NOTE.en,
      'The first three columns are prefilled from the Property Book. Keep them unchanged.',
      AMOUNT_DUE_COLUMN_NOTES.en,
      'The billing year is taken automatically from the complex activation year. Empty is not turned into zero. Re-import with blank amounts does not wipe saved balances.',
    ],
  },
  columns: [
    ...OPENING_IDENTITY_COLUMNS,
    {
      key: 'opening_balance_eur',
      required: false,
      format: 'money',
      width: 28,
      label: { ...AMOUNT_DUE_COLUMN_LABEL },
      aliases: [...AMOUNT_DUE_COLUMN_ALIASES],
      instruction: { ...AMOUNT_DUE_COLUMN_INSTRUCTION },
      example: '50.00',
    },
  ],
  instructionScenarios: [
    {
      title: {
        ru: 'Примеры сумм (не импортируются)',
        bg: 'Примери за суми (не се импортират)',
        en: 'Amount examples (not imported)',
      },
      rows: [
        {
          apartment_number: '8',
          section_code: 'A',
          block_code: '',
          opening_balance_eur: '50',
        },
        {
          apartment_number: '9',
          section_code: 'A',
          block_code: '',
          opening_balance_eur: '-50',
        },
        {
          apartment_number: '10',
          section_code: 'Б',
          block_code: '',
          opening_balance_eur: '0',
        },
        {
          apartment_number: '12',
          section_code: 'Б',
          block_code: '',
          opening_balance_eur: '',
        },
      ],
    },
  ],
  templateInputRows: 120,
};

export type SupportFeeIdentitySeed = {
  apartment_number: string;
  section_code?: string | null;
  block_code?: string | null;
};

export function buildSupportFeeSimpleTemplateBuffer(
  locale: 'ru' | 'bg' | 'en' | string = 'ru',
  identityRows?: SupportFeeIdentitySeed[],
): ArrayBuffer {
  const loc = toImportTemplateLocale(locale);
  if (!identityRows?.length) {
    return buildLocalizedImportWorkbook(SUPPORT_FEE_SIMPLE_IMPORT_SPEC, loc);
  }
  const sorted = sortPropertyBookOwnerIdentitySeeds(identityRows);
  const rows = sorted.map((r) => ({
    apartment_number: String(r.apartment_number ?? ''),
    section_code: r.section_code != null ? String(r.section_code) : '',
    block_code: r.block_code != null ? String(r.block_code) : '',
  }));
  return buildLocalizedImportWorkbookWithRows(SUPPORT_FEE_SIMPLE_IMPORT_SPEC, loc, rows, {
    extraBlankRows: 40,
  });
}
