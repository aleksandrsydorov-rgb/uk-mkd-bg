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
 * Simple first-run internet opening template (4 columns).
 * Signed amount encodes debt / overpayment / zero / blank (unknown).
 * Connection state and paid periods are NOT in the file — confirmed later on the apartment card.
 */
export const INTERNET_SIMPLE_IMPORT_SPEC: ImportTemplateSpec = {
  id: 'internet_opening_simple',
  fileBaseName: {
    ru: 'шаблон-интернет-начальные-остатки',
    bg: 'shablon-internet-nachalni-ostatatsi',
    en: 'internet-opening-balances',
  },
  dataSheetName: {
    ru: 'Начальные остатки',
    bg: 'Начални салда',
    en: 'Opening balances',
  },
  legacySheetNames: ['subscriptions', 'Подключения', 'Връзки'],
  title: {
    ru: 'Интернет — начальные остатки',
    bg: 'Интернет — начални остатъци',
    en: 'Internet — opening balances',
  },
  notes: {
    ru: [
      'Заполняйте только лист «Начальные остатки». Примеры на листе инструкции не импортируются.',
      OPENING_IDENTITY_FORMAT_NOTE.ru,
      'Первые три колонки уже заполнены из Книги объектов. Сохраняйте их без изменений.',
      'Сумма начального остатка задаёт денежный вид знаком: 50 или +50 — долг; −50 — переплата; 0 — подтверждённый нулевой денежный остаток; пусто — остаток неизвестен (можно внести позже). Одиночный дефис «-» — ошибка.',
      'Денежный остаток не определяет состояние подключения и не создаёт оплаченный период. Подключение подтвердите позже в карточке квартиры → «Интернет».',
      'Пустое значение не становится нулём. Повторный импорт с пустыми суммами не стирает уже сохранённые деньги, подключения и периоды.',
    ],
    bg: [
      'Попълвайте само листа «Начални салда». Примерите в инструкцията не се импортират.',
      OPENING_IDENTITY_FORMAT_NOTE.bg,
      'Първите три колони са попълнени от Книгата на обектите. Не ги променяйте.',
      'Сумата на началния остатък определя паричния вид със знака: 50 или +50 — дълг; −50 — преплата; 0 — потвърдена нулева парична наличност; празно — остатъкът е неизвестен (може по-късно). Самостоятелен дефис «-» е грешка.',
      'Паричният остатък не определя състоянието на връзката и не създава платен период. Връзката се потвърждава по-късно в картата на апартамента → «Интернет».',
      'Празно не става нула. Повторен импорт с празни суми не изтрива вече записани пари, връзки и периоди.',
    ],
    en: [
      'Fill only the Opening balances sheet. Examples on the Instructions sheet are not imported.',
      OPENING_IDENTITY_FORMAT_NOTE.en,
      'The first three columns are prefilled from the Property Book. Keep them unchanged.',
      'The opening balance amount encodes money by sign: 50 or +50 — debt; −50 — overpayment; 0 — confirmed zero cash balance; blank — balance unknown (enter later). A lone hyphen “-” is an error.',
      'The cash balance does not set connection state and does not create a paid period. Confirm connection later on the apartment card → Internet.',
      'Empty is not turned into zero. Re-import with blank amounts does not wipe saved money, connections, or paid periods.',
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
        'opening_debt',
        'opening_credit',
        'долг',
        'дълг',
        'переплата',
        'преплата',
      ],
      instruction: {
        ru: 'Знак суммы: плюс или без знака — долг; минус — переплата; 0 — ноль денег; пусто — уточнить позже. Не задаёт подключение. Числа Excel и текст с точкой/запятой.',
        bg: 'Знак на сумата: плюс или без знак — дълг; минус — преплата; 0 — нула пари; празно — по-късно. Не задава връзката. Числа от Excel и текст с точка/запетая.',
        en: 'Amount sign: plus or unsigned — debt; minus — overpayment; 0 — zero cash; blank — enter later. Does not set connection. Excel numbers and comma/dot text.',
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
        { apartment_number: '8', section_code: 'A', block_code: '', opening_balance_eur: '50' },
        { apartment_number: '9', section_code: 'A', block_code: '', opening_balance_eur: '-50' },
        { apartment_number: '10', section_code: 'Б', block_code: '', opening_balance_eur: '0' },
        { apartment_number: '12', section_code: 'Б', block_code: '', opening_balance_eur: '' },
      ],
    },
  ],
  templateInputRows: 120,
};

export type InternetIdentitySeed = {
  apartment_number: string;
  section_code?: string | null;
  block_code?: string | null;
};

export function buildInternetSimpleTemplateBuffer(
  locale: 'ru' | 'bg' | 'en' | string = 'ru',
  identityRows?: InternetIdentitySeed[],
): ArrayBuffer {
  const loc = toImportTemplateLocale(locale);
  if (!identityRows?.length) {
    return buildLocalizedImportWorkbook(INTERNET_SIMPLE_IMPORT_SPEC, loc);
  }
  const sorted = sortPropertyBookOwnerIdentitySeeds(identityRows);
  const rows = sorted.map((r) => ({
    apartment_number: String(r.apartment_number ?? ''),
    section_code: r.section_code != null ? String(r.section_code) : '',
    block_code: r.block_code != null ? String(r.block_code) : '',
  }));
  return buildLocalizedImportWorkbookWithRows(INTERNET_SIMPLE_IMPORT_SPEC, loc, rows, {
    extraBlankRows: 40,
  });
}
