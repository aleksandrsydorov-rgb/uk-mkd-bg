/**
 * Phase IS-2 — Property Book opening-data helpers.
 * Reuses canonical Book sheets/headers; never invents parallel apt/owner stores.
 * Default: preserve existing ownership (no overwrite). CREATE only when explicitly allowed.
 */

import * as XLSX from 'xlsx';
import {
  BOOK_ENTITY_KINDS,
  BOOK_OBJECTS_CSV_HEADERS,
  BOOK_OBJECTS_SHEET,
  BOOK_OWNERS_CSV_HEADERS,
  BOOK_OWNERS_SHEET,
  OWNERSHIP_TYPES,
  type PropertyBookWorkbookPayload,
} from '@/lib/propertyBookAdmin';
import type { ImportPreviewResult, ImportPreviewRow, ImportRowOperation } from '@/lib/moduleCore/types';
import { sanitizeSpreadsheetCell } from '@/lib/moduleCore/xlsxEngine';

export const PROPERTY_BOOK_MODULE_KEY = 'property_book';
export const PROPERTY_BOOK_SETUP_SCHEMA_VERSION = '1.0';

export type PropertyBookOpeningPolicy = {
  /** When false (default), existing apartments are SKIP — no overwrite of shares/ideal parts. */
  allowOverwrite: boolean;
  /** When false, missing apartments are ERROR until admin confirms create for empty/new installs. */
  allowCreateMissing: boolean;
};

export const DEFAULT_PROPERTY_BOOK_OPENING_POLICY: PropertyBookOpeningPolicy = {
  allowOverwrite: false,
  allowCreateMissing: false,
};

const ENTITY_KIND_SET = new Set<string>(BOOK_ENTITY_KINDS);
const OWNERSHIP_SET = new Set<string>(OWNERSHIP_TYPES);

function normApt(value: string | undefined | null): string {
  return String(value ?? '').trim().toLowerCase();
}

export function validatePropertyBookObjectProps(row: Record<string, string>): string[] {
  const errors: string[] = [];
  if (!row.apartment_number?.trim()) errors.push('required:apartment_number');
  if (!row.purpose?.trim()) errors.push('required:purpose');
  if (!row.area_sqm?.trim()) errors.push('required:area_sqm');
  if (!row.ideal_parts_percent?.trim()) errors.push('required:ideal_parts_percent');
  if (!row.ownership_type?.trim()) errors.push('required:ownership_type');
  else if (!OWNERSHIP_SET.has(row.ownership_type.trim().toLowerCase())) {
    errors.push('invalid:ownership_type');
  }
  const area = Number(row.area_sqm);
  if (row.area_sqm?.trim() && !(area > 0)) errors.push('invalid:area_sqm');
  const ideal = Number(row.ideal_parts_percent);
  if (row.ideal_parts_percent?.trim() && !(ideal >= 0)) errors.push('invalid:ideal_parts_percent');
  return errors;
}

export function validatePropertyBookOwnerRow(row: Record<string, string>): string[] {
  const errors: string[] = [];
  if (!row.apartment_number?.trim()) errors.push('required:apartment_number');
  const kind = (row.entity_kind ?? '').trim().toLowerCase();
  if (!kind) errors.push('required:entity_kind');
  else if (!ENTITY_KIND_SET.has(kind)) errors.push('invalid:entity_kind');

  if (kind === 'natural_person') {
    if (!row.first_name?.trim()) errors.push('required:first_name');
    if (!row.last_name?.trim()) errors.push('required:last_name');
  }
  if (kind === 'legal_entity' || kind === 'sole_trader') {
    if (!row.entity_name?.trim()) errors.push('required:entity_name');
    if (!row.eik_bulstat?.trim()) errors.push('required:eik_bulstat');
  }

  const share = Number(row.ownership_share_percent);
  if (!row.ownership_share_percent?.trim() || !(share > 0)) {
    errors.push('invalid:ownership_share_percent');
  }
  const ideal = Number(row.ideal_parts_percent);
  if (row.ideal_parts_percent?.trim() && !(ideal >= 0)) {
    errors.push('invalid:ideal_parts_percent');
  }
  // Never trust client property_id — apartment_number is the match key.
  if (Object.prototype.hasOwnProperty.call(row, 'property_id') && String(row.property_id ?? '').trim()) {
    errors.push('untrusted_property_id');
  }
  return errors;
}

