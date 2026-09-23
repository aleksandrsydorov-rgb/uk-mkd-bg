/** Future general-meeting voting must take object weight from here — once per property. */

export type IdealPartsSource =
  | 'document'
  | 'calculated'
  | 'general_meeting_approved'
  | 'unknown';

export type RegistryRelationType = 'owner' | 'user_of_property' | 'household_member' | 'occupant';
export type RegistryEntityKind = 'natural_person' | 'legal_entity' | 'sole_trader';

export interface PropertyRegistryPerson {
  id: number;
  property_id: number;
  relation_type: RegistryRelationType | string;
  entity_kind: RegistryEntityKind | string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  entity_name: string | null;
  eik_bulstat: string | null;
  email: string | null;
  registered_at: string | null;
  deregistered_at: string | null;
  lives_on_property: boolean | null;
  note: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PropertyAbsencePeriod {
  id: number;
  property_id: number;
  person_id: number | null;
  from_date: string;
  to_date: string | null;
  note: string | null;
  source: string | null;
  created_at?: string;
}

export type PropertyIdealPartsVoteShare = {
  propertyId: number;
  idealPartsPercent: number | null;
};

export function idealPartsPercent(raw: number | string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function propertyIdealPartsVoteShare(property: {
  id: number;
  ideal_parts_percent?: number | string | null;
}): PropertyIdealPartsVoteShare {
  return {
    propertyId: property.id,
    idealPartsPercent: idealPartsPercent(property.ideal_parts_percent),
  };
}

export function formatIdealPartsPercent(
  raw: number | string | null | undefined,
  locale: string,
): string | null {
  const n = idealPartsPercent(raw);
  if (n == null) return null;
  const loc = locale === 'en' ? 'en-US' : locale === 'bg' ? 'bg-BG' : 'ru-RU';
  return new Intl.NumberFormat(loc, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(n);
}

export function parseIdealPartsSource(raw: string | null | undefined): IdealPartsSource | null {
  if (
    raw === 'document' ||
    raw === 'calculated' ||
    raw === 'general_meeting_approved' ||
    raw === 'unknown'
  ) {
    return raw;
  }
  return null;
}

export function registryPersonLabel(person: PropertyRegistryPerson): string {
  if (person.entity_kind === 'legal_entity' || person.entity_kind === 'sole_trader') {
    return (person.entity_name ?? '').trim() || '—';
  }
  return [person.first_name, person.middle_name, person.last_name].filter(Boolean).join(' ').trim() || '—';
}

export function isActiveOccupant(person: PropertyRegistryPerson): boolean {
  return person.relation_type === 'occupant' && person.deregistered_at == null;
}

export function objectBookComplete(property: {
  purpose?: string | null;
  area_sqm?: number | null;
  ideal_parts_percent?: number | string | null;
}): boolean {
  return Boolean(
    (property.purpose ?? '').trim() &&
      property.area_sqm != null &&
      Number(property.area_sqm) > 0 &&
      idealPartsPercent(property.ideal_parts_percent) != null,
  );
}
