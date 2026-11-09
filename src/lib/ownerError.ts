import { DEFAULT_LOCALE } from '@/i18n/config';
import { translate } from '@/i18n/translate';
import { toUserFacingMessage, type UserFacingTranslate } from '@/lib/userFacingError';

/**
 * Legacy helper used across admin/account screens.
 * Prefer passing `t` as the third argument for the active UI locale.
 * Never returns SQL/RPC/SDK dumps — unmapped technical errors become `fallback`.
 */
export function ownerVisibleError(
  raw: unknown,
  fallback: string,
  t?: UserFacingTranslate,
): string {
  const translateFn: UserFacingTranslate =
    typeof t === 'function'
      ? t
      : (key) => {
          const value = translate(DEFAULT_LOCALE, key);
          return !value || value === key ? fallback : value;
        };
  return toUserFacingMessage(raw, translateFn, { fallback });
}
