/** Presentation helpers for property_change_log — storage/audit unchanged. */

export type PropertyBookHistoryEntry = {
  id: string;
  changed_at: string;
  changed_by_email: string | null;
  entity: string;
  action: string;
  changes: Record<string, unknown>;
  note?: string | null;
};

export type PropertyBookHistoryTranslate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

type DiffPair = { old: unknown; new: unknown };

const FIELD_LABEL_KEYS: Record<string, string> = {
  apartment_number: 'admin.bookHistFieldApt',
  floor: 'admin.bookHistFieldFloor',
  area_sqm: 'admin.bookArea',
  purpose: 'admin.bookPurpose',
  ideal_parts_percent: 'admin.bookIdealParts',
  ideal_parts_source: 'admin.bookIdealSource',
  ideal_parts_note: 'admin.bookIdealNote',
  ideal_parts_meeting_ref: 'admin.bookHistFieldMeetingRef',
  ownership_type: 'admin.bookOwnershipType',
  status: 'admin.bookHistFieldStatus',
  occupancy_status: 'admin.occupancy',
  owner_name: 'admin.bookHistFieldOwnerName',
  owner_email: 'admin.bookHistFieldOwnerEmail',
  owner_phone: 'admin.bookHistFieldOwnerPhone',
  owner_type: 'admin.bookHistFieldOwnerType',
  company_name: 'admin.bookEntityName',
  occupant_kind: 'admin.bookHistFieldOccupantKind',
  occupant_name: 'admin.bookHistFieldOccupantName',
  occupant_phone: 'admin.bookHistFieldOccupantPhone',
  occupant_email: 'admin.bookHistFieldOccupantEmail',
  occupant_until: 'admin.bookHistFieldOccupantUntil',
  pet_info: 'admin.bookHistFieldPet',
  electricity_meter_number: 'admin.bookHistFieldElecMeter',
  relation_type: 'admin.bookHistFieldRelation',
  entity_kind: 'admin.bookEntityKind',
  first_name: 'admin.bookFirstName',
  middle_name: 'admin.bookHistFieldMiddleName',
  last_name: 'admin.bookLastName',
  entity_name: 'admin.bookEntityName',
  eik_bulstat: 'admin.bookEik',
  email: 'admin.bookHistFieldOwnerEmail',
  ownership_share_percent: 'admin.bookShare',
  deregistered_at: 'admin.bookHistFieldDeregistered',
  id: 'admin.bookHistFieldOwnerId',
};

function isDiffPair(v: unknown): v is DiffPair {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v) && ('old' in (v as object) || 'new' in (v as object));
}

function displayScalar(raw: unknown, t: PropertyBookHistoryTranslate): string {
  if (raw == null) return t('admin.bookHistEmptyValue');
  if (typeof raw === 'boolean') return raw ? t('common.yes') : t('common.no');
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return t('admin.bookHistEmptyValue');
    return String(raw);
  }
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s || s === 'null') return t('admin.bookHistEmptyValue');
    if (s === 'sole') return t('admin.bookType_sole');
    if (s === 'shared') return t('admin.bookType_shared');
    if (s === 'natural_person') return t('admin.bookEntity_natural_person');
    if (s === 'legal_entity') return t('admin.bookEntity_legal_entity');
    if (s === 'sole_trader') return t('admin.bookEntity_sole_trader');
    if (s === 'owner') return t('admin.bookHistRelationOwner');
    if (s === 'document') return t('admin.bookHistSrcDocument');
    if (s === 'calculated') return t('admin.bookHistSrcCalculated');
    if (s === 'general_meeting_approved') return t('admin.bookHistSrcMeeting');
    if (s === 'unknown') return t('admin.bookHistSrcUnknown');
    return s;
  }
  if (typeof raw === 'object') {
    try {
      return JSON.stringify(raw);
    } catch {
      return t('admin.bookHistEmptyValue');
    }
  }
  return String(raw);
}

function fieldLabel(key: string, t: PropertyBookHistoryTranslate): string {
  const i18nKey = FIELD_LABEL_KEYS[key];
  return i18nKey ? t(i18nKey) : key.replace(/_/g, ' ');
}

function ownerDisplayName(snapshot: Record<string, unknown>, t: PropertyBookHistoryTranslate): string {
  const entity = displayScalar(snapshot.entity_name, t);
  if (entity !== t('admin.bookHistEmptyValue')) return entity;
  const parts = [snapshot.first_name, snapshot.middle_name, snapshot.last_name]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  if (parts.length) return parts.join(' ');
  const email = displayScalar(snapshot.email, t);
  if (email !== t('admin.bookHistEmptyValue')) return email;
  return t('admin.bookHistOwnerFallback');
}

