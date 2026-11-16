/**
 * Property Book object identity: apartment number + entrance (section) + block.
 * Entrances may restart apartment numbering; identity must include section/block.
 */

export type PropertyBookIdentityParts = {
  apartmentNumber: string;
  sectionCode: string;
  blockCode: string;
};

/** Trimmed apartment number as stored/matched (case preserved for display). */
export function normalizePropertyBookApartmentNumber(
  value: string | null | undefined,
): string {
  return String(value ?? '').trim();
}

export function normalizePropertyBookSectionCode(
  value: string | null | undefined,
): string {
  return String(value ?? '').trim();
}

export function normalizePropertyBookBlockCode(
  value: string | null | undefined,
): string {
  return String(value ?? '').trim();
}

export function propertyBookIdentityParts(
  row: Record<string, string | null | undefined> | PropertyBookIdentityParts,
): PropertyBookIdentityParts {
  if ('apartmentNumber' in row && typeof (row as PropertyBookIdentityParts).apartmentNumber === 'string') {
    const parts = row as PropertyBookIdentityParts;
    return {
      apartmentNumber: normalizePropertyBookApartmentNumber(parts.apartmentNumber),
      sectionCode: normalizePropertyBookSectionCode(parts.sectionCode),
      blockCode: normalizePropertyBookBlockCode(parts.blockCode),
    };
  }
  const rec = row as Record<string, string | null | undefined>;
  return {
    apartmentNumber: normalizePropertyBookApartmentNumber(rec.apartment_number),
    sectionCode: normalizePropertyBookSectionCode(rec.section_code),
    blockCode: normalizePropertyBookBlockCode(rec.block_code),
  };
}

/** Stable match key for file dedupe and owner↔object binding (case-insensitive). */
export function propertyBookIdentityKey(
  row: Record<string, string | null | undefined> | PropertyBookIdentityParts,
): string {
  const parts = propertyBookIdentityParts(row);
  if (!parts.apartmentNumber) return '';
  return [
    parts.apartmentNumber.toLowerCase(),
    parts.sectionCode.toLowerCase(),
    parts.blockCode.toLowerCase(),
  ].join('\u0001');
}

export function propertyBookIdentityLabel(parts: PropertyBookIdentityParts): string {
  const apt = parts.apartmentNumber || '—';
  const section = parts.sectionCode;
  const block = parts.blockCode;
  if (section && block) return `${block}/${section}/${apt}`;
  if (section) return `${section}/${apt}`;
  if (block) return `${block}/${apt}`;
  return apt;
}

/** Canonical human example used in templates, forms and error hints (RU/BG/EN share the same numbers). */
export const PROPERTY_BOOK_IDENTITY_FORMAT_EXAMPLE = 'Апартамент 2 · Секция Б · Блок 3';

export function propertyBookIdentityFormatHint(parts?: Partial<PropertyBookIdentityParts>): string {
  const apt = parts?.apartmentNumber?.trim() || '2';
  const section = parts?.sectionCode?.trim() || 'Б';
  const block = parts?.blockCode?.trim() || '3';
  return `Апартамент ${apt} · Секция ${section} · Блок ${block}`;
}

/**
 * Detect swapped Section/Block columns: numeric section + letter-like block.
 * Returns a stable error code or null when format looks acceptable.
 */
export function sectionBlockFormatError(
  sectionCode: string | null | undefined,
  blockCode: string | null | undefined,
): 'section_block_fields_swapped' | 'section_code_looks_like_block_number' | null {
  const section = String(sectionCode ?? '').trim();
  const block = String(blockCode ?? '').trim();
  if (!section) return null;
  const sectionIsNumeric = /^[0-9]+$/.test(section);
  const blockIsLetter = /^[A-Za-zА-Яа-яЁёІіЇїЄє]$/.test(block);
  if (sectionIsNumeric && blockIsLetter) return 'section_block_fields_swapped';
  if (sectionIsNumeric && (!block || /^[0-9]+$/.test(block))) {
    return 'section_code_looks_like_block_number';
  }
  return null;
}

/**
 * Parse spreadsheet decimals: accepts `85.40`, `85,40`, optional spaces.
 * Thousands separators: `1 085,40` or `1.085,40` (EU) / `1,085.40` (US).
 */
