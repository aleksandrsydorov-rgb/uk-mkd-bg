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
  width: 28,
  label: {
    ru: 'Секция (буква, например Б)',
    bg: 'Секция (буква, например Б)',
    en: 'Section (letter, e.g. B)',
  },
  aliases: [
    'секция',
    'section',
    'entrance',
    'подъезд',
    'вход',
    'код секции',
    'код на секция',
    'буква входа',
    'буква на входа',
    'entrance letter',
  ],
  requiredLabel: {
    ru: 'Условно',
    bg: 'Условно',
    en: 'Conditional',
  },
  instruction: {
    ru: 'Буква входа (не номер блока), например Б или A. Обязательно, если один и тот же номер квартиры есть в разных подъездах. Сохраняется как текст.',
    bg: 'Буква на входа (не номер на блока), например Б или A. Задължително, ако същият номер се повтаря в различни входове. Запазва се като текст.',
    en: 'Entrance letter (not the block number), e.g. B or A. Required when the same apartment number exists in more than one entrance. Stored as text.',
  },
  example: 'Б',
};

export const OPENING_BLOCK_COLUMN: ImportColumnDef = {
  key: 'block_code',
  required: false,
  format: 'text',
  width: 26,
  label: {
    ru: 'Блок (номер, например 3)',
    bg: 'Блок (номер, например 3)',
    en: 'Block (number, e.g. 3)',
  },
  aliases: [
    'блок',
    'block',
    'корпус',
    'код блока',
    'код на блок',
    'номер блока',
    'номер на блока',
    'block number',
  ],
  instruction: {
    ru: 'Числовой номер блока, например 3. Если в комплексе блоки не используются, оставьте пустым. Сохраняется как текст.',
    bg: 'Числов номер на блока, например 3. Ако в комплекса няма блокове, оставете празно. Запазва се като текст.',
    en: 'Numeric block number, e.g. 3. Leave empty if the complex does not use blocks. Stored as text.',
  },
  example: '3',
};

export const OPENING_IDENTITY_COLUMNS: ImportColumnDef[] = [
  OPENING_APARTMENT_COLUMN,
  OPENING_SECTION_COLUMN,
  OPENING_BLOCK_COLUMN,
];