export function propertyBookHistoryTitle(
  entry: Pick<PropertyBookHistoryEntry, 'entity' | 'action' | 'changes'>,
  apartmentNumber: string | null | undefined,
  t: PropertyBookHistoryTranslate,
): string {
  const apt = String(apartmentNumber ?? '').trim();
  const withApt = Boolean(apt);
  const entity = String(entry.entity || 'property').toLowerCase();
  const action = String(entry.action || 'update').toLowerCase();

  if (entity === 'owner') {
    if (action === 'insert') {
      return withApt
        ? t('admin.bookHistoryTitleOwnerAddApt', { n: apt })
        : t('admin.bookHistoryTitleOwnerAdd');
    }
    if (action === 'delete') {
      return withApt
        ? t('admin.bookHistoryTitleOwnerRemoveApt', { n: apt })
        : t('admin.bookHistoryTitleOwnerRemove');
    }
    if (action === 'replace_owners') {
      return withApt
        ? t('admin.bookHistoryTitleOwnersReplaceApt', { n: apt })
        : t('admin.bookHistoryTitleOwnersReplace');
    }
    return withApt
      ? t('admin.bookHistoryTitleOwnerUpdateApt', { n: apt })
      : t('admin.bookHistoryTitleOwnerUpdate');
  }

  if (entity === 'book') {
    return withApt ? t('admin.bookHistoryTitleBookApt', { n: apt }) : t('admin.bookHistoryTitleBook');
  }

  if (action === 'insert') {
    return withApt ? t('admin.bookHistoryTitlePropertyAdd', { n: apt }) : t('admin.bookHistoryTitlePropertyAddGeneric');
  }
  if (action === 'delete') {
    return withApt
      ? t('admin.bookHistoryTitlePropertyRemove', { n: apt })
      : t('admin.bookHistoryTitlePropertyRemoveGeneric');
  }
  return withApt
    ? t('admin.bookHistoryTitlePropertyUpdate', { n: apt })
    : t('admin.bookHistoryTitlePropertyUpdateGeneric');
}

export function propertyBookHistoryDetails(
  entry: Pick<PropertyBookHistoryEntry, 'entity' | 'action' | 'changes' | 'note'>,
  t: PropertyBookHistoryTranslate,
): string[] {
  const lines: string[] = [];
  const changes = entry.changes && typeof entry.changes === 'object' ? entry.changes : {};

  if ('snapshot' in changes && changes.snapshot && typeof changes.snapshot === 'object') {
    const snap = changes.snapshot as Record<string, unknown>;
    if (String(entry.entity).toLowerCase() === 'owner') {
      lines.push(
        t('admin.bookHistoryDetailOwnerSnapshot', {
          name: ownerDisplayName(snap, t),
        }),
      );
    } else {
      const apt = snap.apartment_number != null ? String(snap.apartment_number) : '';
      if (apt) {
        lines.push(t('admin.bookHistoryDetailAptSnapshot', { n: apt }));
      } else {
        lines.push(t('admin.bookHistoryDetailCreated'));
      }
    }
  } else {
    for (const [key, raw] of Object.entries(changes)) {
      if (key === 'snapshot') continue;
      if (!isDiffPair(raw)) {
        lines.push(`${fieldLabel(key, t)}: ${displayScalar(raw, t)}`);
        continue;
      }
      lines.push(
        t('admin.bookHistoryDetailChange', {
          field: fieldLabel(key, t),
          from: displayScalar(raw.old, t),
          to: displayScalar(raw.new, t),
        }),
      );
    }
  }

  const note = String(entry.note ?? '').trim();
  if (note) lines.push(t('admin.bookHistoryDetailNote', { note }));

  if (lines.length === 0) lines.push(t('admin.bookHistoryDetailGeneric'));
  return lines;
}

export function presentPropertyBookHistoryEntry(
  entry: PropertyBookHistoryEntry,
  apartmentNumber: string | null | undefined,
  t: PropertyBookHistoryTranslate,
): { title: string; details: string[] } {
  return {
    title: propertyBookHistoryTitle(entry, apartmentNumber, t),
    details: propertyBookHistoryDetails(entry, t),
  };
}
