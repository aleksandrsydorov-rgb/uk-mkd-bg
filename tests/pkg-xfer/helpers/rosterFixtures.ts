import type { RosterOwnerForm } from '@/lib/ownershipChange';
import { emptyRosterOwner } from '@/lib/ownershipChange';

/** Deterministic synthetic owners — never production fixture emails. */
export function ownerForm(partial: Partial<RosterOwnerForm> & Pick<RosterOwnerForm, 'email'>): RosterOwnerForm {
  return {
    ...emptyRosterOwner(),
    key: partial.key ?? `fix-${partial.email}`,
    entity_kind: partial.entity_kind ?? 'natural_person',
    first_name: partial.first_name ?? 'Test',
    middle_name: partial.middle_name ?? '',
    last_name: partial.last_name ?? 'Owner',
    entity_name: partial.entity_name ?? '',
    eik_bulstat: partial.eik_bulstat ?? '',
    email: partial.email,
    ownership_share_percent: partial.ownership_share_percent ?? '100',
    ideal_parts_percent: partial.ideal_parts_percent ?? '1',
  };
}

export function sharedTwoOwners(opts?: {
  shareA?: string;
  shareB?: string;
  idealA?: string;
  idealB?: string;
  propertyIdeal?: number;
}): { forms: RosterOwnerForm[]; propertyIdeal: number } {
  const shareA = opts?.shareA ?? '40';
  const shareB = opts?.shareB ?? '60';
  const idealA = opts?.idealA ?? '0.4';
  const idealB = opts?.idealB ?? '0.6';
  return {
    propertyIdeal: opts?.propertyIdeal ?? 1,
    forms: [
      ownerForm({
        email: 'xfer.auto.a@example.com',
        first_name: 'Auto',
        last_name: 'Alpha',
        ownership_share_percent: shareA,
        ideal_parts_percent: idealA,
      }),
      ownerForm({
        email: 'xfer.auto.b@example.com',
        first_name: 'Auto',
        last_name: 'Beta',
        ownership_share_percent: shareB,
        ideal_parts_percent: idealB,
      }),
    ],
  };
}
