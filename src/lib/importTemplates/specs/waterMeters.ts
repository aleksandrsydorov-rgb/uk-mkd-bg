import type { ImportTemplateSpec } from '@/lib/importTemplates/types';
import {
  OPENING_IDENTITY_COLUMNS,
  OPENING_IDENTITY_FORMAT_NOTE,
} from '@/lib/importTemplates/identityColumns';

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
      'Заполняйте только лист «Счётчики». Примеры в этой инструкции не импортируются.',
      OPENING_IDENTITY_FORMAT_NOTE.ru,
      'Строка квартиры из Книги собственности импортируется даже без номера счётчика и показаний — статус «Нужно внести начальные показания». Полностью пустые строки пропускаются.',
      'Пустое показание не становится 0. Явно введённый 0 — допустимое значение. Повторный импорт с пустыми полями не стирает уже сохранённые данные.',
      'Несколько счётчиков на один апартамент — отдельная строка на каждый номер. Начальный остаток — один раз на апартамент.',
      'Дата установки: ГГГГ-ММ-ДД. Тип остатка: ноль / долг / переплата (или zero / debt / overpayment).',
    ],
    bg: [
      'Попълвайте само листа «Водомери». Примерите тук не се импортират.',
      OPENING_IDENTITY_FORMAT_NOTE.bg,
      'Ред за апартамент от Книгата се импортира и без номер на водомер и показания — статус «Трябва да се въведат начални показания». Напълно празните редове се пропускат.',
      'Празно показание не става 0. Изрично въведено 0 е валидно. Повторен импорт с празни полета не изтрива вече записаните данни.',
      'Няколко водомера за един апартамент — отделен ред за всеки номер. Началното салдо е веднъж на апартамент.',
      'Дата: ГГГГ-ММ-ДД. Тип салдо: нула / дълг / преплата (или zero / debt / overpayment).',
    ],
    en: [
      'Fill only the Meters sheet. Examples on this Instructions sheet are not imported.',
      OPENING_IDENTITY_FORMAT_NOTE.en,
      'A Property Book apartment row imports even without meter number and readings — status “Needs initial readings”. Fully blank rows are skipped.',
      'An empty reading is not turned into 0. An explicit 0 is a valid reading. Re-import with blank fields does not wipe saved data.',
      'Multiple meters for one apartment: one row per meter number. Opening balance once per apartment.',
      'Install date: YYYY-MM-DD. Balance kind: zero / debt / overpayment (localized words also accepted).',
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
        ru: 'Заводской или учётный номер. Можно оставить пустым — тогда статус «Нужно внести начальные показания».',
        bg: 'Сериен / отчетен номер. Може да остане празен — тогава статус «Трябва да се въведат начални показания».',
        en: 'Serial or registry number. May be empty — then status “Needs initial readings”.',
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
      key: 'opening_balance_kind',
      required: false,
      format: 'text',
      width: 22,
      label: {
        ru: 'Тип начального остатка',
        bg: 'Тип начален остатък',
        en: 'Opening balance type',
      },
      aliases: ['balance_kind', 'kind', 'тип остатка'],
      instruction: {
        ru: 'Пусто или «ноль» / «долг» / «переплата» (zero / debt / overpayment).',
        bg: 'Празно или «нула» / «дълг» / «преплата» (zero / debt / overpayment).',
        en: 'Empty or zero / debt / overpayment (localized words accepted).',
      },
      example: 'debt',
    },
    {
      key: 'opening_balance_eur',
      required: false,
      format: 'money',
      width: 22,
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
      ],
      instruction: {
        ru: 'Сумма в EUR при долге или переплате (> 0). Для нуля оставьте пустым.',
        bg: 'Сума в EUR при дълг или преплата (> 0). За нула оставете празно.',
        en: 'EUR amount when debt/overpayment (> 0). Leave empty for zero.',
      },
      example: '25.00',
    },
  ],
};
