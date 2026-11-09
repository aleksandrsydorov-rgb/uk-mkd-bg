import * as XLSX from 'xlsx';
import type {
  ImportPreviewResult,
  ImportPreviewRow,
  ModuleXlsxSchema,
} from '@/lib/moduleCore/types';

export const DEFAULT_XLSX_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_XLSX_MAX_ROWS = 5000;

const FORMULA_INJECTION_RE = /^\s*[=+\-@]/;

export function sanitizeSpreadsheetCell(value: string): string {
  const trimmed = value.trim();
  if (FORMULA_INJECTION_RE.test(trimmed)) {
    return `'${trimmed}`;
  }
  return trimmed;
}

export function assertSafeUpload(args: {
  fileName: string;
  byteLength: number;
  maxBytes?: number;
}): { ok: true } | { ok: false; error: string } {
  const maxBytes = args.maxBytes ?? DEFAULT_XLSX_MAX_BYTES;
  const lower = args.fileName.toLowerCase();
  if (!(lower.endsWith('.xlsx') || lower.endsWith('.xls'))) {
    return { ok: false, error: 'invalid_file_type' };
  }
  if (args.byteLength <= 0 || args.byteLength > maxBytes) {
    return { ok: false, error: 'invalid_file_size' };
  }
  return { ok: true };
}

function cellToString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  // Never evaluate formula objects — stringify only.
  return String(value).trim();
}

export function buildModuleXlsxTemplate(
  schema: ModuleXlsxSchema,
  labels: Record<string, string>,
): ArrayBuffer {
  const headers = schema.columns.map((c) => labels[c.labelKey] ?? c.key);
  const example = schema.columns.map((c) => sanitizeSpreadsheetCell(c.example ?? ''));
  const aoa = [headers, example];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, schema.sheetName.slice(0, 31) || 'data');
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export function downloadModuleXlsxTemplate(
  schema: ModuleXlsxSchema,
  labels: Record<string, string>,
  fileName: string,
): void {
  const buf = buildModuleXlsxTemplate(schema, labels);
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Map spreadsheet header cell → column key (canonical key, localized label, or aliases). */
function resolveHeaderIndex(
  headerRow: string[],
  col: ModuleXlsxSchema['columns'][number],
  labels?: Record<string, string>,
  aliases?: Record<string, string[]>,
): number {
  const candidates = new Set<string>();
  candidates.add(normalizeHeader(col.key));
  const label = col.labelKey && labels ? labels[col.labelKey] : undefined;
  if (label) candidates.add(normalizeHeader(label));
  for (const a of aliases?.[col.key] ?? []) {
    if (a) candidates.add(normalizeHeader(a));
  }
  return headerRow.findIndex((h) => candidates.has(normalizeHeader(h)));
}

function sheetRecords(
  sheet: XLSX.WorkSheet | undefined,
  columns: ModuleXlsxSchema['columns'],
  labels?: Record<string, string>,
  aliases?: Record<string, string[]>,
): { rows: Record<string, string>[]; headerError?: string } {
  if (!sheet) return { rows: [], headerError: 'sheet_missing' };
  const rowsRaw = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });
  if (!rowsRaw.length) return { rows: [], headerError: 'empty_sheet' };
  const headerRow = (rowsRaw[0] ?? []).map((h) => cellToString(h));
  const indexByKey = new Map<string, number>();
  for (const col of columns) {
    indexByKey.set(col.key, resolveHeaderIndex(headerRow, col, labels, aliases));
  }
  const missingRequired = columns.filter((c) => {
    if (!c.required) return false;
    return (indexByKey.get(c.key) ?? -1) < 0;
  });
  if (missingRequired.length) {
    return {
      rows: [],
      headerError: `missing_headers:${missingRequired.map((c) => c.key).join(',')}`,
    };
  }

  const out: Record<string, string>[] = [];
  for (let i = 1; i < rowsRaw.length; i += 1) {
    const line = rowsRaw[i] ?? [];
    const rec: Record<string, string> = {};
    let any = false;
    for (const col of columns) {
      const idx = indexByKey.get(col.key) ?? -1;
      const raw = idx >= 0 ? cellToString(line[idx]) : '';
      rec[col.key] = raw;
      if (raw) any = true;
    }
    if (any) out.push(rec);
  }
  return { rows: out };
}

