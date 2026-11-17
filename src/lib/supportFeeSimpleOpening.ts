/**
 * Simple support-fee opening XLSX → RPC row shape for admin_import_support_fee_opening.
 * Sign of amount encodes kind: +debt / −overpayment / 0 zero / blank → soft defer.
 * Billing year comes from complex activation (launch) year — not from the file.
 */

import type { FirstRunErrorRow } from '@/lib/firstRun';
import { SUPPORT_FEE_SIMPLE_IMPORT_SPEC } from '@/lib/importTemplates/specs/supportFeeSimple';
import { SUPPORT_FEE_IMPORT_SPEC } from '@/lib/importTemplates/specs/supportFee';
import { parseLocalizedImportBuffer } from '@/lib/importTemplates';
import {
  parseMeterOpeningAmount,
  meterKindFromSignedAmount,
  type OpeningBalanceKind,
} from '@/lib/moduleCore/adapters/metersOpening';

export type SfOpeningBalanceKind = OpeningBalanceKind;

/** Meta injected by the wizard (year from activation model; technical transition optional). */
export type SfSimpleFileMeta = {
  billingYear: string;
  /** Technical date from activation model when inventarising; may be empty for soft-defer. */
  transitionDate?: string;
  /** Optional legacy source; new simple templates omit it. */
  sourceReference?: string;
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

/** Normalize localized / canonical balance-kind labels (legacy kind column). */
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

function moneyOrNullLegacy(raw: unknown): number | null {
  const s = trim(raw).replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * Map one simple row to RPC payload keys.
 * Signed amount (preferred) or legacy kind+amount columns.
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

  if (!apartment && !section && !block && !kindRaw && !amountRaw) {
    return { previewRow: null, rpcRow: null, errors: [] };
  }

  const errors: FirstRunErrorRow[] = [];
  if (!apartment) {
    errors.push(err(excelRow, '', 'apartment_number', 'required:apartment_number'));
  }

  let kind: SfOpeningBalanceKind | null | 'invalid' = null;
  let amountAbs = 0;
  let defer = false;

  if (kindRaw) {
    // Legacy kind column still accepted.
    kind = normalizeSfOpeningBalanceKind(kindRaw);
    if (kind === 'invalid') {
      errors.push(err(excelRow, apartment, 'opening_balance_kind', 'invalid:opening_balance_kind'));
    }
    const amount = moneyOrNullLegacy(amountRaw);
    if (kind === 'debt' || kind === 'overpayment') {
      if (amount == null || amount <= 0) {
        errors.push(err(excelRow, apartment, 'opening_balance_eur', 'required:opening_balance_eur'));
      } else {
        amountAbs = amount;
      }
    } else if (kind === 'zero') {
      if (amount != null && Math.abs(amount) > 0.0001) {
        errors.push(
          err(excelRow, apartment, 'opening_balance_eur', 'invalid:opening_balance_eur_nonzero_for_zero'),
        );
      }
      amountAbs = 0;
    } else if (kind == null && amount == null) {
      defer = true;
    } else if (kind == null && amount != null) {
      errors.push(err(excelRow, apartment, 'opening_balance_kind', 'required:opening_balance_kind'));
    }
  } else {
    // Signed-amount mode (new 4-column template).
    const parsed = parseMeterOpeningAmount(row.opening_balance_eur);
    if (!parsed.ok) {
      errors.push(
        err(
          excelRow,
          apartment,
          'opening_balance_eur',
          parsed.reason === 'hyphen'
            ? 'invalid:opening_balance_eur_hyphen'
            : 'invalid:opening_balance_eur',
        ),
      );
      kind = 'invalid';
    } else if (parsed.value == null) {
      defer = true;
      kind = null;
    } else {
      kind = meterKindFromSignedAmount(parsed.value);
      amountAbs = Math.abs(parsed.value);
    }
  }

  const year = trim(meta.billingYear);
  const transition = trim(meta.transitionDate);
  const source = trim(meta.sourceReference);

  if (!year || !/^\d{4}$/.test(year) || Number(year) < 2000 || Number(year) > 2100) {
    errors.push(err(excelRow, apartment, 'billing_year', 'invalid:billing_year'));
  }

  // Transition / source are optional for simple inventarisation (server fills technical values).
  // If provided (legacy meta / detailed), validate transition date format lightly.
  if (transition) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transition)) {
      errors.push(err(excelRow, apartment, 'transition_date', 'invalid:transition_date'));
    }
  }

  const basePreview: Record<string, string> = {
    apartment_number: apartment,
    section_code: section,
    block_code: block,
    obligation_type: 'support_fee',
    billing_year: year,
    assessed_amount: '',
    historically_paid_amount: '',
    remaining_debt: '',
    opening_overpayment: '',
    transition_date: transition,
    source_reference: source,
    notes: '',
    rowNumber: String(excelRow),
    _simple_kind: kind && kind !== 'invalid' ? kind : kindRaw ? 'invalid' : '',
  };

  if (defer) {
    if (errors.length) {
      return { previewRow: { ...basePreview, _client_invalid: '1' }, rpcRow: null, errors };
    }
    return {
      previewRow: { ...basePreview, _simple_kind: '' },
      rpcRow: stripInternalKeys(basePreview),
      errors: [],
    };
  }

  let assessed = '0';
  let paid = '0';
  let remaining = '0';
  let over = '';
  if (kind === 'debt' && amountAbs > 0) {
    const a = amountAbs.toFixed(2);
    assessed = a;
    remaining = a;
  } else if (kind === 'overpayment' && amountAbs > 0) {
    over = amountAbs.toFixed(2);
  }

  const mapped: Record<string, string> = {
    ...basePreview,
    assessed_amount: assessed,
    historically_paid_amount: paid,
    remaining_debt: remaining,
    opening_overpayment: over,
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
 * New simple files have no kind column — detection via simple spec still works.
 */
export function parseSupportFeeOpeningWorkbook(
  buf: ArrayBuffer,
  _locale: string,
  meta: SfSimpleFileMeta,
): SfOpeningParseResult {
  const simpleParsed = parseLocalizedImportBuffer(buf, SUPPORT_FEE_SIMPLE_IMPORT_SPEC);
  const detailedParsed = parseLocalizedImportBuffer(buf, SUPPORT_FEE_IMPORT_SPEC);

  // Prefer detailed when its required headers resolve (legacy full inventarisation file).
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
