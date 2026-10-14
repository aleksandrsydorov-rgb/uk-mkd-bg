/**
 * Guest Mode policy helpers (client + unit-test mirror of DB rules).
 * Server/RLS remains authoritative — these never grant access alone.
 */

export const GUEST_RELATION_TYPES = [
  'living_with_owner',
  'co_owner',
  'long_term_tenant',
  'short_term_tenant',
] as const;

export type GuestRelationType = (typeof GUEST_RELATION_TYPES)[number];

export const GUEST_MAX_ACTIVE_PER_PROPERTY = 2;

export type ChatSenderKind = 'owner' | 'guest' | 'uk';

export type GuestCabinetPermission =
  | 'maintenance_requests'
  | 'security_requests'
  | 'available_services_overview'
  | 'guest_chat'
  | 'meter_readings'
  | 'finance'
  | 'owner_voting'
  | 'property_book_edit'
  | 'other_apartments'
  | 'polls'
  | 'announcements'
  | 'general_meetings';

const GUEST_ALLOWED: ReadonlySet<GuestCabinetPermission> = new Set([
  'maintenance_requests',
  'security_requests',
  'available_services_overview',
  'guest_chat',
]);

export function guestCabinetAllows(permission: GuestCabinetPermission): boolean {
  return GUEST_ALLOWED.has(permission);
}

export function canGuestInsertChat(args: {
  isGuestOnlyOnProperty: boolean;
  accessActive: boolean;
  sender: ChatSenderKind;
  guestAccessId: string | null | undefined;
}): boolean {
  return (
    args.isGuestOnlyOnProperty &&
    args.accessActive &&
    args.sender === 'guest' &&
    Boolean(args.guestAccessId)
  );
}

export function canOwnerInsertChat(args: {
  ownsProperty: boolean;
  sender: ChatSenderKind;
}): boolean {
  return args.ownsProperty && args.sender === 'owner';
}

export function canGuestInsertRequest(args: {
  isGuestOnlyOnProperty: boolean;
  accessActive: boolean;
  createdByRole: 'owner' | 'guest' | 'admin' | null | undefined;
}): boolean {
  return (
    args.isGuestOnlyOnProperty &&
    args.accessActive &&
    args.createdByRole === 'guest'
  );
}

export function requiresValidUntil(relationType: string): boolean {
  return relationType === 'short_term_tenant';
}

export function isGuestChatSender(sender: string | null | undefined): boolean {
  return sender === 'guest';
}

export function isResidentChatSender(sender: string | null | undefined): boolean {
  return sender === 'owner' || sender === 'guest';
}

export function chatSenderSide(
  sender: string | null | undefined,
  viewer: 'resident' | 'staff',
): 'self' | 'other' {
  if (viewer === 'staff') {
    return sender === 'uk' ? 'self' : 'other';
  }
  return isResidentChatSender(sender) ? 'self' : 'other';
}

export type GuestAccessContext = {
  access_id: string;
  property_id: number;
  apartment_number: string | null;
  relation_type: string;
  valid_from: string;
  valid_until: string | null;
  email: string;
};

export function pickGuestAccessForProperty(
  contexts: GuestAccessContext[],
  propertyId: number,
): GuestAccessContext | null {
  return contexts.find((c) => c.property_id === propertyId) ?? null;
}

/** Active counting rule mirrored by DB trigger + RPC. */
export function wouldExceedGuestLimit(activeCount: number, adding = 1): boolean {
  return activeCount + adding > GUEST_MAX_ACTIVE_PER_PROPERTY;
}

export function isGuestAccessTemporallyValid(args: {
  status: string;
  validFrom: string | Date;
  validUntil: string | Date | null;
  now?: Date;
}): boolean {
  if (args.status !== 'active') return false;
  const now = args.now ?? new Date();
  const from = new Date(args.validFrom);
  if (Number.isNaN(from.getTime()) || from > now) return false;
  if (args.validUntil == null) return true;
  const until = new Date(args.validUntil);
  if (Number.isNaN(until.getTime())) return false;
  return until >= now;
}
