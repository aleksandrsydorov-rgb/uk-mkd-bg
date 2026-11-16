import type { ImportTemplateSpec } from '@/lib/importTemplates/types';
import {
  OPENING_IDENTITY_COLUMNS,
  OPENING_IDENTITY_FORMAT_NOTE,
} from '@/lib/importTemplates/identityColumns';

export const ELECTRICITY_METERS_IMPORT_SPEC: ImportTemplateSpec = {
  id: 'electricity_meters_opening',
  fileBaseName: {
    ru: 'шаблон-электросчётчики-начальные',
    bg: 'shablon-elektromeri-nachalni',
    en: 'electricity-meters-opening-template',
  },
  dataSheetName: {
    ru: 'Счётчики',
    bg: 'Електромери',
    en: 'Meters',
  },
  legacySheetNames: ['meters'],
  title: {
    ru: 'Электросчётчики — начальный импорт',
    bg: 'Електромери — начален импорт',
    en: 'Electricity meters — opening import',
  },
  notes: {
    ru: [
      'Заполняйте только лист «Счётчики». Примеры в инструкции не импортируются.',
      OPENING_IDENTITY_FORMAT_NOTE.ru,
      'Строка квартиры из Книги собственности импортируется даже без номера счётчика и показаний день/ночь — статус «Нужно внести начальные показания». Полностью пустые строки пропускаются.',
      'Пустое показание не становится 0. Начальный остаток — один раз на апартамент.',
      'Дата установки: ГГГГ-ММ-ДД. Тип остатка: ноль / долг / переплата (или zero / debt / overpayment).',
    ],
    bg: [
      'Попълвайте само листа «Електромери». Примерите в инструкцията не се импортират.',
      OPENING_IDENTITY_FORMAT_NOTE.bg,
      'Ред за апартамент от Книгата се импортира и без номер на електромер и показания ден/нощ — статус «Трябва да се въведат начални показания». Напълно празните редове се пропускат.',
      'Празно показание не става 0. Началното салдо е веднъж на апартамент.',
      'Дата на монтаж: ГГГГ-ММ-ДД. Тип салдо: нула / дълг / преплата (или zero / debt / overpayment).',
    ],
    en: [
      'Fill only the Meters sheet. Examples on Instructions are not imported.',
      OPENING_IDENTITY_FORMAT_NOTE.en,
      'A Property Book apartment row imports even without meter number and day/night readings — status “Needs initial readings”. Fully blank rows are skipped.',
      'An empty reading is not turned into 0. Opening balance once per apartment.',
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
        bg: 'Номер на електромер',
        en: 'Meter number',
      },
      aliases: ['meter', 'номер электромера', 'номер на електромер', 'номер прибора'],
      instruction: {
        ru: 'Номер счётчика (текст). Можно оставить пустым — тогда статус «Нужно внести начальные показания».',
        bg: 'Номер на електромера (текст). Може да остане празен — тогава статус «Трябва да се въведат начални показания».',
        en: 'Meter number as text. May be empty — then status “Needs initial readings”.',
      },
      example: 'E-12-001',
    },
    {
      key: 'initial_day_reading',
      required: false,
      format: 'number',
      width: 16,
      label: {
        ru: 'Начальное показание (день)',
        bg: 'Начално (ден)',
        en: 'Opening reading (day)',
      },
      aliases: ['initial_day', 'day', 'день'],
      instruction: {
        ru: 'Дневное показание ≥ 0. Пусто ≠ 0. Нужно вместе с ночным при заполненном номере счётчика.',
        bg: 'Дневно показание ≥ 0. Празно ≠ 0. Нужно заедно с нощното при попълнен номер на електромер.',
        en: 'Day reading ≥ 0. Empty ≠ 0. Required with night reading when meter number is filled.',
      },
      example: '100.5',
    },
    {
      key: 'initial_night_reading',
      required: false,
      format: 'number',
      width: 16,
      label: {
        ru: 'Начальное показание (ночь)',
        bg: 'Начално (нощ)',
        en: 'Opening reading (night)',
      },
      aliases: ['initial_night', 'night', 'ночь', 'нощ'],
      instruction: {
        ru: 'Ночное показание ≥ 0. Пусто ≠ 0. Нужно вместе с дневным при заполненном номере счётчика.',
        bg: 'Нощно показание ≥ 0. Празно ≠ 0. Нужно заедно с дневното при попълнен номер на електромер.',
        en: 'Night reading ≥ 0. Empty ≠ 0. Required with day reading when meter number is filled.',
      },
      example: '40.2',
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
      aliases: ['installed', 'install_date', 'дата монтажа'],
      instruction: {
        ru: 'Дата ГГГГ-ММ-ДД. Нужна, когда заполнены номер счётчика и оба показания.',
        bg: 'Дата ГГГГ-ММ-ДД. Нужна, когато са попълнени номерът и двете показания.',
        en: 'Date YYYY-MM-DD. Required when meter number and both readings are filled.',
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
      aliases: ['balance_kind', 'kind'],
      instruction: {
        ru: 'Пусто / ноль / долг / переплата.',
        bg: 'Празно / нула / дълг / преплата.',
        en: 'Empty / zero / debt / overpayment.',
      },
      example: 'overpayment',
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
      aliases: ['opening_balance', 'amount', 'сумма начального остатка (eur)'],
      instruction: {
        ru: 'Сумма EUR при долге/переплате.',
        bg: 'Сума EUR при дълг/преплата.',
        en: 'EUR amount for debt/overpayment.',
      },
      example: '10.00',
    },
  ],
};