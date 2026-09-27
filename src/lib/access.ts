import { escapeIlike, normalizeEmail } from '@/lib/email';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { isGuardRole, staffHomePath } from '@/lib/security';

export type Property = Database['public']['Tables']['properties']['Row'];

export interface StaffRecord {
  id: number;
  name: string;
  role: string;
  phone: string | null;
  active: boolean | null;
  email?: string | null;
}

export interface AccessProfile {
  email: string;
  properties: Property[];
  guestProperties: Property[];
  staff: StaffRecord | null;
  isStaff: boolean;
  isOwner: boolean;
  isGuest: boolean;
}

export { isGuardRole, staffHomePath };

/** Staff cabinet after login: `/guard` for охрана, otherwise `/admin`. */
export function resolveStaffHome(access: AccessProfile): '/guard' | '/admin' | '/account' {
  if (access.isStaff) return staffHomePath(access.staff?.role);
  if (access.isOwner || access.isGuest) return '/account';
  return '/account';
}

export function mergeAccountProperties(access: AccessProfile): Property[] {
  const ownedIds = new Set(access.properties.map((p) => p.id));
  const guestOnly = access.guestProperties.filter((p) => !ownedIds.has(p.id));
  return [...access.properties, ...guestOnly];
}

export function isGuestOnlyProperty(access: AccessProfile, propertyId: number): boolean {
  if (access.properties.some((p) => p.id === propertyId)) return false;
  return access.guestProperties.some((p) => p.id === propertyId);
}

function isMissingColumn(error: { message?: string } | null | undefined, column: string) {
  const msg = error?.message ?? '';
  return msg.includes(column) || msg.includes('schema cache') || msg.includes('Could not find');
}

function isMissingRpc(error: { message?: string; code?: string } | null | undefined, name: string) {
  const msg = error?.message ?? '';
  return msg.includes(name) || msg.includes('schema cache') || error?.code === 'PGRST202';
}

async function loadOwnedProperties(
  email: string,
  supabase: SupabaseClient<Database>,
): Promise<Property[]> {
  const ownedRes = await supabase.rpc('list_my_owned_properties');
  if (!ownedRes.error) {
    return (ownedRes.data as Property[] | null) ?? [];
  }
  if (!isMissingRpc(ownedRes.error, 'list_my_owned_properties')) {
    throw ownedRes.error;
  }

  const pattern = escapeIlike(email);
  const propsRes = await supabase
    .from('properties')
    .select('*')
    .ilike('owner_email', pattern)
    .order('apartment_number', { ascending: true });
  if (propsRes.error) throw propsRes.error;
  return (propsRes.data as Property[]) ?? [];
}

async function loadGuestProperties(
  supabase: SupabaseClient<Database>,
): Promise<Property[]> {
  const guestRes = await supabase.rpc('list_my_guest_properties');
  if (!guestRes.error) {
    return (guestRes.data as Property[] | null) ?? [];
  }
  if (!isMissingRpc(guestRes.error, 'list_my_guest_properties')) {
    throw guestRes.error;
  }
  return [];
}

export async function resolveAccess(
  emailRaw: string,
  supabase: SupabaseClient<Database>,
): Promise<AccessProfile> {
  const email = normalizeEmail(emailRaw);

  const [properties, guestProperties] = await Promise.all([
    loadOwnedProperties(email, supabase),
    loadGuestProperties(supabase),
  ]);

  let staff: StaffRecord | null = null;
  const staffRes = await supabase
    .from('staff')
    .select('id, name, role, phone, active, email')
    .ilike('email', escapeIlike(email))
    .limit(5);

  if (staffRes.error) {
    if (!isMissingColumn(staffRes.error, 'email')) throw staffRes.error;
  } else {
    const rows = (staffRes.data as StaffRecord[]) ?? [];
    staff = rows.find((s) => s.active === true) ?? null;
  }

  return {
    email,
    properties,
    guestProperties,
    staff,
    isStaff: Boolean(staff),
    isOwner: properties.length > 0,
    isGuest: guestProperties.length > 0,
  };
}
