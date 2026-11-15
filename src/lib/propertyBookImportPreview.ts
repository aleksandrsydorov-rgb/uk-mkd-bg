/**
 * Property Book import preview presentation — section breakdown, issue grouping,
 * localized operator-facing copy. Storage / RPC codes stay machine-stable.
 */

import {
  normalizePropertyBookApartmentNumber,
  normalizePropertyBookBlockCode,
  normalizePropertyBookSectionCode,
  propertyBookIdentityParts,
} from '@/lib/propertyBookIdentity';
import type { FirstRunErrorRow } from '@/lib/firstRun';

export type BookPreviewObjectRow = {
  apartment_number?: string | null;
  section_code?: string | null;
  block_code?: string | null;
  ownership_type?: string | null;
  purpose?: string | null;
  area_sqm?: string | null;
  ideal_parts_percent?: string | null;
  _row?: string | number | null;
  /** Actual workbook sheet title from the uploaded file. */
  _sheet?: string | null;
};

export type BookPreviewOwnerRow = {
  apartment_number?: string | null;
  section_code?: string | null;
  block_code?: string | null;
  entity_kind?: string | null;
  /** Legacy owners sheets may still carry apartment-level ownership_type. */
  ownership_type?: string | null;
  _row?: string | number | null;
  /** Actual workbook sheet title from the uploaded file. */
  _sheet?: string | null;
};

export type BookSectionBucket = {
  sectionCode: string;
  blockCode: string;
  labelKey: 'withBlock' | 'sectionOnly' | 'blockOnly' | 'plain';
  apartments: Array<{
    apartmentNumber: string;
    objectRow: number | null;
    ownershipTypeMissing: boolean;
  }>;
};

export type BookPreviewIssue = {
  severity: 'error' | 'warning';
  /** Stable machine reason code */
  reason: string;
  sheet: string;
  field: string;
  apartment: string;
  sectionCode: string;
  blockCode: string;
  /** Excel rows covered by this grouped issue */
  rows: number[];
  /** Distinct sections where this apartment number appears in the Objects sheet */
  candidateSections: string[];
  /** Raw invalid value when relevant (e.g. bad entity_kind) */
  value: string;
};

export type TFn = (key: string, params?: Record<string, string | number>) => string;

function asIdentityRow(
  row: BookPreviewObjectRow | BookPreviewOwnerRow,
): Record<string, string | null | undefined> {
  return row as Record<string, string | null | undefined>;
}

