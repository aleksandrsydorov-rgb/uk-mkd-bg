import * as XLSX from 'xlsx';
import { sanitizeSpreadsheetCell } from '@/lib/moduleCore/xlsxEngine';
import type {
  ImportColumnDef,
  ImportTemplateLocale,
  ImportTemplateSpec,
  ResolvedImportHeaders,
} from '@/lib/importTemplates/types';

export const IMPORT_INSTRUCTION_SHEET: Record<ImportTemplateLocale, string> = {
  ru: 'Инструкция',
  bg: 'Инструкция',
  en: 'Instructions',
};

const INSTRUCTION_SHEET_ALIASES = new Set(
  [
    'instructions',
    'instruction',
    'инструкция',
    'инструкции',
    ...Object.values(IMPORT_INSTRUCTION_SHEET).map((s) => s.toLowerCase()),
    'instructions_bg',
    'instructions_ru',
    'instructions_en',
    'meta',
  ].map((s) => s.toLowerCase()),
);

export function normalizeImportHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[*_]+/g, '')
    .replace(/\u00a0/g, ' ');
}

export function isInstructionSheetName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (INSTRUCTION_SHEET_ALIASES.has(n)) return true;
  return n.startsWith('instructions_') || n.startsWith('instruction_');
}

/** All accepted header strings for a column (labels + key + aliases). */
export function columnHeaderCandidates(col: ImportColumnDef): string[] {
  const out = new Set<string>();
  out.add(normalizeImportHeader(col.key));
  for (const loc of ['ru', 'bg', 'en'] as const) {
    out.add(normalizeImportHeader(col.label[loc]));
  }
  for (const a of col.aliases ?? []) {
    if (a) out.add(normalizeImportHeader(a));
  }
  return [...out];
}

export function resolveImportHeaders(
  headerRow: string[],
  columns: ImportColumnDef[],
): ResolvedImportHeaders {
  const normalized = headerRow.map((h) => normalizeImportHeader(String(h ?? '')));
  const indexByKey = new Map<string, number>();
  for (const col of columns) {
    const candidates = new Set(columnHeaderCandidates(col));
    const idx = normalized.findIndex((h) => candidates.has(h));
    indexByKey.set(col.key, idx);
  }
  const missingRequired = columns.filter(
    (c) => c.required && (indexByKey.get(c.key) ?? -1) < 0,
  );
  return { indexByKey, missingRequired };
}

export function findImportDataSheet(
  book: XLSX.WorkBook,
  spec: Pick<ImportTemplateSpec, 'dataSheetName' | 'legacySheetNames'>,
): XLSX.WorkSheet | undefined {
  const names = book.SheetNames ?? [];
  const prefer = new Set<string>();
  for (const loc of ['ru', 'bg', 'en'] as const) {
    prefer.add(spec.dataSheetName[loc].trim().toLowerCase());
  }
  for (const legacy of spec.legacySheetNames ?? []) {
    prefer.add(legacy.trim().toLowerCase());
  }

  for (const name of names) {
    if (prefer.has(name.trim().toLowerCase()) && !isInstructionSheetName(name)) {
      return book.Sheets[name];
    }
  }
  for (const name of names) {
    if (!isInstructionSheetName(name)) return book.Sheets[name];
  }
  return undefined;
}

function applyColumnFormats(sheet: XLSX.WorkSheet, columns: ImportColumnDef[], rowCount: number) {
  sheet['!cols'] = columns.map((c) => ({ wch: c.width ?? 18 }));
  // Freeze header row for long tables.
  sheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
  // SheetJS community uses !freeze inconsistently; also set workbook view via rows.
  (sheet as XLSX.WorkSheet & { '!rows'?: Array<{ hpt?: number }> })['!rows'] = [{ hpt: 18 }];

  for (let r = 1; r < rowCount; r += 1) {
    columns.forEach((col, c) => {
      if (col.format !== 'text' && col.format !== 'date') return;
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr] as XLSX.CellObject | undefined;
      if (!cell) {
        sheet[addr] = { t: 's', v: '', z: '@' };
        return;
      }
      if (col.format === 'text') {
        cell.t = 's';
        cell.z = '@';
        cell.v = cell.v == null ? '' : String(cell.v);
      }
    });
  }
}

