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
  showWater: boolean;
  showElectricity: boolean;
  showSupportFee: boolean;
  showCapital: boolean;
  showInternet: boolean;
  showElectricityFinance: boolean;
  showExpenses: boolean;
  showBudget: boolean;
  showTariffs: boolean;
  showReporting: boolean;
  showRequests: boolean;
  showWorkOrders: boolean;
  showAnnouncements: boolean;
  showPolls: boolean;
  showChat: boolean;
  showDocuments: boolean;
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
        // Water/electric meters (+ electricity billing tabs inside same section). No parallel ledger.
        ...(f.showElectricity || f.showElectricityFinance ? (['электроэнергия'] as const) : []),
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
      items: nonempty([...(f.showDocuments ? (['документы'] as const) : [])]),
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
        ...(f.showElectricity || f.showElectricityFinance ? (['электроэнергия'] as const) : []),
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
