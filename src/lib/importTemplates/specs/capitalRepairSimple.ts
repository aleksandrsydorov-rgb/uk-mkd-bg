import type { ImportTemplateSpec } from '@/lib/importTemplates/types';
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
 * Simple first-run capital-repair opening template (4 columns).
 * Balance kind is encoded in the sign of «Сумма начального остатка, EUR».
 * Billing year / transition / source are not in the file — resolved by the wizard.
 */
export const CAPITAL_REPAIR_SIMPLE_IMPORT_SPEC: ImportTemplateSpec = {
  id: 'capital_repair_opening_simple',
  fileBaseName: {
    ru: 'шаблон-капремонт-начальные-остатки',
    bg: 'shablon-kapitalen-remont-nachalni-ostatatsi',
    en: 'capital-repair-opening-balances',
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
      'Заполняйте только лист «Начальные остатки». Примеры на листе инструкции не импортируются.',
      OPENING_IDENTITY_FORMAT_NOTE.ru,
      'Первые три колонки уже заполнены из Книги собственности. Сохраняйте их без изменений.',
      'Сумма начального остатка задаёт вид знаком: 50 или +50 — долг; −50 — переплата; 0 — подтверждённый ноль; пусто — остаток пока неизвестен (можно внести позже в карточке). Одиночный дефис «-» — ошибка.',
      'Год начисления определяется автоматически по году активации комплекса. Пустое значение не становится нулём. Повторный импорт с пустыми суммами не стирает уже сохранённые остатки.',
    ],
    bg: [
      'Попълвайте само листа «Начални салда». Примерите в инструкцията не се импортират.',
      OPENING_IDENTITY_FORMAT_NOTE.bg,
      'Първите три колони са попълнени от Книгата на собствеността. Не ги променяйте.',
      'Сумата на началния остатък определя вида със знака: 50 или +50 — дълг; −50 — преплата; 0 — потвърдена нула; празно — остатъкът още не е известен (може по-късно в картата). Самостоятелен дефис «-» е грешка.',
      'Годината на начисляване се определя автоматично по годината на активиране на комплекса. Празно не става нула. Повторен импорт с празни суми не изтрива вече записаните остатъци.',
    ],
    en: [
      'Fill only the Opening balances sheet. Examples on the Instructions sheet are not imported.',
      OPENING_IDENTITY_FORMAT_NOTE.en,
      'The first three columns are prefilled from the Property Book. Keep them unchanged.',
      'The opening balance amount encodes the kind by sign: 50 or +50 — debt; −50 — overpayment; 0 — confirmed zero; blank — balance still unknown (enter later on the card). A lone hyphen “-” is an error.',
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
      label: {
        ru: 'Сумма начального остатка, EUR',
        bg: 'Сума начален остатък, EUR',
        en: 'Opening balance amount, EUR',
      },
      aliases: [
        'opening_balance',
        'amount',
        'сумма начального остатка (eur)',
        'сума начален остатък (eur)',
        'сумма',
        'сума',
        'сумма, eur',
        'amount eur',
        'amount, eur',
        'остаток',
        'остатък',
        // Legacy simple template used a shorter amount header.
        'сумма eur',
      ],
      instruction: {
        ru: 'Знак суммы: плюс или без знака — долг; минус — переплата; 0 — ноль; пусто — уточнить позже. Числа Excel и текст с точкой/запятой.',
        bg: 'Знак на сумата: плюс или без знак — дълг; минус — преплата; 0 — нула; празно — по-късно. Числа от Excel и текст с точка/запетая.',
        en: 'Amount sign: plus or unsigned — debt; minus — overpayment; 0 — zero; blank — enter later. Excel numbers and comma/dot text.',
      },
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

export type CapitalRepairIdentitySeed = {
  apartment_number: string;
  section_code?: string | null;
  block_code?: string | null;
};

export function buildCapitalRepairSimpleTemplateBuffer(
  locale: 'ru' | 'bg' | 'en' | string = 'ru',
  identityRows?: CapitalRepairIdentitySeed[],
): ArrayBuffer {
  const loc = toImportTemplateLocale(locale);
  if (!identityRows?.length) {
    return buildLocalizedImportWorkbook(CAPITAL_REPAIR_SIMPLE_IMPORT_SPEC, loc);
  }
  const sorted = sortPropertyBookOwnerIdentitySeeds(identityRows);
  const rows = sorted.map((r) => ({
    apartment_number: String(r.apartment_number ?? ''),
    section_code: r.section_code != null ? String(r.section_code) : '',
    block_code: r.block_code != null ? String(r.block_code) : '',
  }));
  return buildLocalizedImportWorkbookWithRows(CAPITAL_REPAIR_SIMPLE_IMPORT_SPEC, loc, rows, {
    extraBlankRows: 40,
  });
}
