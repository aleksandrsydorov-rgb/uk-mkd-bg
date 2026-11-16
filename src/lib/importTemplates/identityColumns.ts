import type { ImportColumnDef } from '@/lib/importTemplates/types';
import { PROPERTY_BOOK_IDENTITY_FORMAT_EXAMPLE } from '@/lib/propertyBookIdentity';

/** Shared Apt / Section / Block columns for opening import templates. */
export const OPENING_IDENTITY_FORMAT_NOTE = {
  ru: `Формат квартиры: ${PROPERTY_BOOK_IDENTITY_FORMAT_EXAMPLE}. Ключ сопоставления — Апартамент + Секция + Блок (не только номер).`,
  bg: `Формат на апартамента: ${PROPERTY_BOOK_IDENTITY_FORMAT_EXAMPLE}. Ключ за съпоставяне — Апартамент + Секция + Блок (не само номер).`,
  en: `Apartment format: Apartment 2 · Section B · Block 3. Match key is Apartment + Section + Block (not number alone).`,
} as const;

export const OPENING_APARTMENT_COLUMN: ImportColumnDef = {
  key: 'apartment_number',
  required: true,
  format: 'text',
  width: 16,
  label: { ru: 'Апартамент', bg: 'Апартамент', en: 'Apartment' },
  aliases: [
    'apartment',
    'apt',
    'кв',
    'квартира',
    'номер апартамента',
    'номер на апартамент',
    'apartment number',
  ],
  instruction: {
    ru: 'Номер апартамента, например 2. Обязательно. Пример полной записи: Апартамент 2 · Секция Б · Блок 3.',
    bg: 'Номер на апартамента, например 2. Задължително. Пример: Апартамент 2 · Секция Б · Блок 3.',
    en: 'Apartment number, e.g. 2. Required. Full example: Apartment 2 · Section B · Block 3.',
  },
  example: '2',
};

export const OPENING_SECTION_COLUMN: ImportColumnDef = {
  key: 'section_code',
  required: false,
  format: 'text',
  width: 12,
  label: { ru: 'Секция', bg: 'Секция', en: 'Section' },
  aliases: ['section', 'entrance', 'подъезд', 'секция', 'вход', 'код секции', 'код на секция'],
  instruction: {
    ru: 'Буква входа, например Б. Не указывайте здесь номер блока. Обязательно, если один и тот же номер квартиры есть в разных подъездах.',
    bg: 'Буква на входа, например Б. Не пишете тук номера на блока. Задължително, ако същият номер се повтаря в различни входове.',
    en: 'Entrance letter, e.g. B. Do not put the block number here. Required when the same apartment number exists in more than one entrance.',
  },
  example: 'Б',
};

export const OPENING_BLOCK_COLUMN: ImportColumnDef = {
  key: 'block_code',
  required: false,
  format: 'text',
  width: 12,
  label: { ru: 'Блок', bg: 'Блок', en: 'Block' },
  aliases: ['block', 'блок', 'корпус', 'код блока', 'код на блок'],
  instruction: {
    ru: 'Номер блока, например 3. Если в комплексе блоки не используются, оставьте пустым.',
    bg: 'Номер на блока, например 3. Ако в комплекса няма блокове, оставете празно.',
    en: 'Block number, e.g. 3. Leave empty if the complex does not use blocks.',
  },
  example: '3',
};

export const OPENING_IDENTITY_COLUMNS: ImportColumnDef[] = [
  OPENING_APARTMENT_COLUMN,
  OPENING_SECTION_COLUMN,
  OPENING_BLOCK_COLUMN,
];