function buildInstructionSheet(spec: ImportTemplateSpec, locale: ImportTemplateLocale): XLSX.WorkSheet {
  const aoa: string[][] = [
    [spec.title[locale]],
    [],
    [
      locale === 'en' ? 'Column' : locale === 'bg' ? 'Колона' : 'Колонка',
      locale === 'en' ? 'Required' : locale === 'bg' ? 'Задължително' : 'Обязательность',
      locale === 'en' ? 'Format / rules' : locale === 'bg' ? 'Формат / правила' : 'Формат / правила',
      locale === 'en' ? 'Example' : locale === 'bg' ? 'Пример' : 'Пример',
    ],
  ];
  for (const col of spec.columns) {
    aoa.push([
      col.label[locale],
      col.required
        ? locale === 'en'
          ? 'Required'
          : locale === 'bg'
            ? 'Да'
            : 'Обязательно'
        : locale === 'en'
          ? 'Optional'
          : locale === 'bg'
            ? 'Не'
            : 'Необязательно',
      col.instruction[locale],
      col.example ?? '',
    ]);
  }
  aoa.push([]);
  for (const line of spec.notes?.[locale] ?? []) {
    aoa.push([line]);
  }
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 56 }, { wch: 22 }];
  return sheet;
}

/**
 * Build a localized import workbook:
 * - data sheet: header only (empty for user fill)
 * - instruction sheet: column guide + examples
 */
export function buildLocalizedImportWorkbook(
  spec: ImportTemplateSpec,
  locale: ImportTemplateLocale,
): ArrayBuffer {
  const headers = spec.columns.map((c) => c.label[locale]);
  const dataSheet = XLSX.utils.aoa_to_sheet([headers]);
  // Reserve empty typed rows so apartment / meter codes keep leading zeros when typed.
  const reserve = 80;
  for (let r = 1; r < reserve; r += 1) {
    spec.columns.forEach((col, c) => {
      if (col.format === 'text' || col.format === 'date' || !col.format) {
        dataSheet[XLSX.utils.encode_cell({ r, c })] = { t: 's', v: '', z: '@' };
      }
    });
  }
  dataSheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: reserve - 1, c: Math.max(0, spec.columns.length - 1) },
  });
  applyColumnFormats(dataSheet, spec.columns, reserve);

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, dataSheet, spec.dataSheetName[locale].slice(0, 31));
  XLSX.utils.book_append_sheet(
    book,
    buildInstructionSheet(spec, locale),
    IMPORT_INSTRUCTION_SHEET[locale].slice(0, 31),
  );
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/**
 * Prefill data sheet with rows keyed by internal field keys (e.g. opening totals categories).
 * Examples still live on Instruction; body rows are intentional user data seeds.
 */