export function classifyPropertyBookOpeningRows(
  payload: PropertyBookWorkbookPayload,
  existingApartmentNumbers: Iterable<string>,
  policy: PropertyBookOpeningPolicy = DEFAULT_PROPERTY_BOOK_OPENING_POLICY,
): ImportPreviewResult {
  const existing = new Set(
    [...existingApartmentNumbers].map((a) => normApt(a)).filter(Boolean),
  );
  const objectAptsInFile = new Map<string, number>();
  const rows: ImportPreviewRow[] = [];
  let createCount = 0;
  let updateCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  const bump = (op: ImportRowOperation) => {
    if (op === 'create') createCount += 1;
    else if (op === 'update') updateCount += 1;
    else if (op === 'skip') skipCount += 1;
    else errorCount += 1;
  };

  payload.objects.forEach((raw, idx) => {
    const rowNumber = idx + 2;
    const errors = validatePropertyBookObjectProps(raw);
    const apt = normApt(raw.apartment_number);
    if (apt) {
      if (objectAptsInFile.has(apt)) errors.push('duplicate_in_file:apartment_number');
      else objectAptsInFile.set(apt, rowNumber);
    }

    let operation: ImportRowOperation = 'error';
    if (errors.length === 0 && apt) {
      if (existing.has(apt)) {
        if (policy.allowOverwrite) operation = 'update';
        else operation = 'skip'; // preserve existing ownership / shares / ideal parts
      } else if (policy.allowCreateMissing) {
        operation = 'create';
      } else {
        errors.push('missing_apartment:confirm_create_required');
        operation = 'error';
      }
    }

    if (errors.length) operation = 'error';
    bump(operation);
    rows.push({
      rowNumber,
      operation,
      data: { sheet: BOOK_OBJECTS_SHEET, ...raw },
      errors,
      matchKey: apt || undefined,
    });
  });

  const ownersByApt = new Map<string, Record<string, string>[]>();
  payload.owners.forEach((raw) => {
    const apt = normApt(raw.apartment_number);
    if (!apt) return;
    const list = ownersByApt.get(apt) ?? [];
    list.push(raw);
    ownersByApt.set(apt, list);
  });

  payload.owners.forEach((raw, idx) => {
    const rowNumber = idx + 2;
    const errors = validatePropertyBookOwnerRow(raw);
    const apt = normApt(raw.apartment_number);

    if (apt && !objectAptsInFile.has(apt) && !existing.has(apt)) {
      errors.push('owner_without_object_row');
    }

    // Soft share-sum check per apartment (owners sheet only).
    if (apt && ownersByApt.has(apt)) {
      const group = ownersByApt.get(apt)!;
      const sum = group.reduce((acc, r) => acc + (Number(r.ownership_share_percent) || 0), 0);
      if (Math.abs(sum - 100) > 0.01) {
        // Attach once on first owner row of the group
        const first = group[0] === raw;
        if (first) errors.push('ownership_share_sum_not_100');
      }
      const soleOwners = group.length === 1;
      const objOp = rows.find((r) => r.matchKey === apt && r.data.sheet === BOOK_OBJECTS_SHEET);
      const ownershipType = (objOp?.data.ownership_type ?? '').toLowerCase();
      if (ownershipType === 'sole' && !soleOwners) {
        if (group[0] === raw) errors.push('sole_requires_one_owner');
      }
      if (ownershipType === 'shared' && soleOwners) {
        if (group[0] === raw) errors.push('shared_requires_multiple_owners');
      }
    }

    let operation: ImportRowOperation = 'error';
    if (errors.length === 0 && apt) {
      if (existing.has(apt)) {
        operation = policy.allowOverwrite ? 'update' : 'skip';
      } else if (policy.allowCreateMissing) {
        operation = 'create';
      } else {
        errors.push('missing_apartment:confirm_create_required');
        operation = 'error';
      }
    }
    if (errors.length) operation = 'error';
    bump(operation);
    rows.push({
      rowNumber,
      operation,
      data: { sheet: BOOK_OWNERS_SHEET, ...raw },
      errors,
      matchKey: apt || undefined,
    });
  });

  return {
    schemaVersion: PROPERTY_BOOK_SETUP_SCHEMA_VERSION,
    rows,
    createCount,
    updateCount,
    skipCount,
    errorCount,
  };
}

/** Map canonical dry-run RPC payload into Core preview counters (audit-friendly). */
export function previewFromPropertyBookDryRun(result: {
  ok?: boolean;
  errors?: unknown[];
  existing_properties?: unknown[];
  new_properties?: unknown[];
  changes?: unknown[];
  duplicates?: unknown[];
}): ImportPreviewResult {
  const errors = Array.isArray(result.errors) ? result.errors : [];
  const existing = Array.isArray(result.existing_properties) ? result.existing_properties : [];
  const created = Array.isArray(result.new_properties) ? result.new_properties : [];
  const changes = Array.isArray(result.changes) ? result.changes : [];
  const duplicates = Array.isArray(result.duplicates) ? result.duplicates : [];

  const rows: ImportPreviewRow[] = [];
  let rowNumber = 1;

  for (const d of duplicates) {
    rows.push({
      rowNumber: rowNumber++,
      operation: 'error',
      data: { detail: JSON.stringify(d) },
      errors: ['duplicate'],
    });
  }
  for (const e of errors) {
    rows.push({
      rowNumber: rowNumber++,
      operation: 'error',
      data: { detail: JSON.stringify(e) },
      errors: ['rpc_error'],
    });
  }
  for (const item of created) {
    rows.push({
      rowNumber: rowNumber++,
      operation: 'create',
      data: { detail: JSON.stringify(item) },
      errors: [],
    });
  }
  for (const item of changes) {
    rows.push({
      rowNumber: rowNumber++,
      operation: 'update',
      data: { detail: JSON.stringify(item) },
      errors: [],
    });
  }
  for (const item of existing) {
    rows.push({
      rowNumber: rowNumber++,
      operation: 'skip',
      data: { detail: JSON.stringify(item) },
      errors: [],
    });
  }

  return {
    schemaVersion: PROPERTY_BOOK_SETUP_SCHEMA_VERSION,
    rows,
    createCount: created.length,
    updateCount: changes.length,
    skipCount: existing.length,
    errorCount: errors.length + duplicates.length,
  };
}

