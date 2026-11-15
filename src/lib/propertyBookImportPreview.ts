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

/**
 * Legacy owners files may still put ownership_type on owner rows.
 * Flag when the same apartment identity carries conflicting sole/shared values.
 * ownership_type remains apartment-level on objects; this is a file-side guard only.
 */
export function ownersOwnershipTypeConflictRows(
  owners: BookPreviewOwnerRow[],
): FirstRunErrorRow[] {
  const byKey = new Map<
    string,
    { apt: string; section: string; block: string; types: Set<string>; rows: number[] }
  >();
  for (const raw of owners) {
    const parts = propertyBookIdentityParts(asIdentityRow(raw));
    if (!parts.apartmentNumber) continue;
    const type = String(raw.ownership_type ?? '')
      .trim()
      .toLowerCase();
    if (type !== 'sole' && type !== 'shared') continue;
    const key = [
      parts.apartmentNumber.toLowerCase(),
      parts.sectionCode.toLowerCase(),
      parts.blockCode.toLowerCase(),
    ].join('\u0001');
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        apt: parts.apartmentNumber,
        section: parts.sectionCode,
        block: parts.blockCode,
        types: new Set(),
        rows: [],
      };
      byKey.set(key, entry);
    }
    entry.types.add(type);
    const r = rowNum(raw._row);
    if (r != null) entry.rows.push(r);
  }
  const out: FirstRunErrorRow[] = [];
  for (const entry of byKey.values()) {
    if (entry.types.size < 2) continue;
    out.push({
      sheet: 'owners',
      row: entry.rows[0] != null ? String(entry.rows[0]) : '',
      field: 'ownership_type',
      reason: 'ownership_type_conflict',
      apartment: entry.apt,
      severity: 'error',
      meta: {
        sectionCode: entry.section,
        blockCode: entry.block,
        sourceRows: [...new Set(entry.rows)].sort((a, b) => a - b),
        value: [...entry.types].sort().join('/'),
      },
    });
  }
  return out;
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
  const mergedRows = [...rows, ...ownersOwnershipTypeConflictRows(owners)];

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
        if (!row.sheet || row.sheet === 'validation') meta.forceSheet = 'objects';
        if (!row.field) meta.forceField = 'ownership_type';
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
