/** Security (Охрана) module helpers — UX + types. RPCs are the security boundary. */

export const SECURITY_REQUEST_KINDS = ['guest_pass', 'delivery', 'handover'] as const;
export type SecurityRequestKind = (typeof SECURITY_REQUEST_KINDS)[number];

export const SECURITY_REQUEST_STATUSES = [
  'pending',
  'accepted',
  'handed_over',
  'cancelled',
  'expired',
] as const;
export type SecurityRequestStatus = (typeof SECURITY_REQUEST_STATUSES)[number];

export const SECURITY_HANDOVER_ITEMS = ['documents', 'keys', 'parcel'] as const;
export type SecurityHandoverItem = (typeof SECURITY_HANDOVER_ITEMS)[number];

export type SecurityPost = {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
  created_at: string;
};

export type SecurityPostOption = {
  id: string;
  name: string;
  sort_order: number;
};

export type SecurityRequest = {
  id: string;
  property_id: number;
  post_id: string;
  kind: SecurityRequestKind | string;
  status: SecurityRequestStatus | string;
  created_by_role: 'owner' | 'admin' | string;
  created_by_email: string;
  guest_id: number | null;
  guest_name: string | null;
  expected_at: string | null;
  courier_name: string | null;
  delivery_note: string | null;
  handover_item: SecurityHandoverItem | string | null;
  note: string | null;
  accepted_by: number | null;
  accepted_at: string | null;
  handed_over_by: number | null;
  handed_over_at: string | null;
  created_at: string;
  updated_at?: string;
};

export type SecurityRequestAdminRow = {
  id: string;
  property_id: number;
  apartment_number: string;
  post_id: string;
  post_name: string;
  kind: string;
  status: string;
  created_by_role: string;
  created_by_email: string;
  guest_name: string | null;
  expected_at: string | null;
  courier_name: string | null;
  delivery_note: string | null;
  handover_item: string | null;
  note: string | null;
  accepted_at: string | null;
  handed_over_at: string | null;
  created_at: string;
};

export type GuardShiftView = {
  shift_id: string;
  post_id: string;
  post_name: string;
  started_at: string;
};

export type GuardQueueRow = {
  id: string;
  property_id: number;
  apartment_number: string;
  post_id: string;
  kind: string;
  status: string;
  guest_name: string | null;
  expected_at: string | null;
  courier_name: string | null;
  delivery_note: string | null;
  handover_item: string | null;
  note: string | null;
  created_at: string;
  accepted_at: string | null;
};

export function canSeeSecurityAdmin(role?: string | null) {
  return role === 'администрация';
}

export function isGuardRole(role?: string | null) {
  return role === 'охрана';
}

export function staffHomePath(role?: string | null) {
  return isGuardRole(role) ? '/guard' : '/admin';
}