export function parseModuleXlsxBuffer(
  buffer: ArrayBuffer,
  schema: ModuleXlsxSchema,
  labels?: Record<string, string>,
  aliases?: Record<string, string[]>,
): { ok: true; rows: Record<string, string>[] } | { ok: false; error: string } {
  const maxRows = schema.maxRows ?? DEFAULT_XLSX_MAX_ROWS;
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
  const want = schema.sheetName.trim().toLowerCase();
  const isInstruction = (name: string) => {
    const n = name.trim().toLowerCase();
    return (
      n === 'instructions' ||
      n === 'instruction' ||
      n === 'инструкция' ||
      n === 'инструкции' ||
      n.startsWith('instructions_') ||
      n === 'meta'
    );
  };
  let sheetName =
    book.SheetNames.find((n) => n.trim().toLowerCase() === want) ??
    book.SheetNames.find((n) => !isInstruction(n)) ??
    book.SheetNames[0] ??
    '';
  const sheet = book.Sheets[sheetName];
  const parsed = sheetRecords(sheet, schema.columns, labels, aliases);
  if (parsed.headerError) return { ok: false, error: parsed.headerError };
  if (parsed.rows.length > maxRows) return { ok: false, error: 'row_limit' };
  return { ok: true, rows: parsed.rows };
}

export type MatchFn = (
  row: Record<string, string>,
  rowNumber: number,
) => { operation: ImportPreviewRow['operation']; matchKey?: string; errors?: string[] };

/**
 * Preview-only: Core never writes business tables.
 * Caller supplies match/validate logic (module adapter).
 */
export function buildImportPreview(
  rows: Record<string, string>[],
  schema: ModuleXlsxSchema,
  match: MatchFn,
): ImportPreviewResult {
  const previewRows: ImportPreviewRow[] = [];
  let createCount = 0;
  let updateCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  const seen = new Map<string, number>();

  rows.forEach((data, idx) => {
    const rowNumber = idx + 2; // header is row 1
    const fieldErrors: string[] = [];
    for (const col of schema.columns) {
      if (col.required && !data[col.key]) fieldErrors.push(`required:${col.key}`);
      if (FORMULA_INJECTION_RE.test(data[col.key] ?? '')) {
        fieldErrors.push(`formula_injection:${col.key}`);
      }
    }
    const matched = match(data, rowNumber);
    const errors = [...fieldErrors, ...(matched.errors ?? [])];
    let operation = matched.operation;
    if (errors.length) operation = 'error';
    if (matched.matchKey) {
      const prev = seen.get(matched.matchKey);
      if (prev != null) {
        errors.push(`duplicate_in_file:${matched.matchKey}`);
        operation = 'error';
      } else {
        seen.set(matched.matchKey, rowNumber);
      }
    }
    if (operation === 'create') createCount += 1;
    else if (operation === 'update') updateCount += 1;
    else if (operation === 'skip') skipCount += 1;
    else errorCount += 1;

    previewRows.push({
      rowNumber,
      operation,
      data,
      errors,
      matchKey: matched.matchKey,
    });
  });

  return {
    schemaVersion: schema.schemaVersion,
    rows: previewRows,
    createCount,
    updateCount,
    skipCount,
    errorCount,
  };
}

export function buildErrorWorkbook(preview: ImportPreviewResult): ArrayBuffer {
  const aoa: string[][] = [['rowNumber', 'operation', 'matchKey', 'errors', ...Object.keys(preview.rows[0]?.data ?? {})]];
  for (const row of preview.rows.filter((r) => r.operation === 'error' || r.errors.length)) {
    aoa.push([
      String(row.rowNumber),
      row.operation,
      row.matchKey ?? '',
      sanitizeSpreadsheetCell(row.errors.join('; ')),
      ...Object.values(row.data).map(sanitizeSpreadsheetCell),
    ]);
  }
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'errors');
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
