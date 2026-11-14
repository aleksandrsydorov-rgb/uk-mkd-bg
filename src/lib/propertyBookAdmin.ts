/** Property book (книга этажной собственности) — helpers + Excel template. */

import * as XLSX from 'xlsx';
import {
  PROPERTY_BOOK_OBJECTS_SPEC,
  PROPERTY_BOOK_OWNERS_SPEC,
  buildLocalizedMultiSheetImportWorkbook,
  columnHeaderCandidates,
  downloadImportTemplateBuffer,
  isInstructionSheetName,
  normalizeImportHeader,
  toImportTemplateLocale,
  type ImportTemplateLocale,
  type ImportTemplateSpec,
} from '@/lib/importTemplates';

export const OWNERSHIP_TYPES = ['sole', 'shared'] as const;
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

export const BOOK_ENTITY_KINDS = ['natural_person', 'legal_entity', 'sole_trader'] as const;
export type BookEntityKind = (typeof BOOK_ENTITY_KINDS)[number];

export type PropertyBookClarificationIssue = {
  scope?: string;
  code?: string;
  field?: string;
  registry_people_id?: number | null;
  owner_index?: number;
  label?: string;
};

export type PropertyBookListRow = {
  property_id: number;
  apartment_number: string;
  floor: number | null;
  section_code: string | null;
  block_code: string | null;
  purpose: string | null;
  area_sqm: number | null;
  ideal_parts_percent: number | null;
  ownership_type: string | null;
  owner_count: number;
  /** Primary phone(s) of active owners (joined when several). */
  owner_phone?: string | null;
  /** Additional phone(s) of active owners (joined when several). */
  owner_phone_secondary?: string | null;
  book_complete: boolean;
  needs_clarification?: boolean;
  clarification?: {
    needs_clarification?: boolean;
    importable?: boolean;
    book_complete?: boolean;
    hard_errors?: string[];
    issues?: PropertyBookClarificationIssue[];
  } | null;
  validation: {
    ok?: boolean;
    importable?: boolean;
    errors?: string[];
    warnings?: string[];
    owner_count?: number;
    share_sum?: number;
    ideal_sum?: number;
  } | null;
};

export type PropertyBookOwnerInput = {
  entity_kind: BookEntityKind | string;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  entity_name?: string | null;
  eik_bulstat?: string | null;
  email?: string | null;
  ownership_share_percent?: number | string | null;
  ideal_parts_percent?: number | string | null;
};

export type PropertyBookObjectCsv = {
  apartment_number: string;
  floor?: string;
  section_code?: string;
  block_code?: string;
  purpose: string;
  area_sqm: string;
  ideal_parts_percent: string;
  ownership_type: string;
};

export type PropertyBookOwnerCsv = PropertyBookOwnerInput & {
  apartment_number: string;
};

export const BOOK_OBJECTS_SHEET = 'objects';
export const BOOK_OWNERS_SHEET = 'owners';

export const BOOK_OBJECTS_CSV_HEADERS = [
  'apartment_number',
  'floor',
  'section_code',
  'block_code',
  'purpose',
  'area_sqm',
  'living_area_sqm',
  'ideal_parts_percent',
  'ownership_type',
] as const;

export const BOOK_OWNERS_CSV_HEADERS = [
  'apartment_number',
  'entity_kind',
  'ownership_share_percent',
  'ideal_parts_percent',
  'email',
  'phone',
  'phone_secondary',
  'first_name',
  'middle_name',
  'last_name',
  'entity_name',
  'eik_bulstat',
] as const;

/** Contact fields: omit from row when the workbook header is absent (preserve on import). */
const BOOK_OWNERS_SPARSE_HEADERS = new Set(['phone', 'phone_secondary']);

export function canSeePropertyBookAdmin(role?: string | null) {
  return role === 'администрация';
}

function cellToString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

/** normalized header candidate (all locales, key, aliases) → canonical column key. */
function headerKeyMap(spec: ImportTemplateSpec): Map<string, string> {
  const map = new Map<string, string>();
  for (const col of spec.columns) {
    for (const cand of columnHeaderCandidates(col)) {
      if (!map.has(cand)) map.set(cand, col.key);
    }
  }
  return map;
}

