export type OwnerMenu =
  | 'обзор'
  | 'квартира'
  | 'жильцы'
  | 'финансы'
  | 'счётчики'
  | 'документы'
  | 'опросы'
  | 'ук';

export type OwnerMgmtTab = 'заявки' | 'объявления' | 'расходы' | 'чат';

const SECTION_TO_MENU: Record<string, OwnerMenu> = {
  overview: 'обзор',
  обзор: 'обзор',
  apartment: 'квартира',
  apt: 'квартира',
  квартира: 'квартира',
  residency: 'жильцы',
  occupancy: 'жильцы',
  living: 'жильцы',
  жильцы: 'жильцы',
  finance: 'финансы',
  финансы: 'финансы',
  meters: 'счётчики',
  счётчики: 'счётчики',
  documents: 'документы',
  документы: 'документы',
  polls: 'опросы',
  опросы: 'опросы',
  management: 'ук',
  uk: 'ук',
  ук: 'ук',
  requests: 'ук',
  заявки: 'ук',
  messages: 'ук',
  announcements: 'ук',
  сообщения: 'ук',
  объявления: 'ук',
  expenses: 'ук',
  расходы: 'ук',
  расходы_ук: 'ук',
  chat: 'ук',
  чат: 'ук',
};

const TAB_TO_MGMT: Record<string, OwnerMgmtTab> = {
  requests: 'заявки',
  заявки: 'заявки',
  announcements: 'объявления',
  messages: 'объявления',
  сообщения: 'объявления',
  объявления: 'объявления',
  expenses: 'расходы',
  расходы: 'расходы',
  расходы_ук: 'расходы',
  chat: 'чат',
  чат: 'чат',
};

const MENU_TO_SECTION: Record<OwnerMenu, string> = {
  обзор: 'overview',
  квартира: 'apartment',
  жильцы: 'residency',
  финансы: 'finance',
  счётчики: 'meters',
  документы: 'documents',
  опросы: 'polls',
  ук: 'management',
};

const MGMT_TO_TAB: Record<OwnerMgmtTab, string> = {
  заявки: 'requests',
  объявления: 'announcements',
  расходы: 'expenses',
  чат: 'chat',
};

function norm(raw: string | null | undefined) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^#/, '');
}

export function parseOwnerNav(url: URL): { menu?: OwnerMenu; mgmt?: OwnerMgmtTab } {
  const section = norm(url.searchParams.get('section') || url.searchParams.get('menu') || url.hash);
  const tab = norm(url.searchParams.get('tab') || url.searchParams.get('mgmtTab'));
  const menu = SECTION_TO_MENU[section];
  const mgmt = TAB_TO_MGMT[tab] ?? TAB_TO_MGMT[section];
  return { menu, mgmt };
}

export function ownerSectionParam(menu: OwnerMenu) {
  return MENU_TO_SECTION[menu];
}

export function ownerMgmtParam(tab: OwnerMgmtTab) {
  return MGMT_TO_TAB[tab];
}
