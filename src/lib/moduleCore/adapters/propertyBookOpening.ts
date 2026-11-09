/**
 * Phase IS-2 — Property Book opening-data helpers.
 * Reuses canonical Book sheets/headers; never invents parallel apt/owner stores.
 * Default: preserve existing ownership (no overwrite). CREATE only when explicitly allowed.
 */

import * as XLSX from 'xlsx';
import {
  BOOK_ENTITY_KINDS,
  BOOK_OBJECTS_SHEET,
  BOOK_OWNERS_SHEET,
  OWNERSHIP_TYPES,
  buildPropertyBookTemplateBuffer,
  propertyBookTemplateFileName,
  type PropertyBookWorkbookPayload,
} from '@/lib/propertyBookAdmin';
import type { ImportPreviewResult, ImportPreviewRow, ImportRowOperation } from '@/lib/moduleCore/types';
import { sanitizeSpreadsheetCell } from '@/lib/moduleCore/xlsxEngine';
import {
  downloadImportTemplateBuffer,
  toImportTemplateLocale,
  type ImportTemplateLocale,
} from '@/lib/importTemplates';

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

export type PropertyBookFieldIssues = { errors: string[]; warnings: string[] };

/** Hard: cannot safely match/save. Soft: importable, needs clarification. */
export function validatePropertyBookObjectProps(row: Record<string, string>): string[] {
  return splitPropertyBookObjectProps(row).errors;
}

export function splitPropertyBookObjectProps(row: Record<string, string>): PropertyBookFieldIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!row.apartment_number?.trim()) errors.push('required:apartment_number');
  if (!row.purpose?.trim()) warnings.push('required:purpose');
  if (!row.area_sqm?.trim()) warnings.push('required:area_sqm');
  if (!row.ideal_parts_percent?.trim()) warnings.push('required:ideal_parts_percent');
  if (!row.ownership_type?.trim()) warnings.push('required:ownership_type');
  else if (!OWNERSHIP_SET.has(row.ownership_type.trim().toLowerCase())) {
    errors.push('invalid:ownership_type');
  }
  const area = Number(row.area_sqm);
  if (row.area_sqm?.trim() && !(area > 0)) errors.push('invalid:area_sqm');
  const ideal = Number(row.ideal_parts_percent);
  if (row.ideal_parts_percent?.trim() && !(ideal >= 0)) errors.push('invalid:ideal_parts_percent');
  return { errors, warnings };
}

export function validatePropertyBookOwnerRow(row: Record<string, string>): string[] {
  return splitPropertyBookOwnerRow(row).errors;
}