function sheetToRecords(
  sheet: XLSX.WorkSheet | undefined,
  requiredHeaders: readonly string[],
  spec?: ImportTemplateSpec,
  sparseHeaders: ReadonlySet<string> = new Set(),
): Record<string, string>[] {
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  });
  const keyMap = spec ? headerKeyMap(spec) : null;
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  const headerRow = Array.isArray(aoa[0]) ? aoa[0] : [];
  const presentCanonical = new Set<string>();
  for (const cell of headerRow) {
    const rawKey = String(cell ?? '').trim();
    if (!rawKey) continue;
    const canonical = keyMap?.get(normalizeImportHeader(rawKey)) ?? rawKey;
    presentCanonical.add(canonical);
  }
  return rows.map((row, idx) => {
    const out: Record<string, string> = {};
    for (const key of Object.keys(row)) {
      const rawKey = String(key).trim();
      const canonical = keyMap?.get(normalizeImportHeader(rawKey)) ?? rawKey;
      // First matching column wins; never let a duplicate header blank a filled value.
      if (canonical in out && out[canonical]) continue;
      out[canonical] = cellToString(row[key]);
    }
    for (const h of requiredHeaders) {
      if (h in out) continue;
      // Sparse contact columns: absent header → omit key (importer preserves DB value).
      if (sparseHeaders.has(h) && !presentCanonical.has(h)) continue;
      out[h] = '';
    }
    out._row = String(idx + 2);
    return out;
  }).filter((row) =>
    requiredHeaders.some((h) => (row[h] ?? '').trim() !== ''),
  );
}

export type PropertyBookWorkbookPayload = {
  objects: Record<string, string>[];
  owners: Record<string, string>[];
};

function specSheetNames(spec: ImportTemplateSpec): Set<string> {
  const names = new Set<string>();
  for (const loc of ['ru', 'bg', 'en'] as const) {
    names.add(spec.dataSheetName[loc].trim().toLowerCase());
  }
  for (const legacy of spec.legacySheetNames ?? []) names.add(legacy.trim().toLowerCase());
  return names;
}

/**
 * Parse workbook buffer: objects + owners sheets.
 * Accepts localized sheet names (ru/bg/en), legacy `objects` / `owners`, and
 * localized or snake_case column headers.
 */
export function parsePropertyBookWorkbookBuffer(buf: ArrayBuffer): PropertyBookWorkbookPayload {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const dataSheets = wb.SheetNames.filter((n) => !isInstructionSheetName(n));

  const objectNames = specSheetNames(PROPERTY_BOOK_OBJECTS_SPEC);
  const ownerNames = specSheetNames(PROPERTY_BOOK_OWNERS_SPEC);

  const objectsName =
    dataSheets.find((n) => objectNames.has(n.trim().toLowerCase())) ?? dataSheets[0];
  const ownersName =
    dataSheets.find((n) => ownerNames.has(n.trim().toLowerCase())) ??
    dataSheets.find((n) => n !== objectsName);

  if (!objectsName || !ownersName || objectsName === ownersName) {
    throw new Error('Excel must contain sheets "objects" and "owners"');
  }

  return {
    objects: sheetToRecords(wb.Sheets[objectsName], BOOK_OBJECTS_CSV_HEADERS, PROPERTY_BOOK_OBJECTS_SPEC),
    owners: sheetToRecords(
      wb.Sheets[ownersName],
      BOOK_OWNERS_CSV_HEADERS,
      PROPERTY_BOOK_OWNERS_SPEC,
      BOOK_OWNERS_SPARSE_HEADERS,
    ),
  };
}

/** Parse one Excel workbook with sheets `objects` and `owners`. */
export async function parsePropertyBookWorkbook(file: File): Promise<PropertyBookWorkbookPayload> {
  const buf = await file.arrayBuffer();
  return parsePropertyBookWorkbookBuffer(buf);
}

/** Localized base file name for the combined objects + owners template. */
export const PROPERTY_BOOK_TEMPLATE_FILE_BASE: Record<ImportTemplateLocale, string> = {
  ru: 'шаблон-книга-собственности',
  bg: 'shablon-kniga-sobstvenost',
  en: 'property-book-template',
};

const PROPERTY_BOOK_TEMPLATE_TITLE: Record<ImportTemplateLocale, string> = {
  ru: 'Книга собственности — начальный импорт',
  bg: 'Книга на собствеността — начален импорт',
  en: 'Property Book — opening import',
};

export function propertyBookTemplateFileName(locale: ImportTemplateLocale | string = 'ru'): string {
  return `${PROPERTY_BOOK_TEMPLATE_FILE_BASE[toImportTemplateLocale(locale)]}.xlsx`;
}

