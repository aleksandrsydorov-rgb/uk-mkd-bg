/**
 * INV-6 — Inventory Initial Setup / XLSX opening inventarisation (pure helpers).
 * Preview is READ-ONLY. Commit uses INV-2 RPCs only (see openingCommit.ts).
 * Never creates purchases, invoices, UK expenses, payments, or ledger charges.
 */

import * as XLSX from 'xlsx';
import type { ImportPreviewResult, ImportPreviewRow, ImportRowOperation } from '@/lib/moduleCore/types';
import { sanitizeSpreadsheetCell } from '@/lib/moduleCore/xlsxEngine';
import {
  INVENTORY_IMPORT_SPEC,
  buildLocalizedImportWorkbook,
  columnHeaderCandidates,
  downloadImportTemplateBuffer,
  findImportDataSheet,
  localizedTemplateFileName,
  normalizeImportHeader,
  toImportTemplateLocale,
  type ImportTemplateLocale,
} from '@/lib/importTemplates';
import { INVENTORY_MODULE_KEY } from './admin';
import { INV1_CONDITIONS, INV1_OWNERSHIP_KINDS, INV1_TRACKING_TYPES } from './inv1Schema';

export { INVENTORY_MODULE_KEY };
export const INVENTORY_SETUP_SCHEMA_VERSION = '1.0';
export const INVENTORY_OPENING_SHEET = 'inventory';

export const INVENTORY_OPENING_HEADERS = [
  'tracking_type',
  'category_code',
  'item_name',
  'inventory_number',
  'serial_number',
  'sku_code',
  'ownership_kind',
  'location_code',
  'condition',
  'quantity',
  'unit_code',
  'opening_qty',
  'estimated_value_eur',
  'source_ref',
  'notes',
] as const;

export type InventoryOpeningHeader = (typeof INVENTORY_OPENING_HEADERS)[number];

export type ExistingInventoryAssetRef = {
  id: string;
  inventoryNumber: string;
  name: string;
  ownershipKind: string;
  categoryId: string | null;
  locationId: string | null;
  condition: string;
  serialNumber: string | null;
  estimatedValueEur: number | null;
};

export type ExistingInventoryStockRef = {
  id: string;
  skuCode: string;
  name: string;
  unitCode: string;
  ownershipKind: string;
  categoryId: string | null;
  defaultLocationId: string | null;
  hasOpeningMovement: boolean;
  qtyOnHand: number;
};

export type InventoryOpeningClassifyContext = {
  /** code/name (normalized) → category id */
  categoriesByCode: Map<string, string>;
  /** code/name (normalized) → location id */
  locationsByCode: Map<string, string>;
  /** Display labels for matched catalog entries (id → label). */
  categoryLabelsById?: Map<string, string>;
  locationLabelsById?: Map<string, string>;
  units: Set<string>;
  assetsByNumber: Map<string, ExistingInventoryAssetRef>;
  stockBySku: Map<string, ExistingInventoryStockRef>;
  sourceRefsSeen: Set<string>;
  /** When true (default), unknown category/location become create-warnings, not hard errors. */
  allowCreateCatalog?: boolean;
};

