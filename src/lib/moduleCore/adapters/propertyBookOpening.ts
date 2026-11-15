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
  buildPropertyBookTemplateBuffer,
  coerceBookEntityKindField,
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
import {
  PROPERTY_BOOK_OBJECT_NUMERIC_FIELDS,
  PROPERTY_BOOK_OWNER_NUMERIC_FIELDS,
  normalizePropertyBookApartmentNumber,
  normalizePropertyBookNumericFields,
  parseImportDecimal,
  propertyBookIdentityKey,
  propertyBookIdentityLabel,
  propertyBookIdentityParts,
} from '@/lib/propertyBookIdentity';
import { normalizeOwnershipType } from '@/lib/propertyBookImportPreview';

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

function normApt(value: string | undefined | null): string {
  return normalizePropertyBookApartmentNumber(value).toLowerCase();
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
  // Ownership type is set on the owners step in two-step first-run; empty is not an
  // objects-sheet clarification. Invalid non-empty values remain hard errors.
  if (row.ownership_type?.trim() && !normalizeOwnershipType(row.ownership_type)) {
    errors.push('invalid:ownership_type');
  }
  const area = parseImportDecimal(row.area_sqm);
  if (row.area_sqm?.trim() && !(area != null && area > 0)) errors.push('invalid:area_sqm');
  const living = parseImportDecimal(row.living_area_sqm);
  if (row.living_area_sqm?.trim() && !(living != null && living > 0)) {
    errors.push('invalid:living_area_sqm');
  }
  const ideal = parseImportDecimal(row.ideal_parts_percent);
  if (row.ideal_parts_percent?.trim() && !(ideal != null && ideal >= 0)) {
    errors.push('invalid:ideal_parts_percent');
  }
  return { errors, warnings };
}

export function validatePropertyBookOwnerRow(row: Record<string, string>): string[] {
  return splitPropertyBookOwnerRow(row).errors;
}

export function splitPropertyBookOwnerRow(row: Record<string, string>): PropertyBookFieldIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!row.apartment_number?.trim()) errors.push('required:apartment_number');
  const coerced = coerceBookEntityKindField(row.entity_kind);
  if (coerced !== (row.entity_kind ?? '')) {
    row.entity_kind = coerced;
  }
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

  const share = parseImportDecimal(row.ownership_share_percent);
  if (!row.ownership_share_percent?.trim() || !(share != null && share > 0)) {
    warnings.push('invalid:ownership_share_percent');
  }
  const ideal = parseImportDecimal(row.ideal_parts_percent);
  if (row.ideal_parts_percent?.trim() && !(ideal != null && ideal >= 0)) {
    errors.push('invalid:ideal_parts_percent');
  }
  // Never trust client property_id — apartment_number is the match key.
  if (Object.prototype.hasOwnProperty.call(row, 'property_id') && String(row.property_id ?? '').trim()) {
    errors.push('untrusted_property_id');
  }
  return { errors, warnings };
}

export type PropertyBookExistingIdentity = {
  apartment_number?: string | null;
  section_code?: string | null;
  block_code?: string | null;
};

