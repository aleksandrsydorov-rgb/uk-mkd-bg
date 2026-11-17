/**
 * Simple support-fee opening XLSX → RPC row shape for admin_import_support_fee_opening.
 * Soft-defer (empty kind+amount) keeps amounts blank so SQL returns DEFER.
 */

import type { FirstRunErrorRow } from '@/lib/firstRun';
import { SUPPORT_FEE_SIMPLE_IMPORT_SPEC } from '@/lib/importTemplates/specs/supportFeeSimple';
import { SUPPORT_FEE_IMPORT_SPEC } from '@/lib/importTemplates/specs/supportFee';
import { parseLocalizedImportBuffer } from '@/lib/importTemplates';

export type SfOpeningBalanceKind = 'debt' | 'overpayment' | 'zero';

export type SfSimpleFileMeta = {
  billingYear: string;
  transitionDate: string;
  sourceReference: string;
};

export type SfOpeningParseResult =
  | {
      ok: true;
      mode: 'simple' | 'detailed';
      /** Valid rows for RPC dry-run / commit. */
      rows: Record<string, string>[];
      /** All non-blank rows for the unified preview table. */
      previewRows: Record<string, string>[];
      clientErrors: FirstRunErrorRow[];
    }
  | { ok: false; error: string };

function trim(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function moneyOrNull(raw: unknown): number | null {
  const s = trim(raw).replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Normalize localized / canonical balance-kind labels. */
export function normalizeSfOpeningBalanceKind(
  raw: string | undefined | null,
): SfOpeningBalanceKind | null | 'invalid' {
  const v = trim(raw)
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (!v) return null;
  if (v === 'debt' || v === 'долг' || v === 'дълг' || v === 'remaining_debt' || v === 'остаток долга') {
    return 'debt';
  }
  if (
    v === 'overpayment' ||
    v === 'credit' ||
    v === 'переплата' ||
    v === 'преплата' ||
    v === 'opening_overpayment'
  ) {
    return 'overpayment';
  }
  if (v === 'zero' || v === '0' || v === 'ноль' || v === 'нула' || v === 'нуль' || v === 'none') {
    return 'zero';
  }
  return 'invalid';
}

function err(row: number, apartment: string, field: string, reason: string): FirstRunErrorRow {
  return {
    row: String(row),
    apartment: apartment || '—',
    field,
    reason,
    sheet: 'opening_balances',
    severity: 'error',
  };
}

function stripInternalKeys(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith('_')) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Map one simple row to RPC payload keys.
 * Always returns a previewRow for non-blank Excel lines; rpcRow only when valid.
 */
export function mapSimpleSfOpeningRow(
  row: Record<string, string>,
  excelRow: number,
  meta: SfSimpleFileMeta,
): {
  previewRow: Record<string, string> | null;
  rpcRow: Record<string, string> | null;
  errors: FirstRunErrorRow[];
} {
  const apartment = trim(row.apartment_number);
  const section = trim(row.section_code);
  const block = trim(row.block_code);
  const kindRaw = trim(row.opening_balance_kind);
  const amountRaw = trim(row.opening_balance_eur);
  const kind = normalizeSfOpeningBalanceKind(kindRaw);
  const amount = moneyOrNull(amountRaw);

  if (!apartment && !section && !block && !kindRaw && !amountRaw) {
    return { previewRow: null, rpcRow: null, errors: [] };
  }

  const errors: FirstRunErrorRow[] = [];
  if (!apartment) {
    errors.push(err(excelRow, '', 'apartment_number', 'required:apartment_number'));
  }
  if (kind === 'invalid') {
    errors.push(err(excelRow, apartment, 'opening_balance_kind', 'invalid:opening_balance_kind'));
  }

  const basePreview: Record<string, string> = {
    apartment_number: apartment,
    section_code: section,
    block_code: block,
    obligation_type: 'support_fee',
    billing_year: '',
    assessed_amount: '',
    historically_paid_amount: '',
    remaining_debt: '',
    opening_overpayment: '',
    transition_date: '',
    source_reference: '',
    notes: '',
    rowNumber: String(excelRow),
    _simple_kind: kind && kind !== 'invalid' ? kind : kindRaw ? 'invalid' : '',
  };

  // Empty kind + empty amount → soft defer (apartment may still be missing → error).
  if (kind == null && amount == null) {
    if (errors.length) {
      return { previewRow: { ...basePreview, _client_invalid: '1' }, rpcRow: null, errors };
    }
    return {
      previewRow: { ...basePreview, _simple_kind: '' },
      rpcRow: stripInternalKeys(basePreview),
      errors: [],
    };
  }

  if (kind == null && amount != null) {
    errors.push(err(excelRow, apartment, 'opening_balance_kind', 'required:opening_balance_kind'));
  }
  if (kind === 'debt' || kind === 'overpayment') {
    if (amount == null || amount <= 0) {
      errors.push(err(excelRow, apartment, 'opening_balance_eur', 'required:opening_balance_eur'));
    }
  }
  if (kind === 'zero' && amount != null && Math.abs(amount) > 0.0001) {
    errors.push(
      err(excelRow, apartment, 'opening_balance_eur', 'invalid:opening_balance_eur_nonzero_for_zero'),
    );
  }

  const year = trim(meta.billingYear);
  const transition = trim(meta.transitionDate);
  const source = trim(meta.sourceReference);
  if (!year || !/^\d{4}$/.test(year) || Number(year) < 2000 || Number(year) > 2100) {
    errors.push(err(excelRow, apartment, 'billing_year', 'invalid:billing_year'));
  }
  if (!transition) {
    errors.push(err(excelRow, apartment, 'transition_date', 'required:transition_date'));
  }
  if (!source) {
    errors.push(err(excelRow, apartment, 'source_reference', 'required:source_reference'));
  }

  let assessed = '0';
  let paid = '0';
  let remaining = '0';
  let over = '';
  if (kind === 'debt' && amount != null && amount > 0) {
    const a = amount.toFixed(2);
    assessed = a;
    remaining = a;
  } else if (kind === 'overpayment' && amount != null && amount > 0) {
    over = amount.toFixed(2);
  }

  const mapped: Record<string, string> = {
    ...basePreview,
    billing_year: year,
    assessed_amount: assessed,
    historically_paid_amount: paid,
    remaining_debt: remaining,
    opening_overpayment: over,
    transition_date: transition,
    source_reference: source,
    _simple_kind: kind && kind !== 'invalid' ? kind : basePreview._simple_kind,
  };

  if (errors.length || kind == null || kind === 'invalid') {
    return { previewRow: { ...mapped, _client_invalid: '1' }, rpcRow: null, errors };
  }

  return {
    previewRow: mapped,
    rpcRow: stripInternalKeys(mapped),
    errors: [],
  };
}

/**
 * Parse uploaded workbook as simple or detailed SF opening.
 * Prefer detailed when its required headers resolve; otherwise simple.
 */
export function parseSupportFeeOpeningWorkbook(
  buf: ArrayBuffer,
  _locale: string,
  meta: SfSimpleFileMeta,
): SfOpeningParseResult {
  const simpleParsed = parseLocalizedImportBuffer(buf, SUPPORT_FEE_SIMPLE_IMPORT_SPEC);
  const detailedParsed = parseLocalizedImportBuffer(buf, SUPPORT_FEE_IMPORT_SPEC);

  if (detailedParsed.ok) {
    const previewRows = detailedParsed.rows.map((row, idx) => ({
      ...(row as Record<string, string>),
      rowNumber: String(2 + idx),
    }));
    return {
      ok: true,
      mode: 'detailed',
      rows: previewRows.map((r) => stripInternalKeys(r)),
      previewRows,
      clientErrors: [],
    };
  }

  if (simpleParsed.ok) {
    const clientErrors: FirstRunErrorRow[] = [];
    const previewRows: Record<string, string>[] = [];
    const rpcRows: Record<string, string>[] = [];
    simpleParsed.rows.forEach((row, idx) => {
      const excelRow = 2 + idx;
      const { previewRow, rpcRow, errors } = mapSimpleSfOpeningRow(
        row as Record<string, string>,
        excelRow,
        meta,
      );
      clientErrors.push(...errors);
      if (previewRow) previewRows.push(previewRow);
      if (rpcRow) rpcRows.push(rpcRow);
    });
    return { ok: true, mode: 'simple', rows: rpcRows, previewRows, clientErrors };
  }

  return {
    ok: false,
    error: detailedParsed.error || simpleParsed.error || 'parse failed',
  };
}
