export type ListingStatus = 'в собственности' | 'на продаже';
export type TransferStatus = 'ожидает' | 'утверждена' | 'отклонена' | 'отменена';
export type OwnershipChangeKind =
  | 'ordinary'
  | 'inheritance'
  | 'admin_initiated'
  | 'correction_link'
  | 'entity_person';

export type OwnershipTargetOwner = {
  entity_kind: 'natural_person' | 'legal_entity' | 'sole_trader';
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  entity_name?: string | null;
  eik_bulstat?: string | null;
  email: string;
  ownership_share_percent: number;
  ideal_parts_percent: number;
};

export interface OwnerTransfer {
  id: number;
  created_at: string;
  property_id: number;
  from_owner_name: string | null;
  from_owner_email: string | null;
  from_owner_phone: string | null;
  to_owner_name: string;
  to_owner_email: string;
  to_owner_phone: string | null;
  note: string | null;
  status: TransferStatus | string;
  decided_at: string | null;
  decided_by: string | null;
  reject_reason: string | null;
  change_kind?: OwnershipChangeKind | string | null;
  change_reason?: string | null;
  initiated_by?: 'owner' | 'admin' | string | null;
  document_type?: string | null;
  document_number?: string | null;
  document_date?: string | null;
  supporting_document_path?: string | null;
  legal_effective_date?: string | null;
  baseline_owners?: OwnershipTargetOwner[] | null;
  baseline_roster_hash?: string | null;
  target_owners?: OwnershipTargetOwner[] | null;
  submitted_by_email?: string | null;
  cancelled_at?: string | null;
  cancelled_by_email?: string | null;
  corrects_transfer_id?: number | null;
  debt_check_result?: Record<string, unknown> | null;
  debt_gate_applied?: boolean | null;
}

export function listingStatus(raw: string | null | undefined): ListingStatus {
  if (raw === 'на продаже' || raw === 'for_sale') return 'на продаже';
  return 'в собственности';
}

export function listingStatusClass(status: ListingStatus) {
  return status === 'на продаже'
    ? 'border-warning/25 bg-warning-bg text-warning'
    : 'border-success/25 bg-success-bg text-success';
}

export function listingStatusLines(status: ListingStatus): [string, string] {
  if (status === 'на продаже') return ['на', 'продаже'];
  return ['в', 'собственности'];
}

export function transferStatusClass(status: string) {
  if (status === 'утверждена') return 'text-success';
  if (status === 'отклонена') return 'text-danger';
  if (status === 'отменена') return 'text-muted';
  return 'text-warning';
}

export function soleTargetOwner(input: {
  name: string;
  email: string;
  idealPartsPercent: number;
}): OwnershipTargetOwner {
  const parts = input.name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] || 'Owner';
  const last = parts.length >= 2 ? parts.slice(1).join(' ') : first;
  return {
    entity_kind: 'natural_person',
    first_name: first,
    last_name: last,
    email: input.email.trim().toLowerCase(),
    ownership_share_percent: 100,
    ideal_parts_percent: input.idealPartsPercent,
  };
}
