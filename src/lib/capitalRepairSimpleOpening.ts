/**
 * Simple capital-repair opening XLSX → RPC row shape for admin_import_capital_repair_opening.
 * Sign of amount encodes kind: +debt / −overpayment / 0 zero / blank → soft defer.
 * Billing year comes from complex activation (launch) year — not from the file.
 * Blank-amount rows are sent to the RPC; SQL returns DEFER, records a pending slot
 * (needs_initial) and preserves any already-confirmed opening.
 */

import type { FirstRunErrorRow } from '@/lib/firstRun';
import { CAPITAL_REPAIR_SIMPLE_IMPORT_SPEC } from '@/lib/importTemplates/specs/capitalRepairSimple';
import { CAPITAL_REPAIR_IMPORT_SPEC } from '@/lib/importTemplates/specs/capitalRepair';
import { parseLocalizedImportBuffer } from '@/lib/importTemplates';

export type CrOpeningBalanceKind = 'debt' | 'overpayment' | 'zero';

/** Meta injected by the wizard (year from activation model; technical transition optional). */
export type CrSimpleFileMeta = {
  billingYear: string;
  /** Technical date from activation model when inventarising; may be empty for soft-defer. */
  transitionDate?: string;
  /** Optional legacy source; new simple templates omit it. */
  sourceReference?: string;
};

export type CrOpeningParseResult =
  | {
      ok: true;
      mode: 'simple' | 'detailed';
      /** Valid rows for RPC dry-run / commit (defer rows included with blank amounts). */
      rows: Record<string, string>[];
      /** All non-blank rows for the unified preview table. */
      previewRows: Record<string, string>[];
      clientErrors: FirstRunErrorRow[];
      deferredCount: number;
    }
  | { ok: false; error: string };

