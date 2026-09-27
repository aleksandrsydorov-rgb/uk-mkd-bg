/** Property book (книга этажной собственности) — helpers + CSV template. */

export const OWNERSHIP_TYPES = ['sole', 'shared'] as const;
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

export const BOOK_ENTITY_KINDS = ['natural_person', 'legal_entity', 'sole_trader'] as const;
export type BookEntityKind = (typeof BOOK_ENTITY_KINDS)[number];

export type PropertyBookListRow = {
  property_id: number;
  apartment_number: string;
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
  purpose: string;
  area_sqm: string;
  ideal_parts_percent: string;
  ownership_type: string;
};

export type PropertyBookOwnerCsv = PropertyBookOwnerInput & {
  apartment_number: string;
};

export const BOOK_OBJECTS_CSV_HEADERS = [
  'apartment_number',
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

export function parseCsv(text: string): Record<string, string>[] {
  const raw = text.replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function toCsv(headers: readonly string[], rows: Record<string, string>[]): string {
  const esc = (v: string) => {
    if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => esc(row[h] ?? '')).join(','));
  }
  return `\uFEFF${lines.join('\n')}\n`;
}

export function bookObjectsTemplateCsv(): string {
  return toCsv(BOOK_OBJECTS_CSV_HEADERS, [
    {
      apartment_number: '12',
      purpose: 'апартамент',
      area_sqm: '78.5',
      ideal_parts_percent: '1.234567',
      ownership_type: 'sole',
    },
    {
      apartment_number: '14',
      purpose: 'апартамент',
      area_sqm: '92',
      ideal_parts_percent: '2.5',
      ownership_type: 'shared',
    },
  ]);
}

export function bookOwnersTemplateCsv(): string {
  return toCsv(BOOK_OWNERS_CSV_HEADERS, [
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
  ]);
}

export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