function rowNum(raw: string | number | null | undefined): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/** Compact Excel row ranges: [2,3,4,80] → "2–4, 80" */
export function formatExcelRowRanges(rows: number[]): string {
  const sorted = [...new Set(rows.filter((n) => Number.isFinite(n) && n > 0))]
    .map((n) => Math.trunc(n))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return '';
  const parts: string[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;
  for (let i = 1; i < sorted.length; i += 1) {
    const n = sorted[i]!;
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}–${prev}`);
    start = n;
    prev = n;
  }
  parts.push(start === prev ? String(start) : `${start}–${prev}`);
  return parts.join(', ');
}

/** Operator label: «Подъезд Б · ап. №8» / with block when present. */
export function formatBookApartmentRef(
  t: TFn,
  parts: { apartmentNumber: string; sectionCode?: string; blockCode?: string },
): string {
  const apt = parts.apartmentNumber || '—';
  const section = (parts.sectionCode || '').trim();
  const block = (parts.blockCode || '').trim();
  if (section && block) {
    return t('admin.bookPreviewAptRefSectionBlock', {
      section,
      block,
      apt,
    });
  }
  if (section) {
    return t('admin.bookPreviewAptRefSection', { section, apt });
  }
  if (block) {
    return t('admin.bookPreviewAptRefBlock', { block, apt });
  }
  return t('admin.bookPreviewAptRefPlain', { apt });
}

/** Owner-count mismatch location: «Подъезд Б, квартира №15». */
export function formatOwnerCountLocation(
  t: TFn,
  parts: { apartmentNumber: string; sectionCode?: string; blockCode?: string },
): string {
  const apt = parts.apartmentNumber || '—';
  const section = (parts.sectionCode || '').trim();
  const block = (parts.blockCode || '').trim();
  if (section && block) {
    return t('admin.bookOwnerCountLocSectionBlock', { section, block, apt });
  }
  if (section) {
    return t('admin.bookOwnerCountLocSection', { section, apt });
  }
  if (block) {
    return t('admin.bookOwnerCountLocBlock', { block, apt });
  }
  return t('admin.bookOwnerCountLocPlain', { apt });
}

export function buildBookSectionBreakdown(
  objects: BookPreviewObjectRow[],
): { total: number; sections: BookSectionBucket[] } {
  const map = new Map<string, BookSectionBucket>();
  for (const raw of objects) {
    const parts = propertyBookIdentityParts(asIdentityRow(raw));
    if (!parts.apartmentNumber) continue;
    const key = `${parts.sectionCode.toLowerCase()}\u0001${parts.blockCode.toLowerCase()}`;
    let bucket = map.get(key);
    if (!bucket) {
      const labelKey: BookSectionBucket['labelKey'] =
        parts.sectionCode && parts.blockCode
          ? 'withBlock'
          : parts.sectionCode
            ? 'sectionOnly'
            : parts.blockCode
              ? 'blockOnly'
              : 'plain';
      bucket = {
        sectionCode: parts.sectionCode,
        blockCode: parts.blockCode,
        labelKey,
        apartments: [],
      };
      map.set(key, bucket);
    }
    bucket.apartments.push({
      apartmentNumber: parts.apartmentNumber,
      objectRow: rowNum(raw._row),
      ownershipTypeMissing: !String(raw.ownership_type ?? '').trim(),
    });
  }
  const sections = [...map.values()].sort((a, b) => {
    const sa = a.sectionCode.localeCompare(b.sectionCode, 'en', { sensitivity: 'base' });
    if (sa !== 0) return sa;
    return a.blockCode.localeCompare(b.blockCode, 'en', { sensitivity: 'base' });
  });
  for (const s of sections) {
    s.apartments.sort((a, b) =>
      a.apartmentNumber.localeCompare(b.apartmentNumber, undefined, { numeric: true }),
    );
  }
  const total = sections.reduce((n, s) => n + s.apartments.length, 0);
  return { total, sections };
}

/** Apt number → distinct section codes from Objects sheet (file-side ambiguity). */
export function apartmentSectionsInObjects(
  objects: BookPreviewObjectRow[],
): Map<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const raw of objects) {
    const apt = normalizePropertyBookApartmentNumber(raw.apartment_number).toLowerCase();
    if (!apt) continue;
    const section = normalizePropertyBookSectionCode(raw.section_code);
    const set = map.get(apt) ?? new Set<string>();
    if (section) set.add(section);
    map.set(apt, set);
  }
  const out = new Map<string, string[]>();
  for (const [apt, set] of map) {
    out.set(
      apt,
      [...set].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
    );
  }
  return out;
}

function issueGroupKey(row: FirstRunErrorRow & { meta?: Record<string, unknown> }): string {
  const sections = Array.isArray(row.meta?.candidateSections)
    ? [...(row.meta!.candidateSections as string[])].sort().join(',')
    : '';
  return [
    row.severity,
    row.reason,
    row.sheet,
    row.field,
    row.apartment.toLowerCase(),
    String(row.meta?.sectionCode ?? ''),
    String(row.meta?.blockCode ?? ''),
    sections,
    String(row.meta?.value ?? ''),
  ].join('|');
}

function ownershipTypeKey(parts: {
  apartmentNumber: string;
  sectionCode: string;
  blockCode: string;
}): string {
  return [
    parts.apartmentNumber.toLowerCase(),
    parts.sectionCode.toLowerCase(),
    parts.blockCode.toLowerCase(),
  ].join('\u0001');
}

/** Positive whole owner-count from a cell (number or text like "2" / "2.0"). */
export function parsePositiveOwnerCount(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 1) return null;
    if (!Number.isInteger(raw)) return null;
    return raw;
  }
  if (typeof raw === 'boolean') return null;
  const s = String(raw)
    .trim()
    .replace(/\u00a0/g, ' ')
    .replace(',', '.');
  if (!s) return null;
  if (!/^\d+(\.0+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) return null;
  return n;
}

/**
 * Exact declared owner count when the cell carries a number or sole (=1).
 * Legacy “shared” / “Multiple owners” has no exact N → null.
 * Empty → null.
 */
export function parseDeclaredOwnerCount(raw: unknown): number | null {
  if (raw == null) return null;
  const asNum = parsePositiveOwnerCount(raw);
  if (asNum != null) return asNum;
  const type = normalizeOwnershipType(raw == null ? '' : String(raw));
  if (type === 'sole') return 1;
  return null;
}

/**
 * Normalize apartment-level ownership count from template / legacy files.
 * Accepts 1 / 2 / 3…, sole/shared, and localized “One owner” / “Multiple owners”.
 */
export function normalizeOwnershipType(raw: string | null | undefined): 'sole' | 'shared' | '' {
  if (raw == null) return '';
  const asNum = parsePositiveOwnerCount(raw);
  if (asNum === 1) return 'sole';
  if (asNum != null && asNum >= 2) return 'shared';
  const type = String(raw)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ');
  if (!type) return '';
  if (
    type === 'sole' ||
    type === 'one owner' ||
    type === 'один владелец' ||
    type === 'един собственик' ||
    type === 'единоличная' ||
    type === 'еднолична'
  ) {
    return 'sole';
  }
  if (
    type === 'shared' ||
    type === 'multiple owners' ||
    type === 'несколько владельцев' ||
    type === 'няколко собственици' ||
    type === 'совместная' ||
    type === 'долевая' ||
    type === 'съвместна' ||
    type === 'дялова'
  ) {
    return 'shared';
  }
  return '';
}

/**
 * Coerce a parsed ownership_type cell.
 * Positive integers stay as "1"/"2"/"3…" so count checks keep the declared N.
 * Legacy labels become sole/shared. Unknown non-empty text is kept for errors.
 */
export function coerceOwnershipTypeField(raw: unknown): string {
  if (raw == null) return '';
  const asNum = parsePositiveOwnerCount(raw);
  if (asNum != null) return String(asNum);
  const asText = String(raw).trim();
  if (!asText) return '';
  const normalized = normalizeOwnershipType(asText);
  if (normalized) return normalized;
  return asText;
}

/**
 * Owners-sheet rows: same apartment identity must not mix sole/shared
 * or different declared owner counts (e.g. 2 vs 3).
 * Returns blocking rows with all conflicting Excel line numbers.
 */
export function ownersOwnershipTypeConflictRows(
  owners: BookPreviewOwnerRow[],
): FirstRunErrorRow[] {
  const byKey = new Map<
    string,
    {
      apt: string;
      section: string;
      block: string;
      types: Set<string>;
      counts: Set<number>;
      rows: number[];
    }
  >();
  for (const raw of owners) {
    const parts = propertyBookIdentityParts(asIdentityRow(raw));
    if (!parts.apartmentNumber) continue;
    const type = normalizeOwnershipType(raw.ownership_type);
    const count = parseDeclaredOwnerCount(raw.ownership_type);
    if (!type && count == null) continue;
    const key = ownershipTypeKey(parts);
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        apt: parts.apartmentNumber,
        section: parts.sectionCode,
        block: parts.blockCode,
        types: new Set(),
        counts: new Set(),
        rows: [],
      };
      byKey.set(key, entry);
    }
    if (type) entry.types.add(type);
    if (count != null) entry.counts.add(count);
    const r = rowNum(raw._row);
    if (r != null) entry.rows.push(r);
  }
  const out: FirstRunErrorRow[] = [];
  for (const entry of byKey.values()) {
    const countConflict = entry.counts.size >= 2;
    const typeConflict = entry.types.size >= 2;
    if (!countConflict && !typeConflict) continue;
    const rows = [...new Set(entry.rows)].sort((a, b) => a - b);
    out.push({
      sheet: 'owners',
      row: rows[0] != null ? String(rows[0]) : '',
      field: 'ownership_type',
      reason: countConflict ? 'owner_count_conflict' : 'ownership_type_conflict',
      apartment: entry.apt,
      severity: 'error',
      meta: {
        sectionCode: entry.section,
        blockCode: entry.block,
        sourceRows: rows,
        value: countConflict
          ? [...entry.counts].sort((a, b) => a - b).join('/')
          : [...entry.types].sort().join('/'),
      },
    });
  }
  return out;
}

/**
 * When a full owner list declares N owners for an apartment, the file must
 * contain exactly N owner rows for that apartment. Blank count = partial update
 * (skip this check). Legacy “shared” without a number also skips exact match.
 */
export function ownersOwnerCountMismatchRows(
  owners: BookPreviewOwnerRow[],
): FirstRunErrorRow[] {
  const byKey = new Map<
    string,
    {
      apt: string;
      section: string;
      block: string;
      counts: Set<number>;
      rows: number[];
      rowCount: number;
    }
  >();
  for (const raw of owners) {
    const parts = propertyBookIdentityParts(asIdentityRow(raw));
    if (!parts.apartmentNumber) continue;
    const key = ownershipTypeKey(parts);
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        apt: parts.apartmentNumber,
        section: parts.sectionCode,
        block: parts.blockCode,
        counts: new Set(),
        rows: [],
        rowCount: 0,
      };
      byKey.set(key, entry);
    }
    entry.rowCount += 1;
    const count = parseDeclaredOwnerCount(raw.ownership_type);
    if (count != null) entry.counts.add(count);
    const r = rowNum(raw._row);
    if (r != null) entry.rows.push(r);
  }
  const out: FirstRunErrorRow[] = [];
  for (const entry of byKey.values()) {
    if (entry.counts.size !== 1) continue;
    const declared = [...entry.counts][0]!;
    if (declared === entry.rowCount) continue;
    const rows = [...new Set(entry.rows)].sort((a, b) => a - b);
    out.push({
      sheet: 'owners',
      row: rows[0] != null ? String(rows[0]) : '',
      field: 'ownership_type',
      reason: 'owner_count_mismatch',
      apartment: entry.apt,
      severity: 'error',
      meta: {
        sectionCode: entry.section,
        blockCode: entry.block,
        sourceRows: rows,
        declared,
        actual: entry.rowCount,
        value: `${declared}/${entry.rowCount}`,
      },
    });
  }
  return out;
}

/**
 * Combined legacy workbook: Objects-sheet type vs Owners-sheet type for the same
 * apartment (section/block). Conflict blocks owners commit until resolved.
 */
export function objectsOwnersOwnershipTypeConflictRows(
  objectsFromFile: BookPreviewObjectRow[],
  owners: BookPreviewOwnerRow[],
): FirstRunErrorRow[] {
  const ownerTypeByKey = new Map<
    string,
    { apt: string; section: string; block: string; type: string; rows: number[] }
  >();
  for (const raw of owners) {
    const parts = propertyBookIdentityParts(asIdentityRow(raw));
    if (!parts.apartmentNumber) continue;
    const type = normalizeOwnershipType(raw.ownership_type);
    if (!type) continue;
    const key = ownershipTypeKey(parts);
    const prev = ownerTypeByKey.get(key);
    const r = rowNum(raw._row);
    if (!prev) {
      ownerTypeByKey.set(key, {
        apt: parts.apartmentNumber,
        section: parts.sectionCode,
        block: parts.blockCode,
        type,
        rows: r != null ? [r] : [],
      });
      continue;
    }
    if (r != null) prev.rows.push(r);
  }

  const out: FirstRunErrorRow[] = [];
  for (const raw of objectsFromFile) {
    const parts = propertyBookIdentityParts(asIdentityRow(raw));
    if (!parts.apartmentNumber) continue;
    const objType = normalizeOwnershipType(raw.ownership_type);
    if (!objType) continue;
    const key = ownershipTypeKey(parts);
    const owner = ownerTypeByKey.get(key);
    if (!owner || owner.type === objType) continue;
    const objRow = rowNum(raw._row);
    out.push({
      sheet: 'owners',
      row: owner.rows[0] != null ? String(owner.rows[0]) : objRow != null ? String(objRow) : '',
      field: 'ownership_type',
      reason: 'ownership_type_sheet_conflict',
      apartment: parts.apartmentNumber,
      severity: 'error',
      meta: {
        sectionCode: parts.sectionCode,
        blockCode: parts.blockCode,
        sourceRows: [...new Set([...owner.rows, ...(objRow != null ? [objRow] : [])])].sort(
          (a, b) => a - b,
        ),
        value: `${objType}/${owner.type}`,
        objectsValue: objType,
        ownersValue: owner.type,
      },
    });
  }
  return out;
}

/**
 * Resolve apartment-level ownership_type for the owners RPC payload.
 * Priority: consistent owners-sheet value → objects-sheet (legacy combined) → existing stub.
 * Never invents a type when all sources are blank.
 */
export function applyOwnershipTypesToObjects(
  existingObjects: Array<Record<string, string>>,
  opts: {
    owners: BookPreviewOwnerRow[];
    objectsFromFile?: BookPreviewObjectRow[];
  },
): Array<Record<string, string>> {
  const fromOwners = new Map<string, string>();
  for (const raw of opts.owners) {
    const parts = propertyBookIdentityParts(asIdentityRow(raw));
    if (!parts.apartmentNumber) continue;
    const type = normalizeOwnershipType(raw.ownership_type);
    if (!type) continue;
    const key = ownershipTypeKey(parts);
    const prev = fromOwners.get(key);
    if (prev && prev !== type) continue;
    fromOwners.set(key, type);
  }
  const fromObjects = new Map<string, string>();
  for (const raw of opts.objectsFromFile ?? []) {
    const parts = propertyBookIdentityParts(asIdentityRow(raw));
    if (!parts.apartmentNumber) continue;
    const type = normalizeOwnershipType(raw.ownership_type);
    if (!type) continue;
    fromObjects.set(ownershipTypeKey(parts), type);
  }

  return existingObjects.map((obj) => {
    const parts = propertyBookIdentityParts(asIdentityRow(obj));
    if (!parts.apartmentNumber) return obj;
    const key = ownershipTypeKey(parts);
    const ownersType = fromOwners.get(key);
    if (ownersType) return { ...obj, ownership_type: ownersType };
    const objectsType = fromObjects.get(key);
    if (objectsType) {
      const existing = normalizeOwnershipType(obj.ownership_type);
      // Prefer file Objects type when stub empty; keep stub when already filled and file blank on owners.
      if (!existing) return { ...obj, ownership_type: objectsType };
      if (existing === objectsType) return obj;
      // Differing stub vs objects file without owners type: keep stub (DB), objects used only for conflict vs owners.
      return obj;
    }
    return obj;
  });
}

/** All ownership-type / owner-count blocking rows for the owners sub-step preview. */
export function collectOwnersStepOwnershipTypeConflicts(opts: {
  owners: BookPreviewOwnerRow[];
  objectsFromFile?: BookPreviewObjectRow[];
}): FirstRunErrorRow[] {
  return [
    ...ownersOwnershipTypeConflictRows(opts.owners),
    ...ownersOwnerCountMismatchRows(opts.owners),
    ...objectsOwnersOwnershipTypeConflictRows(opts.objectsFromFile ?? [], opts.owners),
  ];
}

/** Count distinct apartment identities that have at least one owner row. */
export function apartmentsWithOwnersCount(owners: BookPreviewOwnerRow[]): number {
  const keys = new Set<string>();
  for (const raw of owners) {
    const parts = propertyBookIdentityParts(asIdentityRow(raw));
    if (!parts.apartmentNumber) continue;
    keys.add(
      [
        parts.apartmentNumber.toLowerCase(),
        parts.sectionCode.toLowerCase(),
        parts.blockCode.toLowerCase(),
      ].join('\u0001'),
    );
  }
  return keys.size;
}

/**
 * Enrich RPC error rows with file context (candidate sections, owner rows)
 * and group identical causes.
 */
export function buildBookPreviewIssues(
  rows: FirstRunErrorRow[],
  opts?: {
    objects?: BookPreviewObjectRow[];
    owners?: BookPreviewOwnerRow[];
  },
): BookPreviewIssue[] {
  const objects = opts?.objects ?? [];
  const owners = opts?.owners ?? [];
  const aptSections = apartmentSectionsInObjects(objects);
  const mergedRows = [
    ...rows,
    ...collectOwnersStepOwnershipTypeConflicts({ owners, objectsFromFile: objects }),
  ];

  const enriched: Array<FirstRunErrorRow & { meta?: Record<string, unknown> }> = mergedRows.map((row) => {
    const meta: Record<string, unknown> = { ...(row.meta ?? {}) };
    const apt = normalizePropertyBookApartmentNumber(row.apartment);
    const aptKey = apt.toLowerCase();
    const candidates = aptSections.get(aptKey) ?? [];

    if (
      row.reason === 'section_code_required_for_disambiguation' ||
      row.reason === 'owner_without_object_row' ||
      row.reason === 'object_row_missing'
    ) {
      if (candidates.length > 1 && !meta.candidateSections) {
        meta.candidateSections = candidates;
      }
      // Prefer owner sheet rows for this bare apartment when section was omitted.
      if ((!Array.isArray(meta.sourceRows) || (meta.sourceRows as number[]).length === 0) && apt) {
        const ownerRows = owners
          .filter((o) => {
            const oApt = normalizePropertyBookApartmentNumber(o.apartment_number).toLowerCase();
            const oSec = normalizePropertyBookSectionCode(o.section_code);
            const oBlock = normalizePropertyBookBlockCode(o.block_code);
            return oApt === aptKey && !oSec && !oBlock;
          })
          .map((o) => rowNum(o._row))
          .filter((n): n is number => n != null);
        if (ownerRows.length) {
          meta.sourceRows = ownerRows;
          if (!row.sheet || row.sheet === 'validation') meta.forceSheet = 'owners';
          if (!row.field || row.field === 'owners') meta.forceField = 'section_code';
          // Ambiguous № in file → treat orphan as section disambiguation, not generic missing object.
          if (candidates.length > 1 && row.reason !== 'section_code_required_for_disambiguation') {
            meta.forceReason = 'section_code_required_for_disambiguation';
          }
        }
      }
    }

    if (row.reason === 'ownership_type_required' || row.reason === 'required:ownership_type') {
      const obj = objects.find((o) => {
        const p = propertyBookIdentityParts(asIdentityRow(o));
        return (
          p.apartmentNumber.toLowerCase() === aptKey &&
          (!meta.sectionCode ||
            p.sectionCode.toLowerCase() === String(meta.sectionCode).toLowerCase())
        );
      });
      if (obj) {
        meta.sectionCode = meta.sectionCode || normalizePropertyBookSectionCode(obj.section_code);
        meta.blockCode = meta.blockCode || normalizePropertyBookBlockCode(obj.block_code);
        const r = rowNum(obj._row);
        if (r != null && !meta.sourceRows) meta.sourceRows = [r];
      }
      // Two-step wizard: type is filled on the owners sub-step.
      if (!row.sheet || row.sheet === 'validation' || row.sheet === 'objects') {
        meta.forceSheet = 'owners';
      }
      if (!row.field) meta.forceField = 'ownership_type';
    }

    if (
      row.reason === 'entity_kind_invalid' ||
      row.reason === 'invalid:entity_kind' ||
      row.reason === 'invalid_entity_kind'
    ) {
      const owner = owners.find((o) => {
        const p = propertyBookIdentityParts(asIdentityRow(o));
        const r = rowNum(o._row);
        const rowMatch = row.row ? r === rowNum(row.row) : true;
        return (
          rowMatch &&
          p.apartmentNumber.toLowerCase() === aptKey &&
          (!meta.sectionCode ||
            p.sectionCode.toLowerCase() === String(meta.sectionCode).toLowerCase())
        );
      });
      if (owner) {
        const p = propertyBookIdentityParts(asIdentityRow(owner));
        meta.sectionCode = meta.sectionCode || p.sectionCode;
        meta.blockCode = meta.blockCode || p.blockCode;
        if (!Array.isArray(meta.sourceRows) || (meta.sourceRows as number[]).length === 0) {
          const r = rowNum(owner._row);
          if (r != null) meta.sourceRows = [r];
        }
        const fileSheet = String(owner._sheet ?? '').trim();
        if (fileSheet) meta.forceSheet = fileSheet;
        if (!meta.value && owner.entity_kind != null && String(owner.entity_kind).trim() !== '') {
          meta.value = String(owner.entity_kind).trim();
        }
      }
      if (!row.field || row.field === 'owners' || row.field === 'validation') {
        meta.forceField = 'entity_kind';
      }
      if (!meta.forceSheet && (!row.sheet || row.sheet === 'validation' || row.sheet === 'objects')) {
        meta.forceSheet = 'owners';
      }
    }

    // Soft owner-field warnings from RPC often lack Excel row / section — attach from file.
    const ownerSoftFieldByReason: Record<string, string> = {
      owner_email_required: 'email',
      owner_share_required: 'ownership_share_percent',
      owner_vote_weight_mismatch: 'ownership_share_percent',
      natural_name_required: 'first_name',
      legal_name_required: 'entity_name',
      eik_required: 'eik_bulstat',
      entity_kind_required: 'entity_kind',
      sole_trader_name_required: 'entity_name',
      ownership_identity_incomplete: 'owners',
      owners_required: 'owners',
      shares_must_sum_100: 'ownership_share_percent',
    };
    if (aptKey && ownerSoftFieldByReason[row.reason]) {
      const matchedOwners = owners.filter((o) => {
        const p = propertyBookIdentityParts(asIdentityRow(o));
        if (p.apartmentNumber.toLowerCase() !== aptKey) return false;
        if (
          meta.sectionCode &&
          p.sectionCode.toLowerCase() !== String(meta.sectionCode).toLowerCase()
        ) {
          return false;
        }
        if (
          meta.blockCode &&
          p.blockCode.toLowerCase() !== String(meta.blockCode).toLowerCase()
        ) {
          return false;
        }
        return true;
      });
      if (matchedOwners.length) {
        const firstOwner = matchedOwners[0]!;
        const first = propertyBookIdentityParts(asIdentityRow(firstOwner));
        meta.sectionCode = meta.sectionCode || first.sectionCode;
        meta.blockCode = meta.blockCode || first.blockCode;
        if (!Array.isArray(meta.sourceRows) || (meta.sourceRows as number[]).length === 0) {
          meta.sourceRows = matchedOwners
            .map((o) => rowNum(o._row))
            .filter((n): n is number => n != null);
        }
        const fileSheet = String(firstOwner._sheet ?? '').trim();
        if (fileSheet) meta.forceSheet = fileSheet;
      } else {
        const obj = objects.find((o) => {
          const p = propertyBookIdentityParts(asIdentityRow(o));
          return p.apartmentNumber.toLowerCase() === aptKey;
        });
        if (obj) {
          const p = propertyBookIdentityParts(asIdentityRow(obj));
          meta.sectionCode = meta.sectionCode || p.sectionCode;
          meta.blockCode = meta.blockCode || p.blockCode;
        }
      }
      if (!row.field || row.field === 'owners') {
        meta.forceField = ownerSoftFieldByReason[row.reason];
      }
      if (!meta.forceSheet && (!row.sheet || row.sheet === 'validation' || row.sheet === 'objects')) {
        meta.forceSheet = 'owners';
      }
    }

    return {
      ...row,
      reason: String(meta.forceReason || row.reason),
      sheet: String(meta.forceSheet || row.sheet),
      field: String(meta.forceField || row.field),
      meta,
    };
  });

  const groups = new Map<string, BookPreviewIssue>();
  for (const row of enriched) {
    const key = issueGroupKey(row);
    const existing = groups.get(key);
    const rowsFromMeta = Array.isArray(row.meta?.sourceRows)
      ? (row.meta!.sourceRows as number[]).filter((n) => Number.isFinite(n))
      : [];
    const single = rowNum(row.row);
    const addRows = rowsFromMeta.length ? rowsFromMeta : single != null ? [single] : [];
    const candidates = Array.isArray(row.meta?.candidateSections)
      ? (row.meta!.candidateSections as string[])
      : [];
    if (existing) {
      existing.rows = [...new Set([...existing.rows, ...addRows])].sort((a, b) => a - b);
      existing.candidateSections = [
        ...new Set([...existing.candidateSections, ...candidates]),
      ].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
      continue;
    }
    groups.set(key, {
      severity: row.severity,
      reason: row.reason,
      sheet: row.sheet,
      field: row.field,
      apartment: row.apartment,
      sectionCode: String(row.meta?.sectionCode ?? ''),
      blockCode: String(row.meta?.blockCode ?? ''),
      rows: [...new Set(addRows)].sort((a, b) => a - b),
      candidateSections: [...candidates].sort((a, b) =>
        a.localeCompare(b, 'en', { sensitivity: 'base' }),
      ),
      value: String(row.meta?.value ?? ''),
    });
  }
  return [...groups.values()].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    const ra = a.rows[0] ?? 0;
    const rb = b.rows[0] ?? 0;
    if (ra !== rb) return ra - rb;
    return a.apartment.localeCompare(b.apartment, undefined, { numeric: true });
  });
}

export function sectionBucketTitle(t: TFn, bucket: BookSectionBucket): string {
  if (bucket.labelKey === 'withBlock') {
    return t('admin.bookPreviewSectionWithBlock', {
      section: bucket.sectionCode,
      block: bucket.blockCode,
      count: bucket.apartments.length,
    });
  }
  if (bucket.labelKey === 'sectionOnly') {
    return t('admin.bookPreviewSectionOnly', {
      section: bucket.sectionCode,
      count: bucket.apartments.length,
    });
  }
  if (bucket.labelKey === 'blockOnly') {
    return t('admin.bookPreviewBlockOnly', {
      block: bucket.blockCode,
      count: bucket.apartments.length,
    });
  }
  return t('admin.bookPreviewSectionPlain', { count: bucket.apartments.length });
}

/** Compact one-line section counts: «A — 36 · Б — 43 · В — 36 · всего 115». */
export function formatSectionCountsLine(
  t: TFn,
  breakdown: { total: number; sections: BookSectionBucket[] },
): string {
  const parts = breakdown.sections.map((s) => {
    if (s.sectionCode) return `${s.sectionCode} — ${s.apartments.length}`;
    if (s.blockCode) return t('admin.bookPreviewBlockOnly', {
      block: s.blockCode,
      count: s.apartments.length,
    });
    return t('admin.bookPreviewSectionPlain', { count: s.apartments.length });
  });
  parts.push(t('admin.bookPreviewSectionsTotal', { n: breakdown.total }));
  return parts.join(' · ');
}

export function isOwnershipTypeClarifyReason(reason: string): boolean {
  const r = reason.trim().toLowerCase();
  return r === 'ownership_type_required' || r === 'required:ownership_type';
}

export type ClarifyIssueGroup = {
  reason: string;
  issues: BookPreviewIssue[];
};

/** Group clarify issues by reason so each cause is summarized once. */
export function groupClarifyIssuesByReason(issues: BookPreviewIssue[]): ClarifyIssueGroup[] {
  const map = new Map<string, BookPreviewIssue[]>();
  for (const issue of issues) {
    const list = map.get(issue.reason) ?? [];
    list.push(issue);
    map.set(issue.reason, list);
  }
  return [...map.entries()].map(([reason, grouped]) => ({ reason, issues: grouped }));
}

export type BookApartmentPreviewStatus = 'error' | 'clarify' | 'ok';

/** One apartment card in the two-step import preview. */
export type BookApartmentPreviewCard = {
  key: string;
  apartment: string;
  sectionCode: string;
  blockCode: string;
  status: BookApartmentPreviewStatus;
  issues: BookPreviewIssue[];
};

/** Rows that could not be tied to an apartment identity. */
export type BookUnlinkedPreviewRow = {
  key: string;
  issue: BookPreviewIssue;
};

function apartmentCardKey(issue: BookPreviewIssue): string | null {
  const apt = (issue.apartment || '').trim();
  if (!apt || apt === '—') return null;
  // Ambiguous № without section stays unlinked until the operator fills section/block.
  if (issue.reason === 'section_code_required_for_disambiguation') return null;
  return [
    apt.toLowerCase(),
    (issue.sectionCode || '').trim().toLowerCase(),
    (issue.blockCode || '').trim().toLowerCase(),
  ].join('\u0001');
}

/**
 * Group preview issues into one card per apartment (section + block) plus
 * unlinked rows (no apartment / ambiguous number).
 */
export function groupBookPreviewByApartment(issues: BookPreviewIssue[]): {
  cards: BookApartmentPreviewCard[];
  unlinked: BookUnlinkedPreviewRow[];
} {
  const byKey = new Map<string, BookApartmentPreviewCard>();
  const unlinked: BookUnlinkedPreviewRow[] = [];
  for (const issue of issues) {
    const key = apartmentCardKey(issue);
    if (!key) {
      unlinked.push({
        key: `unlinked-${issue.reason}-${issue.rows.join(',')}-${issue.field}-${unlinked.length}`,
        issue,
      });
      continue;
    }
    let card = byKey.get(key);
    if (!card) {
      card = {
        key,
        apartment: issue.apartment,
        sectionCode: issue.sectionCode,
        blockCode: issue.blockCode,
        status: 'ok',
        issues: [],
      };
      byKey.set(key, card);
    }
    card.issues.push(issue);
  }
  const cards = [...byKey.values()].map((card) => {
    const collapsed = collapseApartmentCardIssues(card.issues);
    const hasError = collapsed.some((i) => i.severity === 'error');
    const hasWarn = collapsed.some((i) => i.severity === 'warning');
    return {
      ...card,
      status: (hasError ? 'error' : hasWarn ? 'clarify' : 'ok') as BookApartmentPreviewStatus,
      issues: collapsed.sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
        return (a.rows[0] ?? 0) - (b.rows[0] ?? 0);
      }),
    };
  });
  // Final display order is by entrance group + natural apartment number
  // (see groupBookApartmentCardsByEntrance). Keep a stable fallback here.
  cards.sort((a, b) => {
    const sec = (a.sectionCode || '').localeCompare(b.sectionCode || '', 'en', {
      sensitivity: 'base',
    });
    if (sec !== 0) return sec;
    const apt = a.apartment.localeCompare(b.apartment, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    if (apt !== 0) return apt;
    return (a.blockCode || '').localeCompare(b.blockCode || '', 'en', {
      sensitivity: 'base',
    });
  });
  return { cards, unlinked };
}

/** One entrance (section) group in the apartment-card list. */
export type BookApartmentEntranceGroup = {
  key: string;
  sectionCode: string;
  cards: BookApartmentPreviewCard[];
};

/**
 * Group apartment cards by entrance (section). Sort entrances A→… and apartments
 * 1,2,9,10… inside each. Empty section last. Count = unique apartment cards.
 */
export function groupBookApartmentCardsByEntrance(
  cards: BookApartmentPreviewCard[],
): BookApartmentEntranceGroup[] {
  const map = new Map<string, BookApartmentEntranceGroup>();
  for (const card of cards) {
    const section = (card.sectionCode || '').trim();
    const key = section ? section.toLowerCase() : '\u0000';
    let group = map.get(key);
    if (!group) {
      group = { key, sectionCode: section, cards: [] };
      map.set(key, group);
    }
    group.cards.push(card);
  }
  const groups = [...map.values()].sort((a, b) => {
    if (!a.sectionCode && b.sectionCode) return 1;
    if (a.sectionCode && !b.sectionCode) return -1;
    return a.sectionCode.localeCompare(b.sectionCode, 'en', { sensitivity: 'base' });
  });
  for (const group of groups) {
    group.cards.sort((a, b) => {
      const apt = a.apartment.localeCompare(b.apartment, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      if (apt !== 0) return apt;
      return (a.blockCode || '').localeCompare(b.blockCode || '', 'en', {
        sensitivity: 'base',
      });
    });
  }
  return groups;
}

/**
 * Ensure every owner-row apartment appears as a card (status ok when no issues).
 * Multi-owner rows for the same identity stay one card.
 */
export function supplementApartmentCardsFromOwners(
  cards: BookApartmentPreviewCard[],
  owners: Array<Record<string, string | null | undefined>>,
): BookApartmentPreviewCard[] {
  const byKey = new Map(cards.map((c) => [c.key, c]));
  for (const row of owners) {
    const parts = propertyBookIdentityParts(asIdentityRow(row));
    if (!parts.apartmentNumber) continue;
    // Rows without section/block stay out of entrance groups — ambiguous №
    // without секция belongs in the unlinked/blocking list, not as «Без секции».
    if (!parts.sectionCode && !parts.blockCode) continue;
    const key = [
      parts.apartmentNumber.toLowerCase(),
      parts.sectionCode.toLowerCase(),
      parts.blockCode.toLowerCase(),
    ].join('\u0001');
    if (byKey.has(key)) continue;
    byKey.set(key, {
      key,
      apartment: parts.apartmentNumber,
      sectionCode: parts.sectionCode,
      blockCode: parts.blockCode,
      status: 'ok',
      issues: [],
    });
  }
  return [...byKey.values()];
}

/** Slavic/English plural forms for «N квартир(ы/а)» in entrance headers. */
export function formatEntranceApartmentCount(n: number, t: TFn): string {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  let form: 'one' | 'few' | 'many' = 'many';
  if (mod10 === 1 && mod100 !== 11) form = 'one';
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) form = 'few';
  return t(`admin.bookPreviewEntranceAptCount_${form}`, { n: abs });
}

export function formatEntranceGroupTitle(
  group: Pick<BookApartmentEntranceGroup, 'sectionCode' | 'cards'>,
  t: TFn,
): string {
  const countLabel = formatEntranceApartmentCount(group.cards.length, t);
  const section = (group.sectionCode || '').trim();
  if (!section) {
    return t('admin.bookPreviewEntranceGroupPlain', { countLabel });
  }
  return t('admin.bookPreviewEntranceGroup', { section, countLabel });
}

/**
 * Short card heading under an entrance group: «Квартира №2 — Требует уточнения».
 * Block only when present (needed to distinguish identity).
 */
export function formatBookApartmentCardHeading(
  t: TFn,
  card: Pick<BookApartmentPreviewCard, 'apartment' | 'blockCode' | 'status'>,
): string {
  const status =
    card.status === 'error'
      ? t('admin.bookPreviewAptCardStatusError')
      : card.status === 'clarify'
        ? t('admin.bookPreviewAptCardStatusClarify')
        : t('admin.bookPreviewAptCardStatusOk');
  const apt = card.apartment || '—';
  const block = (card.blockCode || '').trim();
  if (block) {
    return t('admin.bookPreviewAptCardTitleWithBlock', { apt, block, status });
  }
  return t('admin.bookPreviewAptCardTitle', { apt, status });
}

/** Soft owner-field codes that mean “will save, need to clarify …” (not identity-only). */
const PARTIAL_OWNER_FIELD_REASONS = new Set([
  'entity_kind_required',
  'owner_share_required',
  'owner_email_required',
  'natural_name_required',
  'legal_name_required',
  'eik_required',
  'sole_trader_name_required',
  'owner_vote_weight_mismatch',
  'ownership_type_required',
  'required:ownership_type',
]);

/** Soft noise suppressed for identity-only apartments (one stub message only). */
const IDENTITY_ONLY_SUPPRESSED = new Set([
  ...PARTIAL_OWNER_FIELD_REASONS,
  'purpose_required',
  'required:purpose',
  'area_required',
  'required:area_sqm',
  'object_ideal_parts_required',
  'required:ideal_parts_percent',
  'ownership_identity_incomplete',
]);

/**
 * One card = unique remarks (no duplicate reasons). Incomplete owner rows with
 * any person/org payload collapse soft field warns into `owner_partial_saved`.
 * Identity-only keeps a single `owners_required` (no count/type/email/share noise).
 */
export function collapseApartmentCardIssues(issues: BookPreviewIssue[]): BookPreviewIssue[] {
  const byReason = new Map<string, BookPreviewIssue>();
  for (const issue of issues) {
    const existing = byReason.get(issue.reason);
    if (!existing) {
      byReason.set(issue.reason, { ...issue, rows: [...issue.rows] });
      continue;
    }
    const rows = new Set([...existing.rows, ...issue.rows]);
    const preferSheet =
      existing.sheet === 'objects' || existing.sheet === 'validation'
        ? issue.sheet || existing.sheet
        : existing.sheet;
    byReason.set(issue.reason, {
      ...existing,
      sheet: preferSheet,
      rows: [...rows].sort((a, b) => a - b),
      severity: existing.severity === 'error' || issue.severity === 'error' ? 'error' : 'warning',
    });
  }

  const list = [...byReason.values()];
  const partials = list.filter((i) => PARTIAL_OWNER_FIELD_REASONS.has(i.reason));
  const hasIdentityOnlyMsg = list.some(
    (i) => i.reason === 'owners_required' || i.reason === 'ownership_identity_incomplete',
  );

  // Identity-only first: one stub message; never mix with count/type/email/share soft noise.
  if (hasIdentityOnlyMsg) {
    const identity =
      byReason.get('owners_required') ?? byReason.get('ownership_identity_incomplete');
    if (!identity) return list;
    const hard = list.filter(
      (i) => i.severity === 'error' && !IDENTITY_ONLY_SUPPRESSED.has(i.reason),
    );
    const sheet =
      (identity.sheet && identity.sheet !== 'objects' && identity.sheet !== 'validation'
        ? identity.sheet
        : null) ||
      list.find((i) => i.sheet && i.sheet !== 'objects' && i.sheet !== 'validation')?.sheet ||
      'owners';
    const rows =
      identity.rows.length > 0
        ? identity.rows
        : [...new Set(list.flatMap((i) => i.rows))].sort((a, b) => a - b);
    return [
      ...hard,
      {
        ...identity,
        reason: 'owners_required',
        sheet,
        rows,
      },
    ];
  }

  // Partial payload: one save notice; keep only hard blocking errors beside it.
  if (partials.length > 0) {
    const rows = [...new Set(partials.flatMap((i) => i.rows))].sort((a, b) => a - b);
    const first = partials[0]!;
    const sheet =
      partials.find((i) => i.sheet && i.sheet !== 'objects' && i.sheet !== 'validation')?.sheet ||
      first.sheet;
    const merged: BookPreviewIssue = {
      severity: 'warning',
      reason: 'owner_partial_saved',
      sheet,
      field: first.field,
      apartment: first.apartment,
      sectionCode: first.sectionCode,
      blockCode: first.blockCode,
      rows,
      candidateSections: first.candidateSections,
      value: partials.map((i) => i.reason).join(','),
    };
    const hard = list.filter(
      (i) =>
        i.severity === 'error' &&
        !PARTIAL_OWNER_FIELD_REASONS.has(i.reason),
    );
    return [...hard, merged];
  }

  return list;
}

/** Prefer a real uploaded sheet title over pseudo codes when presenting. */
export function resolveBookPreviewSheetTitle(issue: BookPreviewIssue, t: TFn): string {
  const raw = (issue.sheet || '').trim();
  if (!raw || raw === 'validation') {
    return t('admin.bookImportSheetOwners');
  }
  const lower = raw.toLowerCase();
  if (lower === 'owners' || lower === 'собственники' || lower === 'собственици') {
    // Keep the file’s own title when it already matches a localized owners sheet.
    if (raw !== 'owners') return raw;
    return t('admin.bookImportSheetOwners');
  }
  if (lower === 'objects' || lower === 'объекты' || lower === 'обекти') {
    if (raw !== 'objects') return raw;
    return t('admin.bookImportSheetObjects');
  }
  return raw;
}

export function clarifyGroupSummary(group: ClarifyIssueGroup, t: TFn): string {
  const n = group.issues.length;
  if (isOwnershipTypeClarifyReason(group.reason)) {
    return t('admin.bookPreviewClarifyOwnershipTypeSummary', { n });
  }
  if (group.reason === 'purpose_required' || group.reason === 'required:purpose') {
    return t('admin.bookPreviewClarifyPurposeSummary', { n });
  }
  if (group.reason === 'area_required' || group.reason === 'required:area_sqm') {
    return t('admin.bookPreviewClarifyAreaSummary', { n });
  }
  if (
    group.reason === 'object_ideal_parts_required' ||
    group.reason === 'required:ideal_parts_percent'
  ) {
    return t('admin.bookPreviewClarifyIdealPartsSummary', { n });
  }
  return t('admin.bookPreviewClarifyGenericSummary', { n, reason: group.reason });
}
