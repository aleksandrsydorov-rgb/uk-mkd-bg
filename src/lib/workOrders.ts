/** Work Orders Phase 1 helpers. UX only — RPCs are the security boundary. */

export const WORK_ORDER_STATUSES = ['open', 'in_progress', 'completed', 'cancelled'] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const WORK_ORDER_PRIORITIES = ['low', 'normal', 'high'] as const;
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];

export const WORK_ORDER_SOURCES = ['request', 'admin'] as const;
export type WorkOrderSource = (typeof WORK_ORDER_SOURCES)[number];

/** Canonical request categories used for worker responsibility scope. */
export const REQUEST_WORK_CATEGORIES = [
  'сантехника',
  'электрика',
  'уборка',
  'отопление',
  'другое',
] as const;
export type RequestWorkCategory = (typeof REQUEST_WORK_CATEGORIES)[number];

export type WorkOrderAdminRow = {
  id: string;
  title: string;
  instructions: string | null;
  status: string;
  priority: string;
  assigned_staff_id: number | null;
  assignee_name: string | null;
  assignee_role: string | null;
  scheduled_for: string | null;
  target_property_id: number | null;
  apartment_number: string | null;
  location_description: string | null;
  source_type: string;
  request_id: number | null;
  request_subject: string | null;
  requester_name: string | null;
  requester_phone: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  completion_note: string | null;
};

export type MyWorkOrderRow = {
  id: string;
  title: string;
  instructions: string | null;
  status: string;
  priority: string;
  scheduled_for: string | null;
  apartment_number: string | null;
  location_description: string | null;
  request_id: number | null;
  request_subject: string | null;
  requester_name: string | null;
  requester_phone: string | null;
  completed_at: string | null;
  completion_note: string | null;
  created_at: string;
};

export type ClaimableRequestRow = {
  request_id: number;
  subject: string | null;
  description: string | null;
  category: string | null;
  priority: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  property_id: number | null;
  apartment_number: string | null;
  created_at: string;
};

export type RequestWorkOrderContext = {
  request_id: number;
  subject: string | null;
  description: string | null;
  category: string | null;
  priority: string | null;
  status: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  property_id: number | null;
  apartment_number: string | null;
  created_at: string;
  work_priority: string;
};

export type StaffWorkProfile = {
  staff_id: number;
  can_self_claim_requests: boolean;
  can_receive_work_orders: boolean;
  categories: string[];
};

export type MyWorkClaimProfile = {
  staff_id: number;
  can_self_claim_requests: boolean;
  can_receive_work_orders: boolean;
  can_see_my_tasks: boolean;
  categories: string[];
};

export function isWorkOrderPriority(value: unknown): value is WorkOrderPriority {
  return (WORK_ORDER_PRIORITIES as readonly string[]).includes(String(value ?? ''));
}

export function canSeeWorkOrdersAdmin(role?: string | null, active?: boolean | null) {
  return active === true && role === 'администрация';
}

/** Nav UX only — server RPCs still enforce access. Prefer can_see_my_tasks from profile when available. */
export function canSeeMyWorkOrders(
  role?: string | null,
  active?: boolean | null,
  claimProfile?: Pick<MyWorkClaimProfile, 'can_see_my_tasks'> | null,
) {
  if (active !== true) return false;
  if (claimProfile?.can_see_my_tasks === true) return true;
  // Legacy bootstrap until staff_work_capabilities rows exist for known worker roles.
  return role === 'уборщик' || role === 'инженер';
}

/** @deprecated Prefer list_work_order_assignees RPC; kept for transitional UX. */
export function isAssignableWorkRole(role?: string | null) {
  return role === 'уборщик' || role === 'инженер';
}

export function workOrderClaimErrorKey(message: string): string | null {
  const m = message.toLowerCase();
  if (m.includes('already taken')) return 'admin.woClaimAlreadyTaken';
  if (m.includes('not in your responsibility')) return 'admin.woClaimNotInResponsibility';
  if (m.includes('no self-claim')) return 'admin.woClaimNoPermission';
  if (m.includes('not claimable')) return 'admin.woClaimNotClaimable';
  if (m.includes('already has an active work order')) return 'admin.woClaimAlreadyTaken';
  return null;
}
