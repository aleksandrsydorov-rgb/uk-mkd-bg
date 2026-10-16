/**
 * INV-6 — Inventory Initial Setup / XLSX opening inventarisation (pure helpers).
 * Preview is READ-ONLY. Commit uses INV-2 RPCs only (see openingCommit.ts).
 * Never creates purchases, invoices, UK expenses, payments, or ledger charges.
 */

import * as XLSX from 'xlsx';
import type { ImportPreviewResult, ImportPreviewRow, ImportRowOperation } from '@/lib/moduleCore/types';
import { sanitizeSpreadsheetCell } from '@/lib/moduleCore/xlsxEngine';
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
  categoriesByCode: Map<string, string>;
  locationsByCode: Map<string, string>;
  units: Set<string>;
  assetsByNumber: Map<string, ExistingInventoryAssetRef>;
  stockBySku: Map<string, ExistingInventoryStockRef>;
  sourceRefsSeen: Set<string>;
};

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
    УК: 'MANAGEMENT_COMPANY',
    UK: 'MANAGEMENT_COMPANY',
    MC: 'MANAGEMENT_COMPANY',
    THIRD: 'THIRD_PARTY',
  };
  return aliases[t] ?? null;
}

export function normalizeTrackingType(raw: string): string | null {
  const t = raw.trim().toUpperCase().replace(/\s+/g, '_');
  if ((INV1_TRACKING_TYPES as readonly string[]).includes(t)) return t;
  if (t === 'ASSET' || t === 'INDIVIDUAL' || t === 'EQUIPMENT') return 'INDIVIDUAL_ASSET';
  if (t === 'STOCK' || t === 'CONSUMABLE' || t === 'QTY' || t === 'QUANTITY') return 'QUANTITY_STOCK';
  return null;
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
    const cond = String(row.condition ?? '').trim().toLowerCase();
    if (cond && !(INV1_CONDITIONS as readonly string[]).includes(cond)) {
      errors.push('invalid:condition');
    }
  }

  if (tracking === 'QUANTITY_STOCK') {
    if (!String(row.sku_code ?? '').trim()) errors.push('required:sku_code');
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
  const counters = {
    createCount: 0,
    updateCount: 0,
    skipCount: 0,
    errorCount: 0,
    conflictCount: 0,
  };
  const previewRows: ImportPreviewRow[] = [];
  const numbersInFile = new Map<string, number>();
  const skusInFile = new Map<string, number>();
  const sourcesInFile = new Map<string, number>();

  rows.forEach((raw, idx) => {
    const rowNumber = idx + 2;
    const errors = validateInventoryOpeningRow(raw);
    const tracking = normalizeTrackingType(raw.tracking_type ?? '') ?? '';
    const ownership = normalizeOwnershipKind(raw.ownership_kind ?? '') ?? '';
    const name = String(raw.item_name ?? '').trim();
    const invNumber = String(raw.inventory_number ?? '').trim();
    const sku = String(raw.sku_code ?? '').trim();
    const unit = String(raw.unit_code ?? '').trim();
    const locationCode = String(raw.location_code ?? '').trim().toLowerCase();
    const categoryCode = String(raw.category_code ?? '').trim().toLowerCase();
    const sourceRef = String(raw.source_ref ?? '').trim();
    const condition = String(raw.condition ?? 'good').trim().toLowerCase() || 'good';
    const openingQty =
      parseOptionalNonNegNumber(raw.opening_qty) ?? parseOptionalNonNegNumber(raw.quantity);
    const estimated = parseOptionalNonNegNumber(raw.estimated_value_eur);

    let categoryId: string | null = null;
    let locationId: string | null = null;

    if (categoryCode) {
      categoryId = ctx.categoriesByCode.get(categoryCode) ?? null;
      if (categoryId == null) errors.push('unknown:category_code');
    }
    if (locationCode) {
      locationId = ctx.locationsByCode.get(locationCode) ?? null;
      if (locationId == null) errors.push('unknown:location_code');
    }

    if (tracking === 'QUANTITY_STOCK' && unit) {
      if (!ctx.units.has(unit)) errors.push('unknown:unit_code');
    }

    if (tracking === 'INDIVIDUAL_ASSET' && invNumber) {
      const key = invNumber.toLowerCase();
      if (numbersInFile.has(key)) errors.push('duplicate_in_file:inventory_number');
      else numbersInFile.set(key, rowNumber);
    }
    if (tracking === 'QUANTITY_STOCK' && sku) {
      const key = sku.toLowerCase();
      if (skusInFile.has(key)) errors.push('duplicate_in_file:sku_code');
      else skusInFile.set(key, rowNumber);
    }
    if (sourceRef) {
      const key = sourceRef.toLowerCase();
      if (sourcesInFile.has(key) || ctx.sourceRefsSeen.has(key)) {
        errors.push('duplicate:source_ref');
      } else sourcesInFile.set(key, rowNumber);
    }

    let operation: ImportRowOperation = 'error';
    let previewClass = 'ERROR';

    if (errors.length === 0) {
      if (tracking === 'INDIVIDUAL_ASSET') {
        const existing = ctx.assetsByNumber.get(invNumber.toLowerCase());
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
        const existing = ctx.stockBySku.get(sku.toLowerCase());
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
          // SKU exists without opening — allow OPENING movement (CREATE path)
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

    previewRows.push({
      rowNumber,
      operation,
      matchKey:
        tracking === 'INDIVIDUAL_ASSET' ? invNumber.toLowerCase() : sku.toLowerCase() || undefined,
      errors: previewClass === 'SKIP' ? [] : errors,
      data: {
        ...Object.fromEntries(
          INVENTORY_OPENING_HEADERS.map((h) => [h, sanitizeSpreadsheetCell(String(raw[h] ?? ''))]),
        ),
        tracking_type: tracking,
        ownership_kind: ownership,
        condition,
        category_id: categoryId ?? '',
        location_id: locationId ?? '',
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
    conflictCount: counters.conflictCount,
  };
}

const INSTRUCTIONS: Record<'bg' | 'ru' | 'en', string[]> = {
  bg: [
    `AMADEUS 11 · Inventory opening template · schema_version ${INVENTORY_SETUP_SCHEMA_VERSION}`,
    `Sheet: ${INVENTORY_OPENING_SHEET}. Meta sheet lists schema_version.`,
    'tracking_type: INDIVIDUAL_ASSET | QUANTITY_STOCK',
    'Assets require inventory_number. Stock requires sku_code, unit_code, opening_qty.',
    'ownership_kind: CONDOMINIUM | MANAGEMENT_COMPANY | THIRD_PARTY',
    'category_code / location_code match catalog codes (not UUIDs).',
    'estimated_value_eur is informational only — no finance postings.',
    'Preview is read-only. Commit uses Inventory RPCs only.',
    'Empty inventory is valid. Import is optional. Physical inventory is optional.',
  ],
  ru: [
    `AMADEUS 11 · Шаблон начального инвентаря · schema_version ${INVENTORY_SETUP_SCHEMA_VERSION}`,
    `Лист: ${INVENTORY_OPENING_SHEET}. Лист meta содержит schema_version.`,
    'tracking_type: INDIVIDUAL_ASSET | QUANTITY_STOCK',
    'Активы требуют inventory_number. Склад — sku_code, unit_code, opening_qty.',
    'ownership_kind: CONDOMINIUM | MANAGEMENT_COMPANY | THIRD_PARTY',
    'category_code / location_code — коды каталога (не UUID).',
    'estimated_value_eur только информационно — без финансовых проводок.',
    'Preview только для чтения. Commit через Inventory RPC.',
    'Пустой инвентарь допустим. Импорт необязателен. Физ. инвентаризация необязательна.',
  ],
  en: [
    `AMADEUS 11 · Inventory opening template · schema_version ${INVENTORY_SETUP_SCHEMA_VERSION}`,
    `Sheet: ${INVENTORY_OPENING_SHEET}. Meta sheet lists schema_version.`,
    'tracking_type: INDIVIDUAL_ASSET | QUANTITY_STOCK',
    'Assets require inventory_number. Stock requires sku_code, unit_code, opening_qty.',
    'ownership_kind: CONDOMINIUM | MANAGEMENT_COMPANY | THIRD_PARTY',
    'category_code / location_code match catalog codes (not UUIDs).',
    'estimated_value_eur is informational only — no finance postings.',
    'Preview is read-only. Commit uses Inventory RPCs only.',
    'Empty inventory is valid. Import is optional. Physical inventory is optional.',
  ],
};

function appendInstructionSheets(wb: XLSX.WorkBook) {
  for (const lang of ['bg', 'ru', 'en'] as const) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(INSTRUCTIONS[lang].map((line) => [line])),
      `instructions_${lang}`,
    );
  }
}

export function buildInventoryOpeningTemplateBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['schema_version', INVENTORY_SETUP_SCHEMA_VERSION],
      ['module', INVENTORY_MODULE_KEY],
      ['sheet', INVENTORY_OPENING_SHEET],
    ]),
    'meta',
  );

  const examples = [
    {
      tracking_type: 'INDIVIDUAL_ASSET',
      category_code: 'tools',
      item_name: 'Hammer drill',
      inventory_number: 'INV-TOOL-001',
      serial_number: 'SN-HD-7788',
      sku_code: '',
      ownership_kind: 'CONDOMINIUM',
      location_code: 'warehouse',
      condition: 'good',
      quantity: '',
      unit_code: '',
      opening_qty: '',
      estimated_value_eur: '120.00',
      source_ref: 'OPEN-ASSET-001',
      notes: 'equipment example',
    },
    {
      tracking_type: 'INDIVIDUAL_ASSET',
      category_code: 'cleaning',
      item_name: 'Floor scrubber',
      inventory_number: 'INV-CLN-010',
      serial_number: '',
      sku_code: '',
      ownership_kind: 'MANAGEMENT_COMPANY',
      location_code: 'basement',
      condition: 'fair',
      quantity: '',
      unit_code: '',
      opening_qty: '',
      estimated_value_eur: '800',
      source_ref: 'OPEN-ASSET-002',
      notes: 'cleaning machine',
    },
    {
      tracking_type: 'INDIVIDUAL_ASSET',
      category_code: 'furniture',
      item_name: 'Lobby sofa',
      inventory_number: 'INV-FURN-003',
      serial_number: '',
      sku_code: '',
      ownership_kind: 'CONDOMINIUM',
      location_code: 'lobby',
      condition: 'good',
      quantity: '',
      unit_code: '',
      opening_qty: '',
      estimated_value_eur: '',
      source_ref: 'OPEN-ASSET-003',
      notes: 'furniture',
    },
    {
      tracking_type: 'QUANTITY_STOCK',
      category_code: 'consumables',
      item_name: 'Trash bags 120L',
      inventory_number: '',
      serial_number: '',
      sku_code: 'SKU-BAG-120',
      ownership_kind: 'MANAGEMENT_COMPANY',
      location_code: 'warehouse',
      condition: '',
      quantity: '200',
      unit_code: 'pcs',
      opening_qty: '200',
      estimated_value_eur: '',
      source_ref: 'OPEN-STOCK-001',
      notes: 'consumables',
    },
    {
      tracking_type: 'QUANTITY_STOCK',
      category_code: 'tools',
      item_name: 'Cable ties',
      inventory_number: '',
      serial_number: '',
      sku_code: 'SKU-TIE-100',
      ownership_kind: 'CONDOMINIUM',
      location_code: 'warehouse',
      condition: '',
      quantity: '50',
      unit_code: 'pcs',
      opening_qty: '50',
      estimated_value_eur: '0.10',
      source_ref: 'OPEN-STOCK-002',
      notes: 'tools consumable',
    },
  ].map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, sanitizeSpreadsheetCell(String(v))]),
    ),
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(examples, { header: [...INVENTORY_OPENING_HEADERS] }),
    INVENTORY_OPENING_SHEET,
  );
  appendInstructionSheets(wb);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export function downloadInventoryOpeningTemplate(
  fileName = 'inventory_opening_template_v1.xlsx',
): void {
  const buf = buildInventoryOpeningTemplateBuffer();
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
  const version = readInventoryOpeningSchemaVersion(buffer);
  if (version == null) return { ok: false, error: 'missing_schema_version' };
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
  const sheet =
    book.Sheets[INVENTORY_OPENING_SHEET] ?? book.Sheets[book.SheetNames.find((n) => n !== 'meta' && !n.startsWith('instructions_')) ?? ''] ;
  if (!sheet) return { ok: false, error: 'sheet_missing' };
  const rowsRaw = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });
  if (!rowsRaw.length) return { ok: false, error: 'empty_sheet' };
  const headerRow = (rowsRaw[0] ?? []).map((h) => String(h ?? '').trim().toLowerCase());
  const missing = INVENTORY_OPENING_HEADERS.filter((h) => !headerRow.includes(h));
  // Allow subset: require tracking_type, item_name, ownership_kind at minimum
  for (const req of ['tracking_type', 'item_name', 'ownership_kind'] as const) {
    if (!headerRow.includes(req)) return { ok: false, error: `missing_headers:${req}` };
  }
  void missing;
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rowsRaw.length; i += 1) {
    const line = rowsRaw[i] ?? [];
    const rec: Record<string, string> = {};
    let any = false;
    for (const col of INVENTORY_OPENING_HEADERS) {
      const idx = headerRow.indexOf(col);
      const raw = idx >= 0 ? String(line[idx] ?? '').trim() : '';
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

/** Empty / manual setup completion flags (no import required). */
export function inventorySetupManualComplete(draft: Record<string, unknown>): boolean {
  return (
    draft.confirmed === true ||
    draft.skip_import === true ||
    draft.empty_inventory_ok === true ||
    draft.start_physical_inventory === true
  );
}
