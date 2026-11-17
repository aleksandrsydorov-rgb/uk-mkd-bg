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

/**
 * Water meters opening template.
 * Apartments can be prefilled from the Property Book.
 * Opening balance kind is encoded in the sign of «Сумма начального остатка, EUR»
 * (no separate kind column). Legacy files with a kind column are still accepted by the importer.
 */
export const WATER_METERS_IMPORT_SPEC: ImportTemplateSpec = {
  id: 'water_meters_opening',
  fileBaseName: {
    ru: 'шаблон-водомеры-начальные',
    bg: 'shablon-vodomeri-nachalni',
    en: 'water-meters-opening-template',
  },
  dataSheetName: {
    ru: 'Счётчики',
    bg: 'Водомери',
    en: 'Meters',
  },
  legacySheetNames: ['meters'],
  title: {
    ru: 'Водомеры — начальный импорт',
    bg: 'Водомери — начален импорт',
    en: 'Water meters — opening import',
  },
  notes: {
    ru: [
      'Заполняйте только лист «Счётчики». Примеры на листе инструкции не импортируются.',
      OPENING_IDENTITY_FORMAT_NOTE.ru,
      'Первые три колонки уже заполнены из Книги собственности. Сохраняйте их без изменений. Несколько счётчиков одной квартиры — добавьте строки с теми же Апартамент / Секция / Блок.',
      'Номер счётчика, показание и дату можно оставить пустыми и дополнить позже в карточке квартиры. Пустое показание не становится 0; явно введённый 0 сохраняется как ноль.',
      'Сумма начального остатка задаёт вид остатка знаком: 50 или +50 — долг; −50 — переплата; 0 — подтверждённый ноль; пусто — остаток пока неизвестен. Одиночный дефис «-» — ошибка.',
      'Денежный остаток указывайте один раз на квартиру. В дополнительных строках счётчиков оставьте сумму пустой. Повторный импорт с пустыми полями не стирает уже сохранённые данные.',
    ],
    bg: [
      'Попълвайте само листа «Водомери». Примерите в инструкцията не се импортират.',
      OPENING_IDENTITY_FORMAT_NOTE.bg,
      'Първите три колони са попълнени от Книгата на собствеността. Не ги променяйте. Няколко водомера за един апартамент — добавете редове със същите Апартамент / Секция / Блок.',
      'Номерът на водомера, показанието и датата могат да останат празни и да се допълнят по-късно в картата. Празно показание не става 0; изрично 0 се записва като нула.',
      'Сумата на началния остатък определя вида със знака: 50 или +50 — дълг; −50 — преплата; 0 — потвърдена нула; празно — остатъкът още не е известен. Самостоятелен дефис «-» е грешка.',
      'Паричният остатък се посочва веднъж на апартамент. В допълнителните редове за водомери оставете сумата празна. Повторен импорт с празни полета не изтрива вече записаните данни.',
    ],
    en: [
      'Fill only the Meters sheet. Examples on the Instructions sheet are not imported.',
      OPENING_IDENTITY_FORMAT_NOTE.en,
      'The first three columns are prefilled from the Property Book. Keep them unchanged. For several meters on one apartment, add rows with the same Apartment / Section / Block.',
      'Meter number, reading, and install date may be left blank and completed later on the apartment card. An empty reading is not turned into 0; an explicit 0 is stored as zero.',
      'The opening balance amount encodes the kind by sign: 50 or +50 — debt; −50 — overpayment; 0 — confirmed zero; blank — balance still unknown. A lone hyphen “-” is an error.',
      'Enter the monetary balance once per apartment. Leave the amount blank on extra meter rows. Re-import with blank fields does not wipe saved data.',
    ],
  },
  columns: [
    ...OPENING_IDENTITY_COLUMNS,
    {
      key: 'meter_number',
      required: false,
      format: 'text',
      width: 20,
      label: {
        ru: 'Номер счётчика',
        bg: 'Номер на водомер',
        en: 'Meter number',
      },
      aliases: ['meter', 'serial', 'номер прибора', 'номер водомера', 'номер на водомер'],
      instruction: {
        ru: 'Заводской или учётный номер. Можно оставить пустым и указать позже в карточке.',
        bg: 'Сериен / отчетен номер. Може да остане празен и да се посочи по-късно в картата.',
        en: 'Serial or registry number. May be empty and filled later on the card.',
      },
      example: 'W-12-001',
    },
    {
      key: 'initial_reading',
      required: false,
      format: 'number',
      width: 18,
      label: {
        ru: 'Начальное показание',
        bg: 'Начално показание',
        en: 'Opening reading',
      },
      aliases: ['initial', 'reading', 'показание'],
      instruction: {
        ru: 'Показание на дату установки (≥ 0). Пусто ≠ 0. Явный 0 допустим.',
        bg: 'Показание към датата на монтаж (≥ 0). Празно ≠ 0. Изрично 0 е валидно.',
        en: 'Reading at install date (≥ 0). Empty ≠ 0. Explicit 0 is valid.',
      },
      example: '12.5',
    },
    {
      key: 'installed_at',
      required: false,
      format: 'date',
      width: 16,
      label: {
        ru: 'Дата установки',
        bg: 'Дата на монтаж',
        en: 'Install date',
      },
      aliases: ['installed', 'install_date', 'date', 'дата монтажа', 'дата на монтаж'],
      instruction: {
        ru: 'Дата ГГГГ-ММ-ДД, не позже сегодня. Нужна, когда заполнены номер счётчика и показание.',
        bg: 'Дата ГГГГ-ММ-ДД, не по-късно от днес. Нужна, когато са попълнени номер и показание.',
        en: 'Date YYYY-MM-DD, not in the future. Required when meter number and reading are filled.',
      },
      example: '2026-01-15',
    },
    {
      key: 'opening_balance_eur',
      required: false,
      format: 'money',
      width: 26,
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
      ],
      instruction: {
        ru: 'Знак суммы: плюс или без знака — долг; минус — переплата; 0 — ноль; пусто — уточнить позже. Числа Excel и текст с точкой/запятой. Один раз на квартиру.',
        bg: 'Знак на сумата: плюс или без знак — дълг; минус — преплата; 0 — нула; празно — по-късно. Числа от Excel и текст с точка/запетая. Веднъж на апартамент.',
        en: 'Amount sign: plus or unsigned — debt; minus — overpayment; 0 — zero; blank — enter later. Excel numbers and comma/dot text. Once per apartment.',
      },
      example: '50.00',
    },
  ],
  instructionScenarios: [
    {
      title: {
        ru: 'Примеры сумм и нескольких счётчиков (не импортируются)',
        bg: 'Примери за суми и няколко водомера (не се импортират)',
        en: 'Amount and multi-meter examples (not imported)',
      },
      rows: [
        {
          apartment_number: '8',
          section_code: 'A',
          block_code: '',
          meter_number: 'W-8-1',
          initial_reading: '12.5',
          installed_at: '2026-01-15',
          opening_balance_eur: '50',
        },
        {
          apartment_number: '9',
          section_code: 'A',
          block_code: '',
          meter_number: 'W-9-1',
          initial_reading: '0',
          installed_at: '2026-01-15',
          opening_balance_eur: '-50',
        },
        {
          apartment_number: '10',
          section_code: 'Б',
          block_code: '',
          meter_number: 'W-10-1',
          initial_reading: '3',
          installed_at: '2026-01-15',
          opening_balance_eur: '0',
        },
        {
          apartment_number: '12',
          section_code: 'Б',
          block_code: '',
          meter_number: '',
          initial_reading: '',
          installed_at: '',
          opening_balance_eur: '',
        },
        {
          apartment_number: '15',
          section_code: 'В',
          block_code: '',
          meter_number: 'W-15-1',
          initial_reading: '100',
          installed_at: '2026-01-10',
          opening_balance_eur: '25',
        },
        {
          apartment_number: '15',
          section_code: 'В',
          block_code: '',
          meter_number: 'W-15-2',
          initial_reading: '40',
          installed_at: '2026-01-10',
          opening_balance_eur: '',
        },
      ],
    },
  ],
  templateInputRows: 120,
};

export type WaterMeterIdentitySeed = {
  apartment_number: string;
  section_code?: string | null;
  block_code?: string | null;
};

export function buildWaterMeterIs3TemplateBuffer(
  locale: 'ru' | 'bg' | 'en' | string = 'ru',
  identityRows?: WaterMeterIdentitySeed[],
): ArrayBuffer {
  const loc = toImportTemplateLocale(locale);
  if (!identityRows?.length) {
    return buildLocalizedImportWorkbook(WATER_METERS_IMPORT_SPEC, loc);
  }
  const rows = identityRows.map((r) => ({
    apartment_number: String(r.apartment_number ?? ''),
    section_code: r.section_code != null ? String(r.section_code) : '',
    block_code: r.block_code != null ? String(r.block_code) : '',
  }));
  return buildLocalizedImportWorkbookWithRows(WATER_METERS_IMPORT_SPEC, loc, rows, {
    extraBlankRows: 40,
  });
}
