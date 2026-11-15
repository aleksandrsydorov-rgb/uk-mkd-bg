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
};

export type BookPreviewOwnerRow = {
  apartment_number?: string | null;
  section_code?: string | null;
  block_code?: string | null;
  entity_kind?: string | null;
  /** Legacy owners sheets may still carry apartment-level ownership_type. */
  ownership_type?: string | null;
  _row?: string | number | null;
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
      (row.reason === 'entity_kind_invalid' ||
        row.reason === 'invalid:entity_kind' ||
        row.reason === 'invalid_entity_kind') &&
      !meta.value
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
      if (owner?.entity_kind != null && String(owner.entity_kind).trim() !== '') {
        meta.value = String(owner.entity_kind).trim();
      }
      if (!row.field) meta.forceField = 'entity_kind';
      if (!row.sheet || row.sheet === 'validation') meta.forceSheet = 'owners';
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
