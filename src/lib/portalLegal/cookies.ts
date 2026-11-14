export type CookieClass = 'strictly_necessary' | 'functional' | 'optional';

export type ClientStorageEntry = {
  name: string;
  where: 'cookie' | 'localStorage';
  class: CookieClass;
  purposeKey: string;
};

/**
 * Result of the stage-1 review of the public site and the cabinet.
 * No third-party analytics, advertising or map scripts are loaded.
 */
export const CLIENT_STORAGE_INVENTORY: ClientStorageEntry[] = [
  {
    name: 'sb-*-auth-token',
    where: 'cookie',
    class: 'strictly_necessary',
    purposeKey: 'legal.cookieAuth',
  },
  {
    name: 'ui_locale',
    where: 'localStorage',
    class: 'functional',
    purposeKey: 'legal.cookieLocale',
  },
  {
    name: 'uk_chat_seen_v1',
    where: 'localStorage',
    class: 'functional',
    purposeKey: 'legal.cookieChatSeen',
  },
  {
    name: 'uk_overview_cards_v1',
    where: 'localStorage',
    class: 'functional',
    purposeKey: 'legal.cookieAdminPrefs',
  },
];

export const OPTIONAL_CLIENT_STORAGE = CLIENT_STORAGE_INVENTORY.filter(
  (entry) => entry.class === 'optional',
);

export const COOKIE_BANNER_REQUIRED = OPTIONAL_CLIENT_STORAGE.length > 0;