function trim(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

/** Raw cell text before numeric parse (keeps lone "-"). */
function rawAmountCell(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return String(raw).trim();
}

/**
 * Parse money from Excel number or text with comma/dot.
 * Returns null for blank; NaN sentinel via { ok:false } for invalid / hyphen.
 */
export function parseCrOpeningAmount(raw: unknown):
  | { ok: true; value: number | null }
  | { ok: false; reason: 'hyphen' | 'invalid' } {
  const text = rawAmountCell(raw);
  if (!text) return { ok: true, value: null };
  if (text === '-' || text === '−' || text === '–') {
    return { ok: false, reason: 'hyphen' };
  }
  const normalized = text.replace(/\s/g, '').replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return { ok: false, reason: 'invalid' };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export function crKindFromSignedAmount(amount: number): CrOpeningBalanceKind {
  if (amount < -0.0001) return 'overpayment';
  if (amount > 0.0001) return 'debt';
  return 'zero';
}

function err(
  row: number,
  apartment: string,
  field: string,
  reason: string,
  sheet = 'Начальные остатки',
): FirstRunErrorRow {
  return {
    row: String(row),
    apartment: apartment || '—',
    field,
    reason,
    sheet,
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
 * Inventarisation only: debt → assessed=remaining=|amount|, paid=0;
 * overpayment → over=|amount|; zero → all zeros. No operational charges/payments.
 * Year comes from activation meta; legacy file year column still accepted when present.
 */
export function mapSimpleCrOpeningRow(
  row: Record<string, string>,
  excelRow: number,
  meta: CrSimpleFileMeta,
): {
  previewRow: Record<string, string> | null;
  rpcRow: Record<string, string> | null;
  errors: FirstRunErrorRow[];
  deferred: boolean;
} {
  const apartment = trim(row.apartment_number);
  const section = trim(row.section_code);
  const block = trim(row.block_code);
  // Prefer file year (legacy templates); otherwise wizard activation year.
  const year = trim(row.billing_year) || trim(meta.billingYear);
  const amountRaw = rawAmountCell(row.opening_balance_eur);
  const amountParsed = parseCrOpeningAmount(row.opening_balance_eur);

  if (!apartment && !section && !block && !amountRaw && !trim(row.billing_year)) {
    return { previewRow: null, rpcRow: null, errors: [], deferred: false };
  }

  const errors: FirstRunErrorRow[] = [];
  if (!apartment) {
    errors.push(err(excelRow, '', 'apartment_number', 'required:apartment_number'));
  }
  if (!year || !/^\d{4}$/.test(year) || Number(year) < 2000 || Number(year) > 2100) {
    errors.push(err(excelRow, apartment, 'billing_year', 'invalid:billing_year'));
  }

  let kind: CrOpeningBalanceKind | '' | 'invalid' = '';
  let amountAbs = 0;
  let defer = false;

  if (!amountParsed.ok) {
    if (amountParsed.reason === 'hyphen') {
      errors.push(
        err(excelRow, apartment, 'opening_balance_eur', 'invalid:opening_balance_eur_hyphen'),
      );
    } else {
      errors.push(err(excelRow, apartment, 'opening_balance_eur', 'invalid:opening_balance_eur'));
    }
    kind = 'invalid';
  } else if (amountParsed.value == null) {
    // Apartment known, amount blank → soft defer (do not wipe / do not invent zero).
    defer = true;
    kind = '';
  } else {
    kind = crKindFromSignedAmount(amountParsed.value);
    amountAbs = Math.abs(amountParsed.value);
  }

  const transition = trim(meta.transitionDate);
  const source = trim(meta.sourceReference);
  // Transition / source optional for simple inventarisation (server fills technical date).
  if (transition && !/^\d{4}-\d{2}-\d{2}$/.test(transition)) {
    errors.push(err(excelRow, apartment, 'transition_date', 'invalid:transition_date'));
  }

  let assessed = '';
  let paid = '';
  let remaining = '';
  let over = '';
  if (kind === 'debt') {
    const a = amountAbs.toFixed(2);
    assessed = a;
    paid = '0';
    remaining = a;
    over = '0';
  } else if (kind === 'overpayment') {
    assessed = '0';
    paid = '0';
    remaining = '0';
    over = amountAbs.toFixed(2);
  } else if (kind === 'zero') {
    assessed = '0';
    paid = '0';
    remaining = '0';
    over = '0';
  }

  const basePreview: Record<string, string> = {
    apartment_number: apartment,
    section_code: section,
    block_code: block,
    obligation_type: 'capital_repair',
    billing_year: year,
    assessment_title: '',
    assessed_amount: assessed,
    historically_paid_amount: paid,
    remaining_debt: remaining,
    opening_overpayment: over,
    transition_date: defer ? '' : transition,
    source_reference: defer ? '' : source,
    notes: '',
    rowNumber: String(excelRow),
    _simple_kind: kind === 'invalid' ? 'invalid' : kind,
    _deferred: defer ? '1' : '',
  };

  if (errors.length || kind === 'invalid') {
    return {
      previewRow: { ...basePreview, _client_invalid: '1' },
      rpcRow: null,
      errors,
      deferred: false,
    };
  }

  if (defer) {
    // Send blank amounts to RPC so SQL soft-defer creates needs_initial pending
    // (does not wipe a saved opening). Preview still shows «можно внести позже».
    const deferRpc: Record<string, string> = {
      apartment_number: apartment,
      section_code: section,
      block_code: block,
      obligation_type: 'capital_repair',
      billing_year: year,
      assessment_title: '',
      assessed_amount: '',
      historically_paid_amount: '',
      remaining_debt: '',
      opening_overpayment: '',
      transition_date: '',
      source_reference: '',
      notes: '',
      rowNumber: String(excelRow),
    };
    return {
      previewRow: { ...basePreview, _simple_kind: '', _deferred: '1' },
      rpcRow: deferRpc,
      errors: [],
      deferred: true,
    };
  }

  return {
    previewRow: basePreview,
    rpcRow: stripInternalKeys(basePreview),
    errors: [],
    deferred: false,
  };
}

/**
 * Parse uploaded workbook as simple (signed amount) or detailed CR opening.
 * Prefer detailed when its required headers resolve; otherwise simple.
 * Legacy simple files with billing_year column remain parseable.
 */
export function parseCapitalRepairOpeningWorkbook(
  buf: ArrayBuffer,
  _locale: string,
  meta: CrSimpleFileMeta,
): CrOpeningParseResult {
  const simpleParsed = parseLocalizedImportBuffer(buf, CAPITAL_REPAIR_SIMPLE_IMPORT_SPEC);
  const detailedParsed = parseLocalizedImportBuffer(buf, CAPITAL_REPAIR_IMPORT_SPEC);

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
      deferredCount: 0,
    };
  }

  if (simpleParsed.ok) {
    const clientErrors: FirstRunErrorRow[] = [];
    const previewRows: Record<string, string>[] = [];
    const rpcRows: Record<string, string>[] = [];
    let deferredCount = 0;
    simpleParsed.rows.forEach((row, idx) => {
      const excelRow = 2 + idx;
      const { previewRow, rpcRow, errors, deferred } = mapSimpleCrOpeningRow(
        row as Record<string, string>,
        excelRow,
        meta,
      );
      clientErrors.push(...errors);
      if (previewRow) previewRows.push(previewRow);
      if (rpcRow) rpcRows.push(rpcRow);
      if (deferred) deferredCount += 1;
    });
    return {
      ok: true,
      mode: 'simple',
      rows: rpcRows,
      previewRows,
      clientErrors,
      deferredCount,
    };
  }

  return {
    ok: false,
    error: detailedParsed.error || simpleParsed.error || 'parse failed',
  };
}