export function parseImportDecimal(value: string | null | undefined): number | null {
  let text = String(value ?? '').trim();
  if (!text) return null;
  text = text.replace(/\s+/g, '').replace(/\u00a0/g, '');
  if (!text) return null;

  const hasComma = text.includes(',');
  const hasDot = text.includes('.');
  if (hasComma && hasDot) {
    // Last separator is the decimal mark.
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (hasComma) {
    text = text.replace(',', '.');
  }

  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Normalize a numeric cell for RPC/SQL (dot decimal, no thousands). */
export function normalizeImportDecimalString(
  value: string | null | undefined,
): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  // Already a plain dot-decimal — keep the author's digits (e.g. 85.40).
  if (/^[+-]?\d+(\.\d+)?$/.test(raw.replace(/\s+/g, ''))) {
    return raw.replace(/\s+/g, '');
  }
  const n = parseImportDecimal(raw);
  if (n == null) return raw;
  // Preserve fractional digits from a comma decimal like 85,40 → 85.40.
  const normalized = raw.replace(/\s+/g, '').replace(/\u00a0/g, '');
  const commaIdx = normalized.lastIndexOf(',');
  if (commaIdx >= 0) {
    const frac = normalized.slice(commaIdx + 1).replace(/\D/g, '');
    if (frac.length > 0) return n.toFixed(frac.length);
  }
  return String(n);
}

export function normalizePropertyBookNumericFields<T extends Record<string, string>>(
  row: T,
  fields: readonly string[],
): T {
  const out = { ...row };
  for (const field of fields) {
    if (!(field in out)) continue;
    const raw = String(out[field] ?? '').trim();
    if (!raw) continue;
    const normalized = normalizeImportDecimalString(raw);
    (out as Record<string, string>)[field] = normalized;
  }
  return out;
}

export const PROPERTY_BOOK_OBJECT_NUMERIC_FIELDS = [
  'area_sqm',
  'living_area_sqm',
  'ideal_parts_percent',
  'floor',
] as const;

export const PROPERTY_BOOK_OWNER_NUMERIC_FIELDS = [
  'ownership_share_percent',
  'ideal_parts_percent',
] as const;

/** Property Book row used to resolve apartment → property_id for dependent imports. */
export type ApartmentLookupRow = {
  property_id: number;
  apartment_number: string | number;
  section_code?: string | null;
  block_code?: string | null;
};

/**
 * Identity-aware apartment index for meters / support fee / capital / internet opening.
 * Unique apartment numbers resolve without section; repeated numbers require section/block.
 */
export type ApartmentLookupBundle = {
  /** Identity keys always; bare apartment keys only when that number is unique. */
  map: Map<string, number>;
  /** Lowercased apartment numbers that appear under more than one section/block. */
  ambiguousAptNumbers: Set<string>;
};

export function buildApartmentIdentityLookup(
  apartments: Iterable<ApartmentLookupRow>,
): ApartmentLookupBundle {
  const map = new Map<string, number>();
  const byApt = new Map<string, Set<number>>();

  for (const a of apartments) {
    const parts = propertyBookIdentityParts({
      apartment_number: String(a.apartment_number ?? ''),
      section_code: a.section_code != null ? String(a.section_code) : '',
      block_code: a.block_code != null ? String(a.block_code) : '',
    });
    if (!parts.apartmentNumber) continue;
    const idKey = propertyBookIdentityKey(parts);
    if (idKey) map.set(idKey, a.property_id);
    const apt = parts.apartmentNumber.toLowerCase();
    const set = byApt.get(apt) ?? new Set<number>();
    set.add(a.property_id);
    byApt.set(apt, set);
  }

  const ambiguousAptNumbers = new Set<string>();
  for (const [apt, ids] of byApt) {
    if (ids.size > 1) {
      ambiguousAptNumbers.add(apt);
      continue;
    }
    const only = ids.values().next().value as number | undefined;
    if (only != null) map.set(apt, only);
  }

  return { map, ambiguousAptNumbers };
}

export function resolveApartmentPropertyId(
  lookup: Map<string, number> | ApartmentLookupBundle,
  row: Record<string, string | null | undefined> | PropertyBookIdentityParts,
): { propertyId?: number; error?: string } {
  const parts = propertyBookIdentityParts(row);
  if (!parts.apartmentNumber) return {};
  const apt = parts.apartmentNumber.toLowerCase();
  const idKey = propertyBookIdentityKey(parts);
  const isMap = lookup instanceof Map;
  const map = isMap ? lookup : lookup.map;
  const ambiguous = isMap ? null : lookup.ambiguousAptNumbers;

  if (parts.sectionCode || parts.blockCode) {
    if (idKey && map.has(idKey)) return { propertyId: map.get(idKey) };
    return { error: 'unknown_apartment' };
  }

  if (ambiguous?.has(apt)) {
    return { error: 'section_code_required_for_disambiguation' };
  }

  if (map.has(apt)) return { propertyId: map.get(apt) };
  if (idKey && map.has(idKey)) return { propertyId: map.get(idKey) };
  return { error: 'unknown_apartment' };
}

/** Stable key for per-apartment file-scope checks (opening balance, overpayment). */
export function apartmentScopeKeyFromRow(
  row: Record<string, string | null | undefined>,
): string {
  return propertyBookIdentityKey(row) || normalizePropertyBookApartmentNumber(row.apartment_number).toLowerCase();
}
