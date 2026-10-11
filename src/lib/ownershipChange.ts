import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { OwnershipTargetOwner } from '@/lib/ownership';

export const OWNERSHIP_CHANGE_REASONS = [
  'sale',
  'donation',
  'partial_transfer',
  'inheritance',
  'correction',
  'other',
] as const;

export type OwnershipChangeReason = (typeof OWNERSHIP_CHANGE_REASONS)[number];

export type RosterOwnerForm = {
  key: string;
  entity_kind: OwnershipTargetOwner['entity_kind'];
  first_name: string;
  middle_name: string;
  last_name: string;
  entity_name: string;
  eik_bulstat: string;
  email: string;
  ownership_share_percent: string;
  ideal_parts_percent: string;
};

export function newRosterOwnerKey() {
  return `o-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyRosterOwner(idealParts = ''): RosterOwnerForm {
  return {
    key: newRosterOwnerKey(),
    entity_kind: 'natural_person',
    first_name: '',
    middle_name: '',
    last_name: '',
    entity_name: '',
    eik_bulstat: '',
    email: '',
    ownership_share_percent: '',
    ideal_parts_percent: idealParts,
  };
}

export function targetOwnersToForms(owners: OwnershipTargetOwner[] | null | undefined): RosterOwnerForm[] {
  if (!owners?.length) return [emptyRosterOwner()];
  return owners.map((o) => ({
    key: newRosterOwnerKey(),
    entity_kind: o.entity_kind,
    first_name: o.first_name ?? '',
    middle_name: o.middle_name ?? '',
    last_name: o.last_name ?? '',
    entity_name: o.entity_name ?? '',
    eik_bulstat: o.eik_bulstat ?? '',
    email: o.email ?? '',
    ownership_share_percent: String(o.ownership_share_percent ?? ''),
    ideal_parts_percent: String(o.ideal_parts_percent ?? ''),
  }));
}

export function formsToTargetOwners(forms: RosterOwnerForm[]): OwnershipTargetOwner[] {
  return forms.map((f) => {
    const share = Number(f.ownership_share_percent);
    const ideal = Number(f.ideal_parts_percent);
    if (f.entity_kind === 'legal_entity') {
      return {
        entity_kind: 'legal_entity',
        entity_name: f.entity_name.trim(),
        eik_bulstat: f.eik_bulstat.trim() || null,
        email: f.email.trim().toLowerCase(),
        ownership_share_percent: share,
        ideal_parts_percent: ideal,
      };
    }
    return {
      entity_kind: f.entity_kind,
      first_name: f.first_name.trim(),
      middle_name: f.middle_name.trim() || null,
      last_name: f.last_name.trim(),
      email: f.email.trim().toLowerCase(),
      ownership_share_percent: share,
      ideal_parts_percent: ideal,
    };
  });
}

export type RosterValidation = {
  ok: boolean;
  shareSum: number;
  idealSum: number;
  errors: string[];
};

/** Client-side mirror of ownership_change_validate_owners (server remains authoritative). */
export function validateRosterForms(
  forms: RosterOwnerForm[],
  propertyIdealParts: number
): RosterValidation {
  const errors: string[] = [];
  if (forms.length < 1) errors.push('empty');

  let shareSum = 0;
  let idealSum = 0;

  for (const f of forms) {
    const email = f.email.trim().toLowerCase();
    if (!email || !email.includes('@')) errors.push('email');
    const share = Number(f.ownership_share_percent);
    const ideal = Number(f.ideal_parts_percent);
    if (!Number.isFinite(share) || share <= 0) errors.push('share');
    if (!Number.isFinite(ideal) || ideal < 0) errors.push('ideal');
    if (f.entity_kind === 'legal_entity') {
      if (!f.entity_name.trim()) errors.push('entity_name');
    } else if (!f.first_name.trim() || !f.last_name.trim()) {
      errors.push('name');
    }
    shareSum += Number.isFinite(share) ? share : 0;
    idealSum += Number.isFinite(ideal) ? ideal : 0;
  }

  if (Math.abs(shareSum - 100) > 0.001) errors.push('share_total');
  if (Math.abs(idealSum - propertyIdealParts) > 0.001) errors.push('ideal_total');

  return {
    ok: errors.length === 0,
    shareSum,
    idealSum,
    errors: [...new Set(errors)],
  };
}

type PostgrestErrParts = {
  code: string;
  message: string;
  details: string;
  hint: string;
};

function postgrestErrParts(err: unknown): PostgrestErrParts {
  const obj = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
  const message =
    obj && 'message' in obj
      ? String(obj.message ?? '')
      : err instanceof Error
        ? err.message
        : String(err ?? '');
  return {
    code: obj && 'code' in obj ? String(obj.code ?? '') : '',
    message,
    details: obj && 'details' in obj ? String(obj.details ?? '') : '',
    hint: obj && 'hint' in obj ? String(obj.hint ?? '') : '',
  };
}

function rpcNameFromMessage(message: string): string | null {
  const m = message.match(/function public\.([a-zA-Z0-9_]+)/i);
  return m?.[1] ?? null;
}

/**
 * True only when PostgREST reports the RPC is absent from the schema cache.
 * Not true for: permission denied, signature/arity mismatch, JWT/network, or SQL business errors.
 */
export function isMissingRpcError(err: unknown): boolean {
  const { code, message, details, hint } = postgrestErrParts(err);

  // EXECUTE denied ⇒ function is present in the catalog/schema cache.
  if (code === '42501' || /permission denied for function/i.test(message)) {
    return false;
  }

  const looksLikeMissing =
    code === 'PGRST202' ||
    /Could not find the function/i.test(message) ||
    /function .* does not exist/i.test(message) ||
    /PGRST202/i.test(message);

  if (!looksLikeMissing) return false;

  const searched = rpcNameFromMessage(message);
  // Same function name in hint ⇒ wrong args/arity, not undeployed migrations.
  if (searched && new RegExp(`function public\\.${searched}\\(`, 'i').test(hint)) {
    return false;
  }
  // Parameterized RPC called with no/undefined args → "without parameters" PGRST202.
  // The zero-arg overload is absent, but the real RPC may still be deployed.
  if (
    searched &&
    (/without parameters/i.test(message) || /without parameters/i.test(details)) &&
    !hint
  ) {
    return false;
  }

  return true;
}

function classifyProbeError(err: unknown | null): 'ready' | 'missing' | 'unknown' {
  if (!err) return 'ready';
  const { code, message } = postgrestErrParts(err);
  // Presence proofs — never show the migration banner.
  if (code === '42501' || /permission denied for function/i.test(message)) {
    return 'ready';
  }
  if (isMissingRpcError(err)) return 'missing';
  return 'unknown';
}

/**
 * Probe core PKG-XFER RPCs. Show migration UI only when result is `missing`.
 * Owner probe uses read-only overdue_debt (never submit/cancel). Admin probe uses
 * pending-count (non-mutating; non-admin simply receives 0).
 */
export async function probePkgXferRpcAvailability(
  supabase: SupabaseClient<Database>,
  opts: { role: 'owner'; propertyId: number } | { role: 'admin' }
): Promise<'ready' | 'missing' | 'unknown'> {
  try {
    if (opts.role === 'admin') {
      const { error } = await supabase.rpc('admin_pending_ownership_change_count');
      return classifyProbeError(error);
    }

    const propertyId = Number(opts.propertyId);
    // Invalid args would produce PGRST202 signature misses — never claim RPCs missing.
    if (!Number.isFinite(propertyId) || propertyId <= 0) {
      return 'unknown';
    }

    const { error } = await supabase.rpc('ownership_change_overdue_debt', {
      p_property_id: propertyId,
    });
    const status = classifyProbeError(error);
    if (status !== 'missing') return status;

    // Guard against false PGRST202: settings table is created by the same migrations.
    const settings = await supabase
      .from('ownership_change_settings')
      .select('id')
      .eq('id', 1)
      .maybeSingle();
    if (!settings.error && settings.data) return 'ready';
    return 'missing';
  } catch (err) {
    return classifyProbeError(err);
  }
}
