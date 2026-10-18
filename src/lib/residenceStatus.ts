/**
 * Residence / occupancy helpers.
 * Canonical ownership remains Property Book (property_registry_people).
 * Residence status lives on properties.occupancy_* .
 * module_catalog key `residence_status` is identity/metadata (platform-core; not an occupancy gate).
 */

/** Matches module_catalog.module_key and Email Core residence producers. */
export const RESIDENCE_STATUS_MODULE_KEY = 'residence_status' as const;

export const RESIDENCE_OCCUPANCY_STATUSES = ['owner', 'standby', 'rented'] as const;
export type ResidenceOccupancyStatus = (typeof RESIDENCE_OCCUPANCY_STATUSES)[number];

export function parseResidenceOccupancyStatus(
  raw: string | null | undefined,
): ResidenceOccupancyStatus | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'owner' || v === 'standby' || v === 'rented') return v;
  return null;
}

export type ResidenceSaveInput = {
  occupancy_status: string;
  occupant_until: string | null | undefined;
  effective_from?: string | null | undefined;
};

/**
 * Soft validation for owner/admin residence edits.
 * Does not invent legal residency rules — only technical field coherence.
 */
export function validateResidenceSave(input: ResidenceSaveInput): string[] {
  const errors: string[] = [];
  const status = parseResidenceOccupancyStatus(input.occupancy_status);
  if (!status) {
    errors.push('invalid_occupancy_status');
    return errors;
  }
  const until = (input.occupant_until ?? '').trim();
  if (status === 'rented' && !until) {
    errors.push('rented_requires_until');
  }
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    errors.push('invalid_until_date');
  }
  const from = (input.effective_from ?? '').trim();
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    errors.push('invalid_effective_from');
  }
  if (from && until && from > until) {
    errors.push('effective_from_after_until');
  }
  return errors;
}

/**
 * Guest Mode boundary: guest-only sessions must not mutate residence status.
 * Mirrors account scopeLocked('occupancy') / owner-admin rights.
 */
export function canMutateResidenceStatus(ctx: {
  isOwner: boolean;
  isStaffAdmin: boolean;
  isGuestOnly: boolean;
}): boolean {
  if (ctx.isGuestOnly) return false;
  return ctx.isOwner || ctx.isStaffAdmin;
}

/** Residence is property occupancy — never a parallel ownership SoT. */
export function residenceDoesNotReplacePropertyBook(): true {
  return true;
}