/** Normalize catalog keys: trim, lower-case, collapse spaces (no duplicate by case/whitespace). */
export function normalizeInventoryCatalogKey(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Slug for auto-generated codes when creating categories/locations/SKUs. */
export function slugifyInventoryCatalogCode(raw: string, fallback: string): string {
  const base = normalizeInventoryCatalogKey(raw)
    .replace(/[^a-z0-9а-яёіїґ\u0400-\u04ff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || fallback;
}

/** Friendly XLSX header labels (written into the template). */
export const INVENTORY_OPENING_FRIENDLY_HEADERS: Record<InventoryOpeningHeader, string> = {
  tracking_type: 'Тип (оборудование / расходники)',
  category_code: 'Категория',
  item_name: 'Название',
  inventory_number: 'Инвентарный номер',
  serial_number: 'Серийный номер',
  sku_code: 'Артикул',
  ownership_kind: 'Собственность',
  location_code: 'Место хранения',
  condition: 'Состояние',
  quantity: 'Количество',
  unit_code: 'Единица',
  opening_qty: 'Начальный остаток',
  estimated_value_eur: 'Оценка, €',
  source_ref: 'Источник',
  notes: 'Примечание',
};

const FRIENDLY_HEADER_ALIASES: Record<string, InventoryOpeningHeader> = (() => {
  const map: Record<string, InventoryOpeningHeader> = {};
  for (const key of INVENTORY_OPENING_HEADERS) {
    map[key] = key;
    map[INVENTORY_OPENING_FRIENDLY_HEADERS[key].toLowerCase()] = key;
  }
  const extra: Record<string, InventoryOpeningHeader> = {
    тип: 'tracking_type',
    type: 'tracking_type',
    'item type': 'tracking_type',
    category: 'category_code',
    категория: 'category_code',
    name: 'item_name',
    название: 'item_name',
    'inventory number': 'inventory_number',
    'inv. number': 'inventory_number',
    'инв. номер': 'inventory_number',
    serial: 'serial_number',
    sku: 'sku_code',
    ownership: 'ownership_kind',
    location: 'location_code',
    'storage place': 'location_code',
    место: 'location_code',
    condition: 'condition',
    qty: 'quantity',
    unit: 'unit_code',
    'opening qty': 'opening_qty',
    value: 'estimated_value_eur',
    source: 'source_ref',
    note: 'notes',
    notes: 'notes',
  };
  for (const [k, v] of Object.entries(extra)) map[k] = v;
  return map;
})();

/** normalizeImportHeader(candidate) → key for every spec label (ru/bg/en), key and alias. */
const SPEC_HEADER_ALIASES: Map<string, InventoryOpeningHeader> = (() => {
  const map = new Map<string, InventoryOpeningHeader>();
  for (const col of INVENTORY_IMPORT_SPEC.columns) {
    for (const cand of columnHeaderCandidates(col)) {
      if (!map.has(cand)) map.set(cand, col.key as InventoryOpeningHeader);
    }
  }
  return map;
})();

export function resolveInventoryOpeningHeader(raw: string): InventoryOpeningHeader | null {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return FRIENDLY_HEADER_ALIASES[key] ?? SPEC_HEADER_ALIASES.get(normalizeImportHeader(String(raw ?? ''))) ?? null;
}

export const INVENTORY_OPENING_FORBIDDEN_FINANCE = [
  'uk_expenses',
  'charge_support_fee',
  'record_support_payment',
  'capital_repair_ledger',
  'internet_ledger',
  'create_invoice',
  'journal_entry',
  'bank_transaction',
] as const;

export function inventoryOpeningMentionsFinance(source: string): boolean {
  const lower = source.toLowerCase();
  return INVENTORY_OPENING_FORBIDDEN_FINANCE.some((f) => lower.includes(f));
}

function bump(
  counters: {
    createCount: number;
    updateCount: number;
    skipCount: number;
    errorCount: number;
    conflictCount: number;
  },
  op: ImportRowOperation | 'conflict',
) {
  if (op === 'create') counters.createCount += 1;
  else if (op === 'update') counters.updateCount += 1;
  else if (op === 'skip') counters.skipCount += 1;
  else if (op === 'conflict') counters.conflictCount += 1;
  else counters.errorCount += 1;
}

export function normalizeOwnershipKind(raw: string): string | null {
  const t = raw.trim().toUpperCase().replace(/\s+/g, '_');
  if ((INV1_OWNERSHIP_KINDS as readonly string[]).includes(t)) return t;
  const aliases: Record<string, string> = {
    CONDO: 'CONDOMINIUM',
    ET: 'CONDOMINIUM',
    COMPLEX: 'CONDOMINIUM',
    КОМПЛЕКС: 'CONDOMINIUM',
    СГРАДА: 'CONDOMINIUM',
    УК: 'MANAGEMENT_COMPANY',
    UK: 'MANAGEMENT_COMPANY',
    MC: 'MANAGEMENT_COMPANY',
    'УПРАВЛЯЮЩАЯ_КОМПАНИЯ': 'MANAGEMENT_COMPANY',
    УПРАВЛЕНИЕ: 'MANAGEMENT_COMPANY',
    THIRD: 'THIRD_PARTY',
    'ТРЕТЬЯ_СТОРОНА': 'THIRD_PARTY',
    ТРЕТИ: 'THIRD_PARTY',
  };
  if (aliases[t]) return aliases[t]!;
  const lower = raw.trim().toLowerCase();
  if (/комплекс|condo|сград/i.test(lower)) return 'CONDOMINIUM';
  if (/управл|management|\bук\b/i.test(lower)) return 'MANAGEMENT_COMPANY';
  if (/трет|third/i.test(lower)) return 'THIRD_PARTY';
  return null;
}

export function normalizeTrackingType(raw: string): string | null {
  const t = raw.trim().toUpperCase().replace(/\s+/g, '_');
  if ((INV1_TRACKING_TYPES as readonly string[]).includes(t)) return t;
  const aliases: Record<string, string> = {
    ASSET: 'INDIVIDUAL_ASSET',
    INDIVIDUAL: 'INDIVIDUAL_ASSET',
    EQUIPMENT: 'INDIVIDUAL_ASSET',
    'ОБОРУДОВАНИЕ': 'INDIVIDUAL_ASSET',
    'ОБЗАВЕЖДАНЕ': 'INDIVIDUAL_ASSET',
    'ТЕХНИКА': 'INDIVIDUAL_ASSET',
    STOCK: 'QUANTITY_STOCK',
    CONSUMABLE: 'QUANTITY_STOCK',
    CONSUMABLES: 'QUANTITY_STOCK',
    QTY: 'QUANTITY_STOCK',
    QUANTITY: 'QUANTITY_STOCK',
    'РАСХОДНИКИ': 'QUANTITY_STOCK',
    'РАЗХОДНИ': 'QUANTITY_STOCK',
    'МАТЕРИАЛЫ': 'QUANTITY_STOCK',
  };
  const compact = raw.trim().toUpperCase().replace(/\s+/g, '_');
  if (aliases[compact]) return aliases[compact]!;
  const lower = raw.trim().toLowerCase();
  if (aliases[lower.toUpperCase().replace(/\s+/g, '_')]) {
    return aliases[lower.toUpperCase().replace(/\s+/g, '_')]!;
  }
  // Cyrillic phrases without underscore
  if (/оборуд|equipment|техника|обзавежд/i.test(raw)) return 'INDIVIDUAL_ASSET';
  if (/расход|разход|consum|материал|stock/i.test(raw)) return 'QUANTITY_STOCK';
  if (t === 'ASSET' || t === 'INDIVIDUAL' || t === 'EQUIPMENT') return 'INDIVIDUAL_ASSET';
  if (t === 'STOCK' || t === 'CONSUMABLE' || t === 'QTY' || t === 'QUANTITY') return 'QUANTITY_STOCK';
  return null;
}

export function normalizeCondition(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, '_');
  if (!t) return 'good';
  if ((INV1_CONDITIONS as readonly string[]).includes(t)) return t;
  const aliases: Record<string, string> = {
    новый: 'new',
    нова: 'new',
    ново: 'new',
    нов: 'new',
    хорошее: 'good',
    доброе: 'good',
    добро: 'good',
    удовлетворительное: 'fair',
    среднее: 'fair',
    удовлетворително: 'fair',
    плохое: 'poor',
    лошо: 'poor',
    неисправно: 'unserviceable',
    списано: 'unserviceable',
  };
  return aliases[t] ?? null;
}

export function parseOptionalNonNegNumber(raw: string | undefined): number | null {
  const t = String(raw ?? '')
    .trim()
    .replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function validateInventoryOpeningRow(row: Record<string, string>): string[] {
  const errors: string[] = [];
  const tracking = normalizeTrackingType(row.tracking_type ?? '');
  if (!tracking) errors.push('invalid:tracking_type');
  if (!String(row.item_name ?? '').trim()) errors.push('required:item_name');
  if (!normalizeOwnershipKind(row.ownership_kind ?? '')) errors.push('invalid:ownership_kind');

  if (tracking === 'INDIVIDUAL_ASSET') {
    if (!String(row.inventory_number ?? '').trim()) errors.push('required:inventory_number');
    const condRaw = String(row.condition ?? '').trim();
    if (condRaw && !normalizeCondition(condRaw)) {
      errors.push('invalid:condition');
    }
  }

  if (tracking === 'QUANTITY_STOCK') {
    // sku_code may be auto-generated during classify when empty
    if (!String(row.unit_code ?? '').trim()) errors.push('required:unit_code');
    const opening =
      parseOptionalNonNegNumber(row.opening_qty) ?? parseOptionalNonNegNumber(row.quantity);
    if (opening == null) errors.push('invalid:opening_qty');
  }

  const est = String(row.estimated_value_eur ?? '').trim();
  if (est) {
    const n = parseOptionalNonNegNumber(est);
    if (n == null) errors.push('invalid:estimated_value_eur');
  }

  return errors;
}

export function classifyInventoryOpeningRows(
  rows: Record<string, string>[],
  ctx: InventoryOpeningClassifyContext,
): ImportPreviewResult & { conflictCount: number } {
  const allowCreate = ctx.allowCreateCatalog !== false;
  const counters = {
    createCount: 0,
    updateCount: 0,
    skipCount: 0,
    errorCount: 0,
    conflictCount: 0,
    warningCount: 0,
  };
  const previewRows: ImportPreviewRow[] = [];
  const numbersInFile = new Map<string, number>();
  const skusInFile = new Map<string, number>();
  const sourcesInFile = new Map<string, number>();

  rows.forEach((raw, idx) => {
    const rowNumber = idx + 2;
    const errors = validateInventoryOpeningRow(raw);
    const warnings: string[] = [];
    const tracking = normalizeTrackingType(raw.tracking_type ?? '') ?? '';
    const ownership = normalizeOwnershipKind(raw.ownership_kind ?? '') ?? '';
    const name = String(raw.item_name ?? '').trim();
    const invNumber = String(raw.inventory_number ?? '').trim();
    let sku = String(raw.sku_code ?? '').trim();
    const unit = String(raw.unit_code ?? '').trim();
    const locationRaw = String(raw.location_code ?? '').trim();
    const categoryRaw = String(raw.category_code ?? '').trim();
    const locationKey = normalizeInventoryCatalogKey(locationRaw);
    const categoryKey = normalizeInventoryCatalogKey(categoryRaw);
    const sourceRef = String(raw.source_ref ?? '').trim();
    const condition = normalizeCondition(String(raw.condition ?? '').trim()) || 'good';
    const openingQty =
      parseOptionalNonNegNumber(raw.opening_qty) ?? parseOptionalNonNegNumber(raw.quantity);
    const estimated = parseOptionalNonNegNumber(raw.estimated_value_eur);

    if (tracking === 'QUANTITY_STOCK' && !sku && name) {
      sku = `AUTO-${slugifyInventoryCatalogCode(name, `row-${rowNumber}`)}`;
      warnings.push('auto:sku_code');
    }

    let categoryId: string | null = null;
    let locationId: string | null = null;
    let willCreateCategory = false;
    let willCreateLocation = false;

    if (categoryKey) {
      categoryId = ctx.categoriesByCode.get(categoryKey) ?? null;
      if (categoryId == null) {
        if (allowCreate) {
          willCreateCategory = true;
          warnings.push('will_create:category');
        } else {
          errors.push('unknown:category_code');
        }
      }
    }
    if (locationKey) {
      locationId = ctx.locationsByCode.get(locationKey) ?? null;
      if (locationId == null) {
        if (allowCreate) {
          willCreateLocation = true;
          warnings.push('will_create:location');
        } else {
          errors.push('unknown:location_code');
        }
      }
    }

    if (tracking === 'QUANTITY_STOCK' && unit) {
      if (!ctx.units.has(unit) && !ctx.units.has(unit.toLowerCase())) {
        errors.push('unknown:unit_code');
      }
    }

    if (tracking === 'INDIVIDUAL_ASSET' && invNumber) {
      const key = normalizeInventoryCatalogKey(invNumber);
      if (numbersInFile.has(key)) errors.push('duplicate_in_file:inventory_number');
      else numbersInFile.set(key, rowNumber);
    }
    if (tracking === 'QUANTITY_STOCK' && sku) {
      const key = normalizeInventoryCatalogKey(sku);
      if (skusInFile.has(key)) errors.push('duplicate_in_file:sku_code');
      else skusInFile.set(key, rowNumber);
    }
    if (sourceRef) {
      const key = normalizeInventoryCatalogKey(sourceRef);
      if (sourcesInFile.has(key) || ctx.sourceRefsSeen.has(key)) {
        errors.push('duplicate:source_ref');
      } else sourcesInFile.set(key, rowNumber);
    }

    let operation: ImportRowOperation = 'error';
    let previewClass = 'ERROR';

    if (errors.length === 0) {
      if (tracking === 'INDIVIDUAL_ASSET') {
        const existing = ctx.assetsByNumber.get(normalizeInventoryCatalogKey(invNumber));
        if (!existing) {
          operation = 'create';
          previewClass = 'CREATE';
        } else if (
          existing.name === name &&
          existing.ownershipKind === ownership &&
          (existing.categoryId ?? null) === categoryId &&
          (existing.locationId ?? null) === locationId &&
          existing.condition === condition
        ) {
          operation = 'skip';
          previewClass = 'SKIP';
        } else {
          operation = 'error';
          previewClass = 'CONFLICT';
          errors.push('conflict:inventory_number');
        }
      } else {
        const existing = ctx.stockBySku.get(normalizeInventoryCatalogKey(sku));
        if (!existing) {
          operation = 'create';
          previewClass = 'CREATE';
        } else if (
          existing.name === name &&
          existing.unitCode === unit &&
          existing.ownershipKind === ownership &&
          existing.hasOpeningMovement
        ) {
          operation = 'skip';
          previewClass = 'SKIP';
        } else if (
          existing.name === name &&
          existing.unitCode === unit &&
          existing.ownershipKind === ownership &&
          !existing.hasOpeningMovement
        ) {
          operation = 'create';
          previewClass = 'CREATE';
        } else {
          operation = 'error';
          previewClass = 'CONFLICT';
          errors.push('conflict:sku_code');
        }
      }
    }

    if (previewClass === 'CONFLICT') {
      bump(counters, 'conflict');
      bump(counters, 'error');
    } else if (errors.length && operation === 'error') {
      bump(counters, 'error');
    } else {
      bump(counters, operation);
    }
    counters.warningCount += warnings.length;

    const categoryLabel =
      (categoryId && ctx.categoryLabelsById?.get(categoryId)) || categoryRaw || '';
    const locationLabel =
      (locationId && ctx.locationLabelsById?.get(locationId)) || locationRaw || '';

    previewRows.push({
      rowNumber,
      operation,
      matchKey:
        tracking === 'INDIVIDUAL_ASSET'
          ? normalizeInventoryCatalogKey(invNumber)
          : normalizeInventoryCatalogKey(sku) || undefined,
      errors: previewClass === 'SKIP' ? [] : errors,
      warnings: warnings.length ? warnings : undefined,
      data: {
        ...Object.fromEntries(
          INVENTORY_OPENING_HEADERS.map((h) => [h, sanitizeSpreadsheetCell(String(raw[h] ?? ''))]),
        ),
        tracking_type: tracking,
        ownership_kind: ownership,
        condition,
        sku_code: sku,
        category_code: categoryRaw,
        location_code: locationRaw,
        category_label: categoryLabel,
        location_label: locationLabel,
        category_id: categoryId ?? '',
        location_id: locationId ?? '',
        will_create_category: willCreateCategory ? 'true' : '',
        will_create_location: willCreateLocation ? 'true' : '',
        catalog_code_category: willCreateCategory
          ? slugifyInventoryCatalogCode(categoryRaw, `cat-${rowNumber}`)
          : '',
        catalog_code_location: willCreateLocation
          ? slugifyInventoryCatalogCode(locationRaw, `loc-${rowNumber}`)
          : '',
        opening_qty: openingQty != null ? String(openingQty) : '',
        estimated_value_eur: estimated != null ? String(estimated) : '',
        preview_class: previewClass,
        finance_isolated: 'true',
      },
    });
  });

  return {
    schemaVersion: INVENTORY_SETUP_SCHEMA_VERSION,
    rows: previewRows,
    createCount: counters.createCount,
    updateCount: counters.updateCount,
    skipCount: counters.skipCount,
    errorCount: counters.errorCount,
    warningCount: counters.warningCount,
    conflictCount: counters.conflictCount,
  };
}


export function buildInventoryOpeningTemplateBuffer(
  locale: ImportTemplateLocale | string = 'ru',
): ArrayBuffer {
  return buildLocalizedImportWorkbook(INVENTORY_IMPORT_SPEC, toImportTemplateLocale(locale));
}

export function downloadInventoryOpeningTemplate(
  localeOrFileName?: ImportTemplateLocale | string,
  fileName?: string,
): void {
  const isFileName = typeof localeOrFileName === 'string' && localeOrFileName.endsWith('.xlsx');
  const locale = toImportTemplateLocale(isFileName ? 'ru' : localeOrFileName);
  const name =
    fileName ??
    (isFileName ? (localeOrFileName as string) : localizedTemplateFileName(INVENTORY_IMPORT_SPEC, locale));
  downloadImportTemplateBuffer(buildInventoryOpeningTemplateBuffer(locale), name);
}

export function readInventoryOpeningSchemaVersion(buffer: ArrayBuffer): string | null {
  try {
    const book = XLSX.read(buffer, {
      type: 'array',
      cellFormula: false,
      cellHTML: false,
      raw: false,
    });
    const meta = book.Sheets.meta;
    if (!meta) return null;
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(meta, {
      header: 1,
      defval: '',
      raw: false,
    });
    for (const line of rows) {
      if (String(line[0] ?? '').trim().toLowerCase() === 'schema_version') {
        return String(line[1] ?? '').trim();
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function parseInventoryOpeningXlsxBuffer(
  buffer: ArrayBuffer,
):
  | { ok: true; rows: Record<string, string>[]; schemaVersion: string }
  | { ok: false; error: string } {
  // Localized templates have no meta sheet → treated as the current schema version.
  const metaVersion = readInventoryOpeningSchemaVersion(buffer);
  const version = metaVersion ?? INVENTORY_SETUP_SCHEMA_VERSION;
  if (version !== INVENTORY_SETUP_SCHEMA_VERSION) {
    return { ok: false, error: `unsupported_schema_version:${version}` };
  }
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
  const sheet = findImportDataSheet(book, INVENTORY_IMPORT_SPEC);
  if (!sheet) return { ok: false, error: 'sheet_missing' };
  const rowsRaw = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });
  if (!rowsRaw.length) return { ok: false, error: 'empty_sheet' };
  const headerCells = (rowsRaw[0] ?? []).map((h) => String(h ?? '').trim());
  const resolved = headerCells.map((h) => resolveInventoryOpeningHeader(h));
  const colIndex = new Map<InventoryOpeningHeader, number>();
  resolved.forEach((key, idx) => {
    if (key && !colIndex.has(key)) colIndex.set(key, idx);
  });
  const missingReq = (['tracking_type', 'item_name', 'ownership_kind'] as const).filter(
    (req) => !colIndex.has(req),
  );
  if (missingReq.length) return { ok: false, error: `missing_headers:${missingReq.join(',')}` };
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rowsRaw.length; i += 1) {
    const line = rowsRaw[i] ?? [];
    const rec: Record<string, string> = {};
    let any = false;
    for (const col of INVENTORY_OPENING_HEADERS) {
      const idx = colIndex.get(col);
      let raw = idx != null ? String(line[idx] ?? '').trim() : '';
      if (col === 'tracking_type' && raw) {
        raw = normalizeTrackingType(raw) ?? raw;
      } else if (col === 'ownership_kind' && raw) {
        raw = normalizeOwnershipKind(raw) ?? raw;
      } else if (col === 'condition' && raw) {
        raw = normalizeCondition(raw) ?? raw;
      }
      rec[col] = raw;
      if (raw) any = true;
    }
    if (any) out.push(rec);
  }
  if (out.length > 5000) return { ok: false, error: 'row_limit' };
  return { ok: true, rows: out, schemaVersion: version };
}

export function buildInventoryOpeningErrorReportXlsx(preview: ImportPreviewResult): ArrayBuffer {
  const aoa: string[][] = [
    ['rowNumber', 'operation', 'preview_class', 'matchKey', 'errors', 'data'],
  ];
  for (const row of preview.rows.filter((r) => r.errors.length || r.operation === 'error')) {
    aoa.push([
      String(row.rowNumber),
      row.operation,
      sanitizeSpreadsheetCell(row.data.preview_class ?? ''),
      sanitizeSpreadsheetCell(row.matchKey ?? ''),
      sanitizeSpreadsheetCell(row.errors.join('; ')),
      sanitizeSpreadsheetCell(JSON.stringify(row.data)),
    ]);
  }
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'errors');
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export function downloadInventoryOpeningErrorReport(preview: ImportPreviewResult): void {
  const buf = buildInventoryOpeningErrorReportXlsx(preview);
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'inventory_opening_errors.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Opening setup is complete when the admin either confirmed an empty registry
 * or finished a successful import. Physical stocktake is not part of setup.
 */
export function inventorySetupManualComplete(draft: Record<string, unknown>): boolean {
  return draft.empty_inventory_ok === true || draft.import_committed === true;
}