/** Localized multi-sheet template: Objects + Owners data sheets + one Instructions sheet. */
export function buildPropertyBookTemplateBuffer(
  locale: ImportTemplateLocale | string = 'ru',
): ArrayBuffer {
  const loc = toImportTemplateLocale(locale);
  const notes = Object.fromEntries(
    (['ru', 'bg', 'en'] as const).map((l) => [
      l,
      [
        ...(PROPERTY_BOOK_OBJECTS_SPEC.notes?.[l] ?? []),
        ...(PROPERTY_BOOK_OWNERS_SPEC.notes?.[l] ?? []),
      ],
    ]),
  ) as Record<ImportTemplateLocale, string[]>;
  return buildLocalizedMultiSheetImportWorkbook(
    [
      { spec: PROPERTY_BOOK_OBJECTS_SPEC, locale: loc },
      { spec: PROPERTY_BOOK_OWNERS_SPEC, locale: loc },
    ],
    loc,
    { title: PROPERTY_BOOK_TEMPLATE_TITLE, notes },
  );
}

/** One Excel template: localized Objects + Owners + Instructions. */
export function downloadPropertyBookExcelTemplate(
  localeOrFileName?: ImportTemplateLocale | string,
  fileName?: string,
) {
  const isFileName = typeof localeOrFileName === 'string' && localeOrFileName.endsWith('.xlsx');
  const locale = toImportTemplateLocale(isFileName ? 'ru' : localeOrFileName);
  const name = fileName ?? (isFileName ? (localeOrFileName as string) : propertyBookTemplateFileName(locale));
  downloadImportTemplateBuffer(buildPropertyBookTemplateBuffer(locale), name);
}

export type PropertyBookListFilters = {
  completeness: 'all' | 'complete' | 'incomplete' | 'needs_clarification';
  block: string;
  section: string;
  floor: string;
  apartmentQuery: string;
};

/** Match key for import: apartment_number. Other object/owner fields may be empty → clarification. */
export const PROPERTY_BOOK_IMPORT_REQUIRED_FIELDS = ['apartment_number'] as const;
export const PROPERTY_BOOK_IMPORT_CLARIFICATION_OBJECT_FIELDS = [
  'purpose',
  'area_sqm',
  'ideal_parts_percent',
  'ownership_type',
] as const;

export const EMPTY_PROPERTY_BOOK_LIST_FILTERS: PropertyBookListFilters = {
  completeness: 'all',
  block: '',
  section: '',
  floor: '',
  apartmentQuery: '',
};

export function propertyBookListFiltersActive(f: PropertyBookListFilters): boolean {
  return (
    f.completeness !== 'all' ||
    Boolean(f.block.trim()) ||
    Boolean(f.section.trim()) ||
    Boolean(f.floor.trim()) ||
    Boolean(f.apartmentQuery.trim())
  );
}

export function collectPropertyBookFilterOptions(rows: PropertyBookListRow[]): {
  blocks: string[];
  sections: string[];
  floors: string[];
} {
  const blocks = new Set<string>();
  const sections = new Set<string>();
  const floors = new Set<string>();
  for (const row of rows) {
    const block = String(row.block_code ?? '').trim();
    const section = String(row.section_code ?? '').trim();
    if (block) blocks.add(block);
    if (section) sections.add(section);
    if (row.floor != null && Number.isFinite(Number(row.floor))) {
      floors.add(String(row.floor));
    }
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return {
    blocks: [...blocks].sort(collator.compare),
    sections: [...sections].sort(collator.compare),
    floors: [...floors].sort(collator.compare),
  };
}

export function filterPropertyBookListRows(
  rows: PropertyBookListRow[],
  filters: PropertyBookListFilters,
): PropertyBookListRow[] {
  const block = filters.block.trim();
  const section = filters.section.trim();
  const floor = filters.floor.trim();
  const aptQ = filters.apartmentQuery.trim().toLowerCase();

  const list = rows.filter((row) => {
    if (filters.completeness === 'complete' && !row.book_complete) return false;
    if (filters.completeness === 'incomplete' && row.book_complete) return false;
    if (filters.completeness === 'needs_clarification') {
      const needs =
        row.needs_clarification === true ||
        row.clarification?.needs_clarification === true ||
        (!row.book_complete && (row.validation?.importable !== false));
      if (!needs) return false;
    }
    if (block && String(row.block_code ?? '').trim() !== block) return false;
    if (section && String(row.section_code ?? '').trim() !== section) return false;
    if (floor && String(row.floor ?? '') !== floor) return false;
    if (aptQ) {
      const hay = [
        row.apartment_number,
        row.owner_phone,
        row.owner_phone_secondary,
      ]
        .map((v) => String(v ?? '').toLowerCase())
        .join(' ');
      if (!hay.includes(aptQ)) return false;
    }
    return true;
  });

  return list.sort((a, b) => Number(a.apartment_number) - Number(b.apartment_number));
}
