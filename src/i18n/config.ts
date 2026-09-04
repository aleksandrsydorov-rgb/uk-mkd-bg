export const LOCALES = ['ru', 'en', 'bg'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ru';
export const LOCALE_STORAGE_KEY = 'ui_locale';

export const LOCALE_META: Record<Locale, { native: string; short: string; html: string; dates: string }> = {
  ru: { native: 'Русский', short: 'RU', html: 'ru', dates: 'ru-RU' },
  en: { native: 'English', short: 'EN', html: 'en', dates: 'en-GB' },
  bg: { native: 'Български', short: 'BG', html: 'bg', dates: 'bg-BG' },
};

export function isLocale(value: string | null | undefined): value is Locale {
  return LOCALES.includes(value as Locale);
}
