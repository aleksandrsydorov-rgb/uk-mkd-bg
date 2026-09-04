export type ListingStatus = 'в собственности' | 'на продаже';
export type TransferStatus = 'ожидает' | 'утверждена' | 'отклонена';

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
}

export function listingStatus(raw: string | null | undefined): ListingStatus {
  if (raw === 'на продаже' || raw === 'for_sale') return 'на продаже';
  return 'в собственности';
}

export function listingStatusClass(status: ListingStatus) {
  return status === 'на продаже'
    ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
    : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-200';
}

export function listingStatusLines(status: ListingStatus): [string, string] {
  if (status === 'на продаже') return ['на', 'продаже'];
  return ['в', 'собственности'];
}

export function transferStatusClass(status: string) {
  if (status === 'утверждена') return 'text-emerald-300';
  if (status === 'отклонена') return 'text-red-300';
  return 'text-amber-300';
}
