/** R1-UX-IMPLEMENT — approved admin/staff navigation composition (leaves stay permission-gated). */

export type AdminNavSection =
  | 'обзор'
  | 'квартиры'
  | 'книга'
  | 'смены'
  | 'заявки'
  | 'рабочие_задачи'
  | 'мои_задачи'
  | 'счётчики'
  | 'вода'
  | 'персонал'
  | 'настройки'
  | 'такса'
  | 'электроэнергия'
  | 'капремонт'
  | 'интернет'
  | 'блокировка'
  | 'охрана'
  | 'уборка'
  | 'инвентарь'
  | 'моя_инвентаризация'
  | 'бюджет'
  | 'собрания'
  | 'решения'
  | 'расходы'
  | 'отчётность'
  | 'тарифы'
  | 'опросы'
  | 'документы'
  | 'правни'
  | 'объявления'
  | 'чат'
  | 'платформа'
  | 'активация'
  | 'начальная_настройка';

export type AdminNavGroup = {
  id: string;
  /** i18n key under admin.* */
  labelKey: string;
  items: AdminNavSection[];
};

export type AdminNavFlags = {
  isComplexAdmin: boolean;
  showMyTasks: boolean;
  showInventoryStaff: boolean;
  showApartments: boolean;
  showBook: boolean;
  showTransfers: boolean;
  showServiceLock: boolean;
  showSecurity: boolean;
  showCleaning: boolean;
  showInventory: boolean;
  /** Utilities workplace: meters / readings (module ready + role). */
  showWater: boolean;
  showElectricity: boolean;
  /** Finance workplace leaves for the same modules (ready + finance role). */
  showWaterFinance: boolean;
  showElectricityFinance: boolean;
  showSupportFee: boolean;
  showCapital: boolean;
  showInternet: boolean;
  /** Finance workplace for internet (register / payment card). */
  showInternetFinance: boolean;
  showExpenses: boolean;
  showBudget: boolean;
  showTariffs: boolean;
  showReporting: boolean;
  showRequests: boolean;
  showWorkOrders: boolean;
  showAnnouncements: boolean;
  showPolls: boolean;
  showChat: boolean;
  /** RC8+: General Meetings workplace (AdminDocumentsDecisions mode=meetings). */
  showMeetings: boolean;
  showDocuments: boolean;
  showLegalDocuments: boolean;
  showStaff: boolean;
  showSettings: boolean;
  showInitialSetup: boolean;
  showPlatform: boolean;
  showUserActivation: boolean;
};

function nonempty(items: AdminNavSection[]): AdminNavSection[] {
  return items.filter(Boolean);
}