const INSTRUCTIONS: Record<'bg' | 'ru' | 'en', string[]> = {
  bg: [
    'Книга на етажната собственост — начален импорт (IS-2)',
    'Листове: objects (обекти) и owners (собственици). Ключ: apartment_number.',
    'По подразбиране съществуващите апартаменти/собственици НЕ се презаписват (SKIP).',
    'CREATE само след изрично потвърждение за липсващи апартаменти (празна/нова инсталация).',
    'Корекции на вече попълнени данни — през законовите процедури за прехвърляне, не през импорт.',
    'ownership_type: sole | shared. entity_kind: natural_person | legal_entity | sole_trader.',
    'Сумата ownership_share_percent за апартамент трябва да е 100.',
  ],
  ru: [
    'Книга этажной собственности — начальный импорт (IS-2)',
    'Листы: objects (объекты) и owners (собственники). Ключ: apartment_number.',
    'По умолчанию существующие квартиры/собственники НЕ перезаписываются (SKIP).',
    'CREATE только после явного подтверждения для отсутствующих квартир (пустая/новая установка).',
    'Исправления уже заполненных данных — через законные процедуры передачи, не через импорт.',
    'ownership_type: sole | shared. entity_kind: natural_person | legal_entity | sole_trader.',
    'Сумма ownership_share_percent по квартире должна быть 100.',
  ],
  en: [
    'Property Book — opening import (IS-2)',
    'Sheets: objects and owners. Match key: apartment_number.',
    'By default existing apartments/owners are NOT overwritten (SKIP).',
    'CREATE only after explicit confirmation for missing apartments (empty/new install).',
    'Corrections to populated data use lawful ownership-transfer workflows, not generic import overwrite.',
    'ownership_type: sole | shared. entity_kind: natural_person | legal_entity | sole_trader.',
    'ownership_share_percent must sum to 100 per apartment.',
  ],
};

/** Template with objects + owners + BG/RU/EN instruction sheets. */
export function buildPropertyBookIs2TemplateBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  const objectsExample = [
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
  ].map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, sanitizeSpreadsheetCell(String(v))]),
    ),
  );

  const ownersExample = [
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
      entity_kind: 'legal_entity',
      ownership_share_percent: '40',
      ideal_parts_percent: '1.0',
      email: 'office@example.com',
      first_name: '',
      middle_name: '',
      last_name: '',
      entity_name: 'EXAMPLE EOOD',
      eik_bulstat: '123456789',
    },
  ].map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, sanitizeSpreadsheetCell(String(v))]),
    ),
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(objectsExample, { header: [...BOOK_OBJECTS_CSV_HEADERS] }),
    BOOK_OBJECTS_SHEET,
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(ownersExample, { header: [...BOOK_OWNERS_CSV_HEADERS] }),
    BOOK_OWNERS_SHEET,
  );

  for (const lang of ['bg', 'ru', 'en'] as const) {
    const aoa = INSTRUCTIONS[lang].map((line) => [line]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), `instructions_${lang}`);
  }

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export function downloadPropertyBookIs2Template(
  fileName = 'property_book_opening_template.xlsx',
): void {
  const buf = buildPropertyBookIs2TemplateBuffer();
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

export function buildPropertyBookErrorReportXlsx(preview: ImportPreviewResult): ArrayBuffer {
  const aoa: string[][] = [['rowNumber', 'sheet', 'operation', 'matchKey', 'errors', 'data']];
  for (const row of preview.rows.filter((r) => r.errors.length || r.operation === 'error')) {
    aoa.push([
      String(row.rowNumber),
      sanitizeSpreadsheetCell(row.data.sheet ?? ''),
      row.operation,
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

export function downloadPropertyBookErrorReport(
  preview: ImportPreviewResult,
  fileName = 'property_book_import_errors.xlsx',
): void {
  const buf = buildPropertyBookErrorReportXlsx(preview);
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
