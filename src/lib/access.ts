import { supabase } from '@/lib/supabaseClient';
import { escapeIlike, normalizeEmail } from '@/lib/session';
import type { Database } from '@/lib/database.types';

export type Property = Database['public']['Tables']['properties']['Row'];

export interface StaffRecord {
  id: number;
  name: string;
  role: string;
  phone: string | null;
  salary_eur: number | null;
  active: boolean;
  email?: string | null;
}

export interface AccessProfile {
  email: string;
  properties: Property[];
  staff: StaffRecord | null;
  isStaff: boolean;
  isOwner: boolean;
}

function isMissingColumn(error: { message?: string } | null | undefined, column: string) {
  const msg = error?.message ?? '';
  return msg.includes(column) || msg.includes('schema cache') || msg.includes('Could not find');
}

export async function resolveAccess(emailRaw: string): Promise<AccessProfile> {
  const email = normalizeEmail(emailRaw);
  const pattern = escapeIlike(email);

  const propsRes = await supabase
    .from('properties')
    .select('*')
    .ilike('owner_email', pattern)
    .order('apartment_number', { ascending: true });

  if (propsRes.error) throw propsRes.error;

  let staff: StaffRecord | null = null;
  const staffRes = await supabase.from('staff').select('*').ilike('email', pattern).limit(5);

  if (staffRes.error) {
    if (!isMissingColumn(staffRes.error, 'email')) throw staffRes.error;
  } else {
    const rows = (staffRes.data as StaffRecord[]) ?? [];
    staff =
      rows.find((s) => s.active !== false) ??
      rows[0] ??
      null;
  }

  const properties = (propsRes.data as Property[]) ?? [];
  return {
    email,
    properties,
    staff,
    isStaff: Boolean(staff),
    isOwner: properties.length > 0,
  };
}
