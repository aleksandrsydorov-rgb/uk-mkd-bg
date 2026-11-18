/**
 * Simple internet opening XLSX → RPC row shape for admin_import_internet_opening.
 * Sign of amount encodes money: +debt / −overpayment / 0 zero / blank → unknown.
 * Connection state is never invented from the amount — left empty for card confirm.
 * Legacy detailed files still parse via INTERNET_IMPORT_SPEC.
 */

import type { FirstRunErrorRow } from '@/lib/firstRun';
import { INTERNET_SIMPLE_IMPORT_SPEC } from '@/lib/importTemplates/specs/internetSimple';
import { INTERNET_IMPORT_SPEC } from '@/lib/importTemplates/specs/internet';
import { parseLocalizedImportBuffer } from '@/lib/importTemplates';
import { normalizeInternetOpeningRow } from '@/lib/moduleCore/adapters/internetOpening';

export type InetOpeningBalanceKind = 'debt' | 'overpayment' | 'zero';

export type InetOpeningParseResult =
  | {
      ok: true;
      mode: 'simple' | 'detailed';
      rows: Record<string, string>[];
      previewRows: Record<string, string>[];
      clientErrors: FirstRunErrorRow[];
      deferredCount: number;
    }
  | { ok: false; error: string };

function trim(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function rawAmountCell(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  // Excel may keep a leading apostrophe from text-forced cells ("'-").
  return String(raw)
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/^'+/, '');
}

export function parseInetOpeningAmount(raw: unknown):
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

export function inetKindFromSignedAmount(amount: number): InetOpeningBalanceKind {
  if (amount < -0.0001) return 'overpayment';
  if (amount > 0.0001) return 'debt';
  return 'zero';
}

function err(
  row: number,
  apartment: string,
  field: string,
  reason: string,
): FirstRunErrorRow {
  return {
    row: String(row),
    apartment: apartment || '—',
    field,
    reason,
    sheet: 'Начальные остатки',
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
 * Map one simple row. Connection fields stay empty — money only.
 */
export function mapSimpleInetOpeningRow(
  row: Record<string, string>,
  excelRow: number,
): {
  previewRow: Record<string, string> | null;
  rpcRow: Record<string, string> | null;
  errors: FirstRunErrorRow[];
  deferred: boolean;
} {
  const apartment = trim(row.apartment_number);
  const section = trim(row.section_code);
  const block = trim(row.block_code);
  const amountRaw = rawAmountCell(row.opening_balance_eur);
  const amountParsed = parseInetOpeningAmount(row.opening_balance_eur);

  if (!apartment && !section && !block && !amountRaw) {
    return { previewRow: null, rpcRow: null, errors: [], deferred: false };
  }

  const errors: FirstRunErrorRow[] = [];
  if (!apartment) {
    errors.push(err(excelRow, '', 'apartment_number', 'required:apartment_number'));
  }

  let kind: InetOpeningBalanceKind | '' | 'invalid' = '';
  let debt = '';
  let credit = '';
  let amountUnknown = false;

  if (!amountParsed.ok) {
    if (amountParsed.reason === 'hyphen') {
      errors.push(err(excelRow, apartment, 'opening_balance_eur', 'invalid:opening_balance_eur_hyphen'));
    } else {
      errors.push(err(excelRow, apartment, 'opening_balance_eur', 'invalid:opening_balance_eur'));
    }
    kind = 'invalid';
  } else if (amountParsed.value == null) {
    amountUnknown = true;
    kind = '';
  } else {
    kind = inetKindFromSignedAmount(amountParsed.value);
    const abs = Math.abs(amountParsed.value).toFixed(2);
    if (kind === 'debt') {
      debt = abs;
      credit = '0';
    } else if (kind === 'overpayment') {
      debt = '0';
      credit = abs;
    } else {
      debt = '0';
      credit = '0';
    }
  }

  const base: Record<string, string> = {
    apartment_number: apartment,
    section_code: section,
    block_code: block,
    // Never invent connection from money.
    connection_state: '',
    status: '',
    connection_date: '',
    paid_period_start: '',
    paid_period_end: '',
    paid_through: '',
    opening_debt: amountUnknown ? '' : debt,
    opening_credit: amountUnknown ? '' : credit,
    comment: '',
    notes: '',
    tariff_code: 'internet',
    rowNumber: String(excelRow),
    _simple_kind: kind === 'invalid' ? 'invalid' : kind,
    _deferred: '1', // connection always needs card confirm on simple template
    _amount_unknown: amountUnknown ? '1' : '',
  };

  if (errors.length || kind === 'invalid') {
    return {
      previewRow: { ...base, _client_invalid: '1' },
      rpcRow: null,
      errors,
      deferred: false,
    };
  }

  return {
    previewRow: base,
    rpcRow: stripInternalKeys(base),
    errors: [],
    deferred: true,
  };
}

/**
 * Prefer detailed legacy when its required connection/money headers resolve;
 * otherwise simple 4-column signed-amount file.
 */
export function parseInternetOpeningWorkbook(
  buf: ArrayBuffer,
  _locale: string,
): InetOpeningParseResult {
  const simpleParsed = parseLocalizedImportBuffer(buf, INTERNET_SIMPLE_IMPORT_SPEC);
  const detailedParsed = parseLocalizedImportBuffer(buf, INTERNET_IMPORT_SPEC);

  // Prefer detailed when connection_state or dual money columns are present.
  const looksDetailed =
    detailedParsed.ok &&
    detailedParsed.rows.some((r) => {
      const row = r as Record<string, string>;
      return Boolean(
        trim(row.connection_state) ||
          trim(row.connection_date) ||
          trim(row.paid_period_start) ||
          trim(row.paid_period_end) ||
          (trim(row.opening_debt) && trim(row.opening_credit)),
      );
    });

  if (detailedParsed.ok && (looksDetailed || !simpleParsed.ok)) {
    const previewRows: Record<string, string>[] = detailedParsed.rows.map((row, idx) => {
      const n = normalizeInternetOpeningRow(row as Record<string, string>);
      return { ...n, rowNumber: String(2 + idx) };
    });
    return {
      ok: true,
      mode: 'detailed',
      rows: previewRows.map((r) => stripInternalKeys(r)),
      previewRows,
      clientErrors: [],
      deferredCount: previewRows.filter((r) => !trim(r.connection_state)).length,
    };
  }

  if (simpleParsed.ok) {
    const clientErrors: FirstRunErrorRow[] = [];
    const previewRows: Record<string, string>[] = [];
    const rpcRows: Record<string, string>[] = [];
    let deferredCount = 0;
    simpleParsed.rows.forEach((row, idx) => {
      const excelRow = 2 + idx;
      const { previewRow, rpcRow, errors, deferred } = mapSimpleInetOpeningRow(
        row as Record<string, string>,
        excelRow,
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
    error:
      (!detailedParsed.ok ? detailedParsed.error : undefined) ||
      (!simpleParsed.ok ? simpleParsed.error : undefined) ||
      'parse failed',
  };
}