export function classifyPropertyBookOpeningRows(
  payload: PropertyBookWorkbookPayload,
  existingApartmentNumbers: Iterable<string | PropertyBookExistingIdentity>,
  policy: PropertyBookOpeningPolicy = DEFAULT_PROPERTY_BOOK_OPENING_POLICY,
): ImportPreviewResult {
  const existing = new Set<string>();
  for (const item of existingApartmentNumbers) {
    if (typeof item === 'string') {
      const apt = normApt(item);
      if (apt) existing.add(apt);
      continue;
    }
    const key = propertyBookIdentityKey(item);
    if (key) existing.add(key);
    // Legacy callers may still pass bare apartment numbers via objects shaped only with apt.
    const aptOnly = normApt(item.apartment_number);
    if (aptOnly && !item.section_code && !item.block_code) existing.add(aptOnly);
  }

  const objectKeysInFile = new Map<string, number>();
  const aptNumbersNeedingSection = new Map<string, number[]>();
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

  const normalizedObjects = payload.objects.map((raw) =>
    normalizePropertyBookNumericFields({ ...raw }, PROPERTY_BOOK_OBJECT_NUMERIC_FIELDS),
  );

  // First pass: detect apartment numbers that appear with more than one section/block identity.
  const aptToKeys = new Map<string, Set<string>>();
  for (const raw of normalizedObjects) {
    const parts = propertyBookIdentityParts(raw);
    if (!parts.apartmentNumber) continue;
    const apt = parts.apartmentNumber.toLowerCase();
    const key = propertyBookIdentityKey(parts);
    const set = aptToKeys.get(apt) ?? new Set<string>();
    set.add(key);
    aptToKeys.set(apt, set);
  }

  normalizedObjects.forEach((raw, idx) => {
    const rowNumber = Number(raw._row) || idx + 2;
    const split = splitPropertyBookObjectProps(raw);
    const errors = [...split.errors];
    const warnings = [...split.warnings];
    const parts = propertyBookIdentityParts(raw);
    const key = propertyBookIdentityKey(parts);
    const apt = parts.apartmentNumber.toLowerCase();

    if (key) {
      const prevRow = objectKeysInFile.get(key);
      if (prevRow != null) {
        errors.push('duplicate_in_file:apartment_number');
        errors.push(`duplicate_rows:${prevRow},${rowNumber}`);
        if (!parts.sectionCode && !parts.blockCode) {
          errors.push('section_code_required_for_disambiguation');
        }
      } else {
        objectKeysInFile.set(key, rowNumber);
      }
    }

    // Same apartment number used under different identities, but this row omitted section/block.
    const siblingKeys = apt ? aptToKeys.get(apt) : undefined;
    if (
      apt &&
      siblingKeys &&
      siblingKeys.size > 1 &&
      !parts.sectionCode &&
      !parts.blockCode
    ) {
      errors.push('section_code_required_for_disambiguation');
      const list = aptNumbersNeedingSection.get(apt) ?? [];
      list.push(rowNumber);
      aptNumbersNeedingSection.set(apt, list);
    }

    let operation: ImportRowOperation = 'error';
    if (errors.length === 0 && key) {
      const exists =
        existing.has(key) ||
        // Legacy book rows that only stored a bare apartment number.
        (!parts.sectionCode && !parts.blockCode && existing.has(apt));
      if (exists) {
        if (policy.allowOverwrite) operation = 'update';
        else operation = 'skip';
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
      data: {
        sheet: BOOK_OBJECTS_SHEET,
        ...raw,
        _identity_label: propertyBookIdentityLabel(parts),
      },
      errors,
      warnings,
      matchKey: key || undefined,
    });
  });

  const normalizedOwners = payload.owners.map((raw) =>
    normalizePropertyBookNumericFields({ ...raw }, PROPERTY_BOOK_OWNER_NUMERIC_FIELDS),
  );

  const ownersByKey = new Map<string, Record<string, string>[]>();
  normalizedOwners.forEach((raw) => {
    const key = propertyBookIdentityKey(raw);
    if (!key) return;
    const list = ownersByKey.get(key) ?? [];
    list.push(raw);
    ownersByKey.set(key, list);
  });

  normalizedOwners.forEach((raw, idx) => {
    const rowNumber = Number(raw._row) || idx + 2;
    const split = splitPropertyBookOwnerRow(raw);
    const errors = [...split.errors];
    const warnings = [...split.warnings];
    const parts = propertyBookIdentityParts(raw);
    const key = propertyBookIdentityKey(parts);
    const apt = parts.apartmentNumber.toLowerCase();

    const objectExistsInFile = key ? objectKeysInFile.has(key) : false;
    const existsInDb =
      (key && existing.has(key)) ||
      (!parts.sectionCode && !parts.blockCode && apt && existing.has(apt));
    if (key && !objectExistsInFile && !existsInDb) {
      // Owner may omit section when the objects sheet has exactly one matching apartment number.
      const aptKeys = [...objectKeysInFile.keys()].filter((k) => k.startsWith(`${apt}\u0001`));
      if (!(apt && aptKeys.length === 1 && objectKeysInFile.has(aptKeys[0]!))) {
        if (apt && (aptToKeys.get(apt)?.size ?? 0) > 1 && !parts.sectionCode && !parts.blockCode) {
          errors.push('section_code_required_for_disambiguation');
        } else {
          errors.push('owner_without_object_row');
        }
      }
    }

    const resolvedKey =
      key && objectKeysInFile.has(key)
        ? key
        : apt && [...objectKeysInFile.keys()].filter((k) => k.startsWith(`${apt}\u0001`)).length === 1
          ? [...objectKeysInFile.keys()].find((k) => k.startsWith(`${apt}\u0001`))
          : key;

    if (resolvedKey && ownersByKey.has(resolvedKey)) {
      const group = ownersByKey.get(resolvedKey)!;
      const first = group[0] === raw;
      const hasShares = group.some((r) => String(r.ownership_share_percent ?? '').trim());
      const sum = group.reduce(
        (acc, r) => acc + (parseImportDecimal(r.ownership_share_percent) ?? 0),
        0,
      );
      if (first && hasShares && Math.abs(sum - 100) > 0.01) {
        errors.push('shares_must_sum_100');
      }
      const soleOwners = group.length === 1;
      const objOp = rows.find(
        (r) => r.matchKey === resolvedKey && r.data.sheet === BOOK_OBJECTS_SHEET,
      );
      const ownershipType = String(objOp?.data.ownership_type ?? '')
        .trim()
        .toLowerCase();
      const objectIdeal = parseImportDecimal(String(objOp?.data.ideal_parts_percent ?? ''));
      const idealSum = group.reduce(
        (acc, r) => acc + (parseImportDecimal(r.ideal_parts_percent) ?? 0),
        0,
      );
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
        objectIdeal != null &&
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
        objectIdeal != null &&
        Number.isFinite(objectIdeal) &&
        group.some((r) => String(r.ideal_parts_percent ?? '').trim()) &&
        Math.abs(idealSum - objectIdeal) > 0.01
      ) {
        errors.push('sole_ideal_parts_mismatch');
      }
    }

    let operation: ImportRowOperation = 'error';
    const matchForPolicy = resolvedKey || key;
    if (errors.length === 0 && matchForPolicy) {
      const exists =
        existing.has(matchForPolicy) ||
        (!parts.sectionCode && !parts.blockCode && existing.has(apt));
      if (exists) {
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
      data: {
        sheet: BOOK_OWNERS_SHEET,
        ...raw,
        _identity_label: propertyBookIdentityLabel(parts),
      },
      errors,
      warnings,
      matchKey: matchForPolicy || undefined,
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
    uniqueObjectCount: objectKeysInFile.size,
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
    clarificationCount: local.clarificationCount,
    warningCount: local.warningCount,
    uniqueObjectCount: local.uniqueObjectCount,
  };
}

/** Localized template: Objects + Owners data sheets + one Instructions sheet. */
export function buildPropertyBookIs2TemplateBuffer(
  locale: ImportTemplateLocale | string = 'ru',
): ArrayBuffer {
  return buildPropertyBookTemplateBuffer(toImportTemplateLocale(locale));
}

export {
  buildPropertyBookObjectsTemplateBuffer,
  buildPropertyBookOwnersTemplateBuffer,
  propertyBookObjectsTemplateFileName,
  propertyBookOwnersTemplateFileName,
} from '@/lib/propertyBookAdmin';

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