export function splitPropertyBookOwnerRow(row: Record<string, string>): PropertyBookFieldIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!row.apartment_number?.trim()) errors.push('required:apartment_number');
  const kind = (row.entity_kind ?? '').trim().toLowerCase();
  if (!kind) warnings.push('required:entity_kind');
  else if (!ENTITY_KIND_SET.has(kind)) errors.push('invalid:entity_kind');

  if (kind === 'natural_person') {
    if (!row.first_name?.trim()) warnings.push('required:first_name');
    if (!row.last_name?.trim()) warnings.push('required:last_name');
  }
  if (kind === 'legal_entity' || kind === 'sole_trader') {
    if (!row.entity_name?.trim()) warnings.push('required:entity_name');
    if (!row.eik_bulstat?.trim()) warnings.push('required:eik_bulstat');
  }
  if (!row.email?.trim()) warnings.push('required:email');

  const share = Number(row.ownership_share_percent);
  if (!row.ownership_share_percent?.trim() || !(share > 0)) {
    warnings.push('invalid:ownership_share_percent');
  }
  const ideal = Number(row.ideal_parts_percent);
  if (row.ideal_parts_percent?.trim() && !(ideal >= 0)) {
    errors.push('invalid:ideal_parts_percent');
  }
  // Never trust client property_id — apartment_number is the match key.
  if (Object.prototype.hasOwnProperty.call(row, 'property_id') && String(row.property_id ?? '').trim()) {
    errors.push('untrusted_property_id');
  }
  return { errors, warnings };
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
  let warningCount = 0;
  let clarificationCount = 0;

  const bump = (op: ImportRowOperation) => {
    if (op === 'create') createCount += 1;
    else if (op === 'update') updateCount += 1;
    else if (op === 'skip') skipCount += 1;
    else errorCount += 1;
  };

  payload.objects.forEach((raw, idx) => {
    const rowNumber = idx + 2;
    const split = splitPropertyBookObjectProps(raw);
    const errors = [...split.errors];
    const warnings = [...split.warnings];
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
    if (warnings.length) {
      warningCount += warnings.length;
      if (operation !== 'error') clarificationCount += 1;
    }
    rows.push({
      rowNumber,
      operation,
      data: { sheet: BOOK_OBJECTS_SHEET, ...raw },
      errors,
      warnings,
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
    const split = splitPropertyBookOwnerRow(raw);
    const errors = [...split.errors];
    const warnings = [...split.warnings];
    const apt = normApt(raw.apartment_number);

    if (apt && !objectAptsInFile.has(apt) && !existing.has(apt)) {
      errors.push('owner_without_object_row');
    }

    // Hard ownership contradictions only (soft incompleteness stays as warnings).
    if (apt && ownersByApt.has(apt)) {
      const group = ownersByApt.get(apt)!;
      const first = group[0] === raw;
      const hasShares = group.some((r) => String(r.ownership_share_percent ?? '').trim());
      const sum = group.reduce((acc, r) => acc + (Number(r.ownership_share_percent) || 0), 0);
      if (first && hasShares && Math.abs(sum - 100) > 0.01) {
        errors.push('shares_must_sum_100');
      }
      const soleOwners = group.length === 1;
      const objOp = rows.find((r) => r.matchKey === apt && r.data.sheet === BOOK_OBJECTS_SHEET);
      const ownershipType = String(objOp?.data.ownership_type ?? '')
        .trim()
        .toLowerCase();
      const objectIdeal = Number(objOp?.data.ideal_parts_percent);
      const idealSum = group.reduce((acc, r) => acc + (Number(r.ideal_parts_percent) || 0), 0);
      const kindOf = (r: Record<string, string>) =>
        String(r.entity_kind ?? '').trim().toLowerCase();
      const legalN = group.filter((r) => kindOf(r) === 'legal_entity').length;
      const naturalN = group.filter(
        (r) => kindOf(r) === 'natural_person' || kindOf(r) === 'sole_trader',
      ).length;
      if (first && legalN > 0 && naturalN > 0) errors.push('mixed_natural_legal_forbidden');
      if (ownershipType === 'sole' && !soleOwners && first) {
        errors.push('sole_requires_one_owner');
      }
      if (ownershipType === 'shared' && soleOwners && first) {
        errors.push('shared_requires_two_owners');
      }
      if (
        first &&
        ownershipType === 'shared' &&
        Number.isFinite(objectIdeal) &&
        group.some((r) => String(r.ideal_parts_percent ?? '').trim()) &&
        Math.abs(idealSum - objectIdeal) > 0.01
      ) {
        errors.push('owner_ideal_parts_sum_mismatch');
      }
      if (
        first &&
        ownershipType === 'sole' &&
        soleOwners &&
        Number.isFinite(objectIdeal) &&
        group.some((r) => String(r.ideal_parts_percent ?? '').trim()) &&
        Math.abs(idealSum - objectIdeal) > 0.01
      ) {
        errors.push('sole_ideal_parts_mismatch');
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
    if (warnings.length) {
      warningCount += warnings.length;
      if (operation !== 'error') clarificationCount += 1;
    }
    rows.push({
      rowNumber,
      operation,
      data: { sheet: BOOK_OWNERS_SHEET, ...raw },
      errors,
      warnings,
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
    warningCount,
    clarificationCount,
  };
}

function rpcErrorCodes(entry: unknown): string[] {
  if (entry == null) return ['rpc_error'];
  if (typeof entry === 'string') return [entry];
  if (typeof entry !== 'object') return ['rpc_error'];
  const obj = entry as Record<string, unknown>;
  const codes = obj.codes;
  if (Array.isArray(codes)) {
    return codes.map((c) => String(c)).filter(Boolean);
  }
  if (typeof obj.code === 'string' && obj.code.trim()) return [obj.code.trim()];
  return [JSON.stringify(entry)];
}

function rpcApartmentKey(entry: unknown): string | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const apt = (entry as Record<string, unknown>).apartment_number;
  return apt == null ? undefined : normApt(String(apt));
}

/** Map canonical dry-run RPC payload into Core preview counters (audit-friendly). */
export function previewFromPropertyBookDryRun(result: {
  ok?: boolean;
  errors?: unknown[];
  warnings?: unknown[];
  existing_properties?: unknown[];
  new_properties?: unknown[];
  changes?: unknown[];
  duplicates?: unknown[];
  clarification_count?: number;
  importable_count?: number;
  blocking_error_count?: number;
}): ImportPreviewResult {
  const errors = Array.isArray(result.errors) ? result.errors : [];
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
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
      data: { detail: JSON.stringify(d), sheet: 'validation' },
      errors: ['duplicate'],
      warnings: [],
      matchKey: rpcApartmentKey(d),
    });
  }
  for (const e of errors) {
    const codes = rpcErrorCodes(e);
    rows.push({
      rowNumber: rowNumber++,
      operation: 'error',
      data: {
        sheet: 'validation',
        detail: JSON.stringify(e),
        apartment_number: rpcApartmentKey(e) ?? '',
      },
      errors: codes,
      warnings: [],
      matchKey: rpcApartmentKey(e),
    });
  }
  for (const w of warnings) {
    const codes = rpcErrorCodes(w);
    rows.push({
      rowNumber: rowNumber++,
      operation: 'create',
      data: {
        sheet: 'validation',
        detail: JSON.stringify(w),
        apartment_number: rpcApartmentKey(w) ?? '',
        severity: 'warning',
      },
      errors: [],
      warnings: codes,
      matchKey: rpcApartmentKey(w),
    });
  }
  for (const item of created) {
    rows.push({
      rowNumber: rowNumber++,
      operation: 'create',
      data: { detail: JSON.stringify(item) },
      errors: [],
      warnings: [],
      matchKey: rpcApartmentKey(item),
    });
  }
  for (const item of changes) {
    rows.push({
      rowNumber: rowNumber++,
      operation: 'update',
      data: { detail: JSON.stringify(item) },
      errors: [],
      warnings: [],
      matchKey: rpcApartmentKey(item),
    });
  }
  for (const item of existing) {
    rows.push({
      rowNumber: rowNumber++,
      operation: 'skip',
      data: { detail: JSON.stringify(item) },
      errors: [],
      warnings: [],
      matchKey: rpcApartmentKey(item),
    });
  }

  return {
    schemaVersion: PROPERTY_BOOK_SETUP_SCHEMA_VERSION,
    rows,
    createCount: created.length,
    updateCount: changes.length,
    skipCount: existing.length,
    errorCount: errors.length + duplicates.length,
    warningCount: warnings.length,
    clarificationCount:
      typeof result.clarification_count === 'number' ? result.clarification_count : warnings.length,
  };
}

/**
 * Merge local classify + server dry-run so preview surfaces the same ownership
 * codes commit would raise (and blocks confirm when RPC found validation errors).
 */
export function mergePropertyBookLocalAndRpcPreview(
  local: ImportPreviewResult,
  rpc: ImportPreviewResult,
): ImportPreviewResult {
  const rows = local.rows.map((row) => ({ ...row, errors: [...row.errors] }));
  let createCount = local.createCount;
  let updateCount = local.updateCount;
  let skipCount = local.skipCount;
  let errorCount = local.errorCount;

  const markError = (row: ImportPreviewRow, codes: string[]) => {
    const was = row.operation;
    for (const c of codes) {
      if (!row.errors.includes(c)) row.errors.push(c);
    }
    if (row.operation !== 'error') {
      if (was === 'create') createCount -= 1;
      else if (was === 'update') updateCount -= 1;
      else if (was === 'skip') skipCount -= 1;
      row.operation = 'error';
      errorCount += 1;
    }
  };

  for (const rpcRow of rpc.rows.filter((r) => r.operation === 'error')) {
    const apt = rpcRow.matchKey;
    const codes = rpcRow.errors.length ? rpcRow.errors : ['rpc_error'];
    if (apt) {
      const targets = rows.filter((r) => r.matchKey === apt);
      if (targets.length) {
        for (const t of targets) markError(t, codes);
        continue;
      }
    }
    rows.push({
      ...rpcRow,
      rowNumber: rows.length + 2,
      errors: codes,
    });
    errorCount += 1;
  }

  return {
    schemaVersion: PROPERTY_BOOK_SETUP_SCHEMA_VERSION,
    rows,
    createCount: Math.max(0, createCount),
    updateCount: Math.max(0, updateCount),
    skipCount: Math.max(0, skipCount),
    errorCount,
  };
}

/** Localized template: Objects + Owners data sheets + one Instructions sheet. */
export function buildPropertyBookIs2TemplateBuffer(
  locale: ImportTemplateLocale | string = 'ru',
): ArrayBuffer {
  return buildPropertyBookTemplateBuffer(toImportTemplateLocale(locale));
}

export function downloadPropertyBookIs2Template(
  localeOrFileName?: ImportTemplateLocale | string,
  fileName?: string,
): void {
  const isFileName = typeof localeOrFileName === 'string' && localeOrFileName.endsWith('.xlsx');
  const locale = toImportTemplateLocale(isFileName ? 'ru' : localeOrFileName);
  const name = fileName ?? (isFileName ? (localeOrFileName as string) : propertyBookTemplateFileName(locale));
  downloadImportTemplateBuffer(buildPropertyBookIs2TemplateBuffer(locale), name);
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