/** Administrator — exactly the approved 8 top-level groups (empty groups omitted). */
export function buildAdminNavGroups(f: AdminNavFlags): AdminNavGroup[] {
  const groups: AdminNavGroup[] = [
    { id: 'overview', labelKey: 'overview', items: ['обзор'] },
    {
      id: 'objects',
      labelKey: 'menuObjectsResidence',
      items: nonempty([
        ...(f.showApartments ? (['квартиры'] as const) : []),
        ...(f.showBook ? (['книга'] as const) : []),
        ...(f.showTransfers ? (['смены'] as const) : []),
        ...(f.showServiceLock ? (['блокировка'] as const) : []),
      ]),
    },
    {
      id: 'finance',
      labelKey: 'menuFinance',
      items: nonempty([
        ...(f.showSupportFee ? (['такса'] as const) : []),
        ...(f.showCapital ? (['капремонт'] as const) : []),
        // Same module surfaces as Utilities — finance entry opens the finance tab.
        ...(f.showWaterFinance ? (['вода'] as const) : []),
        ...(f.showElectricityFinance ? (['электроэнергия'] as const) : []),
        ...(f.showInternetFinance ? (['интернет'] as const) : []),
        ...(f.showExpenses ? (['расходы'] as const) : []),
        ...(f.showBudget ? (['бюджет'] as const) : []),
        ...(f.showTariffs ? (['тарифы'] as const) : []),
        ...(f.showReporting ? (['отчётность'] as const) : []),
      ]),
    },
    {
      id: 'utilities',
      labelKey: 'menuUtilitiesMetering',
      items: nonempty([
        ...(f.showWater ? (['вода'] as const) : []),
        // Meters / readings entry into the same water & electricity modules.
        ...(f.showElectricity ? (['электроэнергия'] as const) : []),
        ...(f.showInternet ? (['интернет'] as const) : []),
      ]),
    },
    {
      id: 'operations',
      labelKey: 'menuOperations',
      items: nonempty([
        ...(f.showRequests ? (['заявки'] as const) : []),
        ...(f.showWorkOrders ? (['рабочие_задачи'] as const) : []),
        ...(f.showMyTasks ? (['мои_задачи'] as const) : []),
        ...(f.showCleaning ? (['уборка'] as const) : []),
        ...(f.showSecurity ? (['охрана'] as const) : []),
        ...(f.showInventory ? (['инвентарь'] as const) : []),
        ...(f.showInventoryStaff ? (['моя_инвентаризация'] as const) : []),
      ]),
    },
    {
      id: 'comms',
      labelKey: 'menuComm',
      items: nonempty([
        ...(f.showAnnouncements ? (['объявления'] as const) : []),
        ...(f.showPolls ? (['опросы'] as const) : []),
        ...(f.showChat ? (['чат'] as const) : []),
      ]),
    },
    {
      id: 'docs',
      labelKey: 'menuDocs',
      items: nonempty([
        ...(f.showMeetings ? (['собрания'] as const) : []),
        ...(f.showDocuments ? (['документы'] as const) : []),
        ...(f.showLegalDocuments ? (['правни'] as const) : []),
      ]),
    },
    {
      id: 'system',
      labelKey: 'menuSystem',
      items: nonempty([
        ...(f.showStaff ? (['персонал'] as const) : []),
        ...(f.showSettings ? (['настройки'] as const) : []),
        ...(f.showInitialSetup ? (['начальная_настройка'] as const) : []),
        ...(f.showPlatform ? (['платформа'] as const) : []),
        ...(f.showUserActivation ? (['активация'] as const) : []),
      ]),
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/**
 * Staff — at most 6 sections from the approved set, capability-filtered.
 * Accountant finance leaves appear under Финансы when present (still ≤6 total groups).
 */
export function buildStaffNavGroups(f: AdminNavFlags): AdminNavGroup[] {
  const candidates: AdminNavGroup[] = [
    { id: 'overview', labelKey: 'overview', items: ['обзор'] },
    {
      id: 'mytasks',
      labelKey: 'myTasks',
      items: nonempty([
        ...(f.showMyTasks ? (['мои_задачи'] as const) : []),
        ...(f.showInventoryStaff ? (['моя_инвентаризация'] as const) : []),
      ]),
    },
    {
      id: 'objects',
      labelKey: 'menuObjects',
      items: nonempty([
        ...(f.showApartments ? (['квартиры'] as const) : []),
        ...(f.showBook ? (['книга'] as const) : []),
        ...(f.showTransfers ? (['смены'] as const) : []),
        ...(f.showServiceLock ? (['блокировка'] as const) : []),
      ]),
    },
    {
      id: 'finance',
      labelKey: 'menuFinance',
      items: nonempty([
        ...(f.showSupportFee ? (['такса'] as const) : []),
        ...(f.showCapital ? (['капремонт'] as const) : []),
        ...(f.showWaterFinance ? (['вода'] as const) : []),
        ...(f.showElectricityFinance ? (['электроэнергия'] as const) : []),
        ...(f.showInternetFinance ? (['интернет'] as const) : []),
        ...(f.showExpenses ? (['расходы'] as const) : []),
        ...(f.showBudget ? (['бюджет'] as const) : []),
        ...(f.showTariffs ? (['тарифы'] as const) : []),
        ...(f.showReporting ? (['отчётность'] as const) : []),
      ]),
    },
    {
      id: 'maintenance',
      labelKey: 'menuMaintenance',
      items: nonempty([
        ...(f.showRequests ? (['заявки'] as const) : []),
        ...(f.showWorkOrders ? (['рабочие_задачи'] as const) : []),
        ...(f.showWater ? (['вода'] as const) : []),
        ...(f.showElectricity ? (['электроэнергия'] as const) : []),
        ...(f.showInternet ? (['интернет'] as const) : []),
        ...(f.showCleaning ? (['уборка'] as const) : []),
        ...(f.showSecurity ? (['охрана'] as const) : []),
        ...(f.showInventory ? (['инвентарь'] as const) : []),
      ]),
    },
    {
      id: 'comms',
      labelKey: 'menuComm',
      items: nonempty([
        ...(f.showAnnouncements ? (['объявления'] as const) : []),
        ...(f.showPolls ? (['опросы'] as const) : []),
        ...(f.showChat ? (['чат'] as const) : []),
        ...(f.showMeetings ? (['собрания'] as const) : []),
        ...(f.showDocuments ? (['документы'] as const) : []),
      ]),
    },
    {
      id: 'settings',
      labelKey: 'settings',
      items: nonempty([...(f.showSettings ? (['настройки'] as const) : []), ...(f.showStaff ? (['персонал'] as const) : [])]),
    },
  ];

  const filled = candidates.filter((g) => g.items.length > 0);
  // Cap at 6: keep overview + highest-signal groups.
  if (filled.length <= 6) return filled;
  const priority = ['overview', 'mytasks', 'objects', 'finance', 'maintenance', 'comms', 'settings'];
  const ranked = [...filled].sort(
    (a, b) => priority.indexOf(a.id) - priority.indexOf(b.id),
  );
  return ranked.slice(0, 6).sort((a, b) => priority.indexOf(a.id) - priority.indexOf(b.id));
}

export function buildRoleNavGroups(f: AdminNavFlags): AdminNavGroup[] {
  return f.isComplexAdmin ? buildAdminNavGroups(f) : buildStaffNavGroups(f);
}

/** Same leaf label under Финансы and Коммунальные/учёт (or staff Maintenance). */
export const DUAL_ENTRY_ADMIN_SECTIONS = ['вода', 'электроэнергия', 'интернет'] as const;
export type DualEntryAdminSection = (typeof DUAL_ENTRY_ADMIN_SECTIONS)[number];

export function isDualEntryAdminSection(
  section: string | null | undefined,
): section is DualEntryAdminSection {
  return (
    section === 'вода' || section === 'электроэнергия' || section === 'интернет'
  );
}

/** Finance workplace for dual-entry modules is always `tab=finance`. */
export function isAdminFinanceWorkplaceTab(tab: string | null | undefined): boolean {
  return tab === 'finance';
}

/**
 * Which top-level group owns the dual-entry leaf for the current URL tab.
 * Finance wins only for `tab=finance`; otherwise utilities / maintenance.
 */
export function resolveDualEntryNavGroupId(args: {
  section: string;
  tab: string | null | undefined;
  groups: ReadonlyArray<{ id: string; items: readonly string[] }>;
}): string | null {
  if (!isDualEntryAdminSection(args.section)) return null;
  const preferred = isAdminFinanceWorkplaceTab(args.tab)
    ? (['finance'] as const)
    : (['utilities', 'maintenance'] as const);
  for (const id of preferred) {
    const group = args.groups.find((g) => g.id === id && g.items.includes(args.section));
    if (group) return group.id;
  }
  return null;
}

/** Active leaf = section match, and for dual-entry also the group that matches the tab. */
export function isAdminNavLeafActive(args: {
  section: string;
  groupId: string;
  activeSection: string;
  tab: string | null | undefined;
}): boolean {
  if (args.activeSection !== args.section) return false;
  if (!isDualEntryAdminSection(args.section)) return true;
  const onFinance = isAdminFinanceWorkplaceTab(args.tab);
  if (args.groupId === 'finance') return onFinance;
  if (args.groupId === 'utilities' || args.groupId === 'maintenance') return !onFinance;
  return !onFinance;
}