export function buildLocalizedImportWorkbookWithRows(
  spec: ImportTemplateSpec,
  locale: ImportTemplateLocale,
  rows: Array<Record<string, string>>,
): ArrayBuffer {
  const headers = spec.columns.map((c) => c.label[locale]);
  const body = rows.map((row) =>
    spec.columns.map((c) => sanitizeSpreadsheetCell(String(row[c.key] ?? ''))),
  );
  const dataSheet = XLSX.utils.aoa_to_sheet([headers, ...body]);
  applyColumnFormats(dataSheet, spec.columns, body.length + 1);

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, dataSheet, spec.dataSheetName[locale].slice(0, 31));
  XLSX.utils.book_append_sheet(
    book,
    buildInstructionSheet(spec, locale),
    IMPORT_INSTRUCTION_SHEET[locale].slice(0, 31),
  );
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export function downloadImportTemplateBuffer(buf: ArrayBuffer, fileBaseName: string): void {
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileBaseName.endsWith('.xlsx') ? fileBaseName : `${fileBaseName}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export function localizedTemplateFileName(
  spec: ImportTemplateSpec,
  locale: ImportTemplateLocale,
): string {
  return `${spec.fileBaseName[locale]}.xlsx`;
}

export function missingColumnsMessage(
  missing: ImportColumnDef[],
  locale: ImportTemplateLocale,
): string {
  const names = missing.map((c) => c.label[locale]).join(', ');
  if (locale === 'en') return `Missing required columns: ${names}`;
  if (locale === 'bg') return `Липсват задължителни колони: ${names}`;
  return `Не хватает обязательных колонок: ${names}`;
}

function cellToString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

/** Parse data rows from a workbook using a template spec (all locales + legacy headers). */
export function parseLocalizedImportBuffer(
  buffer: ArrayBuffer,
  spec: ImportTemplateSpec,
):
  | { ok: true; rows: Record<string, string>[] }
  | { ok: false; error: string; missing?: ImportColumnDef[] } {
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(buffer, {
      type: 'array',
      cellFormula: false,
      cellHTML: false,
      raw: false,
    });
  } catch {
    return { ok: false, error: 'parse_failed' };
  }
  const sheet = findImportDataSheet(book, spec);
  if (!sheet) return { ok: false, error: 'sheet_missing' };

  const rowsRaw = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });
  if (!rowsRaw.length) return { ok: false, error: 'empty_sheet' };
  const headerRow = (rowsRaw[0] ?? []).map((h) => cellToString(h));
  const resolved = resolveImportHeaders(headerRow, spec.columns);
  if (resolved.missingRequired.length) {
    return {
      ok: false,
      error: `missing_headers:${resolved.missingRequired.map((c) => c.key).join(',')}`,
      missing: resolved.missingRequired,
    };
  }

  const maxRows = spec.maxRows ?? 5000;
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rowsRaw.length; i += 1) {
    const line = rowsRaw[i] ?? [];
    const rec: Record<string, string> = {};
    let any = false;
    for (const col of spec.columns) {
      const idx = resolved.indexByKey.get(col.key) ?? -1;
      const raw = idx >= 0 ? cellToString(line[idx]) : '';
      rec[col.key] = raw;
      if (raw) any = true;
    }
    if (any) out.push(rec);
  }
  if (out.length > maxRows) return { ok: false, error: 'row_limit' };
  return { ok: true, rows: out };
}

/** Map ModuleXlsxSchema-style labels into alias bag for parseModuleXlsxBuffer. */
export function aliasesFromSpec(spec: ImportTemplateSpec): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const col of spec.columns) {
    const list = new Set<string>();
    for (const loc of ['ru', 'bg', 'en'] as const) list.add(col.label[loc]);
    for (const a of col.aliases ?? []) list.add(a);
    out[col.key] = [...list];
  }
  return out;
}

export function labelsFromSpec(
  spec: ImportTemplateSpec,
  locale: ImportTemplateLocale,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const col of spec.columns) {
    out[col.key] = col.label[locale];
  }
  return out;
}

export function toImportTemplateLocale(value: string | null | undefined): ImportTemplateLocale {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'bg' || v.startsWith('bg')) return 'bg';
  if (v === 'en' || v.startsWith('en')) return 'en';
  return 'ru';
}

function emptyDataSheet(spec: ImportTemplateSpec, locale: ImportTemplateLocale): XLSX.WorkSheet {
  const headers = spec.columns.map((c) => c.label[locale]);
  const dataSheet = XLSX.utils.aoa_to_sheet([headers]);
  const reserve = 80;
  for (let r = 1; r < reserve; r += 1) {
    spec.columns.forEach((col, c) => {
      if (col.format === 'text' || col.format === 'date' || !col.format) {
        dataSheet[XLSX.utils.encode_cell({ r, c })] = { t: 's', v: '', z: '@' };
      }
    });
  }
  dataSheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: reserve - 1, c: Math.max(0, spec.columns.length - 1) },
  });
  applyColumnFormats(dataSheet, spec.columns, reserve);
  return dataSheet;
}

/**
 * Multi data-sheet workbook (e.g. Property Book objects + owners) + one Instruction sheet.
 * Instruction lists columns for every data sheet in order.
 */
export function buildLocalizedMultiSheetImportWorkbook(
  sheets: Array<{ spec: ImportTemplateSpec; locale: ImportTemplateLocale }>,
  locale: ImportTemplateLocale,
  opts?: {
    title: Record<ImportTemplateLocale, string>;
    notes?: Record<ImportTemplateLocale, string[]>;
    fileInstructionOnlyFromFirst?: boolean;
  },
): ArrayBuffer {
  if (!sheets.length) throw new Error('buildLocalizedMultiSheetImportWorkbook: empty');
  const book = XLSX.utils.book_new();
  for (const { spec } of sheets) {
    XLSX.utils.book_append_sheet(book, emptyDataSheet(spec, locale), spec.dataSheetName[locale].slice(0, 31));
  }

  const title = opts?.title?.[locale] ?? sheets[0].spec.title[locale];
  const aoa: string[][] = [[title], []];
  for (const { spec } of sheets) {
    aoa.push([spec.dataSheetName[locale]]);
    aoa.push([
      locale === 'en' ? 'Column' : locale === 'bg' ? 'Колона' : 'Колонка',
      locale === 'en' ? 'Required' : locale === 'bg' ? 'Задължително' : 'Обязательность',
      locale === 'en' ? 'Format / rules' : locale === 'bg' ? 'Формат / правила' : 'Формат / правила',
      locale === 'en' ? 'Example' : locale === 'bg' ? 'Пример' : 'Пример',
    ]);
    for (const col of spec.columns) {
      aoa.push([
        col.label[locale],
        col.required
          ? locale === 'en'
            ? 'Required'
            : locale === 'bg'
              ? 'Да'
              : 'Обязательно'
          : locale === 'en'
            ? 'Optional'
            : locale === 'bg'
              ? 'Не'
              : 'Необязательно',
        col.instruction[locale],
        col.example ?? '',
      ]);
    }
    aoa.push([]);
  }
  for (const line of opts?.notes?.[locale] ?? sheets[0].spec.notes?.[locale] ?? []) {
    aoa.push([line]);
  }
  const instruction = XLSX.utils.aoa_to_sheet(aoa);
  instruction['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 56 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(book, instruction, IMPORT_INSTRUCTION_SHEET[locale].slice(0, 31));
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
