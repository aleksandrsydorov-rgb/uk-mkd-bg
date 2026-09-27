/** Property book (книга этажной собственности) — helpers + Excel template. */

import * as XLSX from 'xlsx';

export const OWNERSHIP_TYPES = ['sole', 'shared'] as const;
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

export const BOOK_ENTITY_KINDS = ['natural_person', 'legal_entity', 'sole_trader'] as const;
export type BookEntityKind = (typeof BOOK_ENTITY_KINDS)[number];

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
  book_complete: boolean;
  validation: {
    ok?: boolean;
    errors?: string[];
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
  'ideal_parts_percent',
  'ownership_type',
] as const;

export const BOOK_OWNERS_CSV_HEADERS = [
  'apartment_number',
  'entity_kind',
  'ownership_share_percent',
  'ideal_parts_percent',
  'email',
  'first_name',
  'middle_name',
  'last_name',
  'entity_name',
  'eik_bulstat',
] as const;

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

function sheetToRecords(
  sheet: XLSX.WorkSheet | undefined,
  requiredHeaders: readonly string[],
): Record<string, string>[] {
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  });
  return rows.map((row) => {
    const out: Record<string, string> = {};
    for (const key of Object.keys(row)) {
      out[String(key).trim()] = cellToString(row[key]);
    }
    for (const h of requiredHeaders) {
      if (!(h in out)) out[h] = '';
    }
    return out;
  }).filter((row) =>
    requiredHeaders.some((h) => (row[h] ?? '').trim() !== ''),
  );
}

export type PropertyBookWorkbookPayload = {
  objects: Record<string, string>[];
  owners: Record<string, string>[];
};

/** Parse one Excel workbook with sheets `objects` and `owners`. */
export async function parsePropertyBookWorkbook(file: File): Promise<PropertyBookWorkbookPayload> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });

  const objectsName =
    wb.SheetNames.find((n) => n.trim().toLowerCase() === BOOK_OBJECTS_SHEET) ??
    wb.SheetNames[0];
  const ownersName =
    wb.SheetNames.find((n) => n.trim().toLowerCase() === BOOK_OWNERS_SHEET) ??
    wb.SheetNames.find((n) => n !== objectsName);

  if (!objectsName || !ownersName || objectsName === ownersName) {
    throw new Error('Excel must contain sheets "objects" and "owners"');
  }

  return {
    objects: sheetToRecords(wb.Sheets[objectsName], BOOK_OBJECTS_CSV_HEADERS),
    owners: sheetToRecords(wb.Sheets[ownersName], BOOK_OWNERS_CSV_HEADERS),
  };
}

function objectsTemplateRows(): Record<string, string>[] {
  return [
    {
      apartment_number: '12',
      floor: '3',
      section_code: 'A',
      block_code: '1',
      purpose: 'апартамент',
      area_sqm: '78.5',
      ideal_parts_percent: '1.234567',
      ownership_type: 'sole',
    },
    {
      apartment_number: '14',
      floor: '3',
      section_code: 'A',
      block_code: '1',
      purpose: 'апартамент',
      area_sqm: '92',
      ideal_parts_percent: '2.5',
      ownership_type: 'shared',
    },
  ];
}

function ownersTemplateRows(): Record<string, string>[] {
  return [
    {
      apartment_number: '12',
      entity_kind: 'natural_person',
      ownership_share_percent: '100',
      ideal_parts_percent: '1.234567',
      email: 'owner@example.com',
      first_name: 'Иван',
      middle_name: '',
      last_name: 'Иванов',
      entity_name: '',
      eik_bulstat: '',
    },
    {
      apartment_number: '14',
      entity_kind: 'natural_person',
      ownership_share_percent: '60',
      ideal_parts_percent: '1.5',
      email: 'a@example.com',
      first_name: 'Анна',
      middle_name: '',
      last_name: 'Петрова',
      entity_name: '',
      eik_bulstat: '',
    },
    {
      apartment_number: '14',
      entity_kind: 'natural_person',
      ownership_share_percent: '40',
      ideal_parts_percent: '1.0',
      email: 'b@example.com',
      first_name: 'Борис',
      middle_name: '',
      last_name: 'Колев',
      entity_name: '',
      eik_bulstat: '',
    },
  ];
}

/** One Excel template: sheets objects + owners. */
export function downloadPropertyBookExcelTemplate(filename = 'property_book_template.xlsx') {
  const wb = XLSX.utils.book_new();
  const objectsSheet = XLSX.utils.json_to_sheet(objectsTemplateRows(), {
    header: [...BOOK_OBJECTS_CSV_HEADERS],
  });
  const ownersSheet = XLSX.utils.json_to_sheet(ownersTemplateRows(), {
    header: [...BOOK_OWNERS_CSV_HEADERS],
  });
  XLSX.utils.book_append_sheet(wb, objectsSheet, BOOK_OBJECTS_SHEET);
  XLSX.utils.book_append_sheet(wb, ownersSheet, BOOK_OWNERS_SHEET);
  XLSX.writeFile(wb, filename);
}
