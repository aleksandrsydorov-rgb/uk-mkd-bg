/** Service lock (debt restriction). UX + RPC helpers — assert is the security boundary. */

export const SERVICE_LOCK_SCOPES = [
  'all',
  'requests',
  'chat',
  'polls',
  'water',
  'electricity',
  'internet',
  'occupancy',
  'security',
  'cleaning',
  'elevator',
  'parking',
  'access_control',
] as const;

export type ServiceLockScope = (typeof SERVICE_LOCK_SCOPES)[number];

/** Scopes enforced in app/DB today. Others are selectable for future modules (chip/lift…). */
export const SERVICE_LOCK_LIVE_SCOPES: readonly ServiceLockScope[] = [
  'all',
  'requests',
  'chat',
  'polls',
  'water',
  'electricity',
  'internet',
  'occupancy',
  'security',
  'cleaning',
];

export const SERVICE_LOCK_FUTURE_SCOPES: readonly ServiceLockScope[] = [
  'elevator',
  'parking',
  'access_control',
];

export type PropertyServiceLockView = {
  active: boolean;
  reason_code: string | null;
  locked_at: string | null;
  admin_note: string | null;
  scopes: string[];
};

export type PropertyServiceLockListRow = {
  lock_id: string;
  property_id: number;
  apartment_number: string;
  owner_name: string | null;
  active: boolean;
  reason_code: string;
  admin_note: string | null;
  locked_at: string;
  locked_by_email: string | null;
  scopes: string[];
};

export type PropertyServiceLockEventRow = {
  event_id: string;
  property_id: number;
  apartment_number: string;
  owner_name: string | null;
  lock_id: string | null;
  event_type: 'lock' | 'unlock' | string;
  reason_code: string | null;
  admin_note: string | null;
  actor_email: string | null;
  created_at: string;
  scopes: string[];
};

export function canSeeServiceLockAdmin(role?: string | null) {
  return role === 'администрация';
}

export function firstServiceLock(
  data: PropertyServiceLockView[] | PropertyServiceLockView | null | undefined,
): PropertyServiceLockView {
  const row = !data ? null : Array.isArray(data) ? data[0] ?? null : data;
  return row
    ? {
        active: Boolean(row.active),
        reason_code: row.reason_code ?? null,
        locked_at: row.locked_at ?? null,
        admin_note: row.admin_note ?? null,
        scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
      }
    : { active: false, reason_code: null, locked_at: null, admin_note: null, scopes: [] };
}

export function isScopeLocked(
  scopes: string[] | null | undefined,
  scope: ServiceLockScope | string,
): boolean {
  if (!scopes || scopes.length === 0) return false;
  if (scopes.includes('all')) return true;
  if (scope === 'all') return true;
  return scopes.includes(scope);
}

export function formatServiceLockScopes(
  scopes: string[] | null | undefined,
  labelFor: (key: string) => string,
): string {
  if (!scopes || scopes.length === 0) return '';
  if (scopes.includes('all')) return labelFor('all');
  return scopes.map((s) => labelFor(s)).join(', ');
}
