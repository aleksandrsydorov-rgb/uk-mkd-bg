/** Cleaning service module (resident apartment cleaning). UX helpers — RPCs are the boundary. */

export const CLEANING_SERVICE_KINDS = ['standard', 'deep', 'after_guests'] as const;
export type CleaningServiceKind = (typeof CLEANING_SERVICE_KINDS)[number];

export const CLEANING_TIME_SLOTS = ['morning', 'afternoon', 'any'] as const;
export type CleaningTimeSlot = (typeof CLEANING_TIME_SLOTS)[number];

export const CLEANING_ORDER_STATUSES = ['pending', 'confirmed', 'done', 'cancelled'] as const;
export type CleaningOrderStatus = (typeof CLEANING_ORDER_STATUSES)[number];

export type CleaningOrder = {
  id: string;
  property_id: number;
  service_kind: string;
  status: string;
  preferred_date: string | null;
  time_slot: string;
  note: string | null;
  admin_note: string | null;
  created_by_role: string;
  created_by_email: string;
  work_order_id: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
};

export type CleaningOrderAdminRow = CleaningOrder & {
  apartment_number: string | null;
};

export function canSeeCleaningAdmin(role?: string | null) {
  return role === 'администрация';
}

export function cleaningStatusTone(
  status: string,
): 'warning' | 'info' | 'success' | 'danger' | 'neutral' {
  if (status === 'pending') return 'warning';
  if (status === 'confirmed') return 'info';
  if (status === 'done') return 'success';
  if (status === 'cancelled') return 'danger';
  return 'neutral';
}
