/**
 * Guest invitation action grants — client catalog + mirrors of SQL helpers.
 * Server/RLS remains authoritative.
 */

export const GUEST_ACTION_KEYS = [
  'water.submit_readings',
  'electricity.submit_readings',
  'chat.with_uk',
  'requests.own',
  'security.own',
  'announcements.guest_audience',
  'documents.guest_audience',
  'services.overview',
] as const;

export type GuestActionKey = (typeof GUEST_ACTION_KEYS)[number];

export type GuestActionCategory = 'meters' | 'communication' | 'requests' | 'info' | 'services';

export type GuestPermissions = Partial<Record<GuestActionKey, boolean>>;

export type GrantableGuestAction = {
  action: GuestActionKey;
  module_key: string | null;
  category: GuestActionCategory;
};

const ACTION_MODULE: Record<GuestActionKey, string | null> = {
  'water.submit_readings': 'water',
  'electricity.submit_readings': 'electricity',
  'chat.with_uk': 'chat',
  'requests.own': 'requests',
  'security.own': 'security',
  'announcements.guest_audience': 'announcements',
  'documents.guest_audience': 'building_documents',
  'services.overview': null,
};

const ACTION_CATEGORY: Record<GuestActionKey, GuestActionCategory> = {
  'water.submit_readings': 'meters',
  'electricity.submit_readings': 'meters',
  'chat.with_uk': 'communication',
  'requests.own': 'requests',
  'security.own': 'requests',
  'announcements.guest_audience': 'info',
  'documents.guest_audience': 'info',
  'services.overview': 'services',
};

/** Actions never grantable via ordinary owner invite (server also rejects). */
export const GUEST_FORBIDDEN_ACTIONS = [
  'finance',
  'owner_voting',
  'property_book',
  'property_book_edit',
  'guest_management',
  'paid_obligations',
  'other_apartments',
  'polls',
  'general_meetings',
  'meter_history',
  'meter_balances',
] as const;

export function emptyGuestPermissions(): GuestPermissions {
  return {};
}

export function guestActionModule(action: GuestActionKey): string | null {
  return ACTION_MODULE[action];
}

export function guestActionCategory(action: GuestActionKey): GuestActionCategory {
  return ACTION_CATEGORY[action];
}

export function isGuestActionKey(value: string): value is GuestActionKey {
  return (GUEST_ACTION_KEYS as readonly string[]).includes(value);
}

export function parseGuestPermissions(raw: unknown): GuestPermissions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: GuestPermissions = {};
  for (const key of GUEST_ACTION_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (v === true || v === 'true' || v === 't' || v === 1 || v === '1') out[key] = true;
  }
  return out;
}

export function guestPermissionsSelected(perms: GuestPermissions): GuestActionKey[] {
  return GUEST_ACTION_KEYS.filter((k) => perms[k] === true);
}

export function guestPermissionsNonempty(perms: GuestPermissions): boolean {
  return guestPermissionsSelected(perms).length > 0;
}

export function guestHasLocalAction(
  perms: GuestPermissions | null | undefined,
  action: GuestActionKey,
): boolean {
  return perms?.[action] === true;
}

/** Filter catalog to modules enabled for the complex (owner cannot grant more). */
export function filterGrantableActions(
  enabledModuleKeys: ReadonlySet<string> | readonly string[],
): GrantableGuestAction[] {
  const enabled = enabledModuleKeys instanceof Set ? enabledModuleKeys : new Set(enabledModuleKeys);
  return GUEST_ACTION_KEYS.filter((action) => {
    const mod = ACTION_MODULE[action];
    return mod == null || enabled.has(mod);
  }).map((action) => ({
    action,
    module_key: ACTION_MODULE[action],
    category: ACTION_CATEGORY[action],
  }));
}

export function permissionsPayload(perms: GuestPermissions): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of GUEST_ACTION_KEYS) {
    if (perms[key] === true) out[key] = true;
  }
  return out;
}

export function toggleGuestPermission(
  perms: GuestPermissions,
  action: GuestActionKey,
  on: boolean,
): GuestPermissions {
  const next = { ...perms };
  if (on) next[action] = true;
  else delete next[action];
  return next;
}

/** Legacy client policy: only these were hard-coded allowed before per-invite grants. */
export function legacyGuestCabinetAllows(permission: string): boolean {
  return (
    permission === 'maintenance_requests' ||
    permission === 'security_requests' ||
    permission === 'available_services_overview' ||
    permission === 'guest_chat'
  );
}
