import { dictionaries, fallbackMessages, type Messages } from './messages';
import type { Locale } from './config';

function getByPath(obj: unknown, path: string): string | undefined {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

export type Translate = (path: string, vars?: Record<string, string | number>) => string;

export function translate(locale: Locale, path: string, vars?: Record<string, string | number>): string {
  const dict: Messages = dictionaries[locale] ?? fallbackMessages;
  let text = getByPath(dict, path) ?? getByPath(fallbackMessages, path) ?? path;
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${key}}`, String(value));
    }
  }
  return text;
}
