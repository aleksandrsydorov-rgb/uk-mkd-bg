/** Security (Охрана) module helpers — UX + types. RPCs are the security boundary. */

export const SECURITY_REQUEST_KINDS = ['guest_pass', 'delivery', 'handover'] as const;
export type SecurityRequestKind = (typeof SECURITY_REQUEST_KINDS)[number];

export const SECURITY_REQUEST_STATUSES = [
  'pending',
  'seen',
  'at_post',
  'done',
  'cancelled',
  'expired',
] as const;
export type SecurityRequestStatus = (typeof SECURITY_REQUEST_STATUSES)[number];

export const SECURITY_DELIVERY_MODES = ['hold_at_post', 'courier_pass'] as const;
export type SecurityDeliveryMode = (typeof SECURITY_DELIVERY_MODES)[number];

export const SECURITY_COMPLETION_MODES = [
  'handed_to_owner',
  'owner_collected',
  'courier_passed',
  'done',
] as const;
export type SecurityCompletionMode = (typeof SECURITY_COMPLETION_MODES)[number];

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
  delivery_mode?: SecurityDeliveryMode | string | null;
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
  accepted_photo_path?: string | null;
  handed_over_photo_path?: string | null;
  completion_mode?: SecurityCompletionMode | string | null;
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
  delivery_mode?: string | null;
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
  completion_mode?: string | null;
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
  delivery_mode?: string | null;
  guest_name: string | null;
  expected_at: string | null;
  courier_name: string | null;
  delivery_note: string | null;
  handover_item: string | null;
  note: string | null;
  created_at: string;
  accepted_at: string | null;
  accepted_photo_path?: string | null;
  handed_over_photo_path?: string | null;
  completion_mode?: string | null;
};

/** Parcel sits at the post until the owner collects / is handed it. */
export function isHoldAtPostFlow(kind: string, deliveryMode?: string | null) {
  if (kind === 'handover') return true;
  if (kind === 'delivery') {
    return (deliveryMode ?? 'hold_at_post') === 'hold_at_post';
  }
  return false;
}

/** Courier goes to the apartment after the guard acknowledges. */
export function isCourierPassFlow(kind: string, deliveryMode?: string | null) {
  return kind === 'delivery' && deliveryMode === 'courier_pass';
}

/** Optional photo steps (receive / complete for parcels). */
export function isParcelGuardFlow(kind: string, deliveryMode?: string | null) {
  return isHoldAtPostFlow(kind, deliveryMode) || isCourierPassFlow(kind, deliveryMode);
}

export const GUARD_QUEUE_KIND_ORDER = ['delivery', 'handover', 'guest_pass'] as const;

export function canSeeSecurityAdmin(role?: string | null) {
  return role === 'администрация';
}

export function isGuardRole(role?: string | null) {
  return role === 'охрана';
}

export function staffHomePath(role?: string | null) {
  return isGuardRole(role) ? '/guard' : '/admin';
}

export function securityStatusTone(status: string): 'warning' | 'info' | 'success' | 'neutral' {
  if (status === 'pending') return 'warning';
  if (status === 'seen' || status === 'at_post' || status === 'accepted') return 'info';
  if (status === 'done' || status === 'handed_over') return 'success';
  return 'neutral';
}
