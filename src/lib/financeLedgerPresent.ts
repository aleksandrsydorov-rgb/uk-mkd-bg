/**
 * User-facing presentation for finance ledger rows.
 * Normalizes system notes/kinds for display only — never mutates stored values.
 */

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export type LedgerPresentInput = {
  kind: string | null | undefined;
  note?: string | null;
  /** Absolute amount when available; not used to guess debt vs overpayment. */
  amountEur?: number | null;
};

const OPENING_NOTE_RE = /^opening_balance(?::([a-z0-9_]+))?$/i;
const CODE_LIKE_RE = /^[a-z][a-z0-9_]*(?::[a-z0-9_]+)?$/i;

export type OpeningBalanceService =
  | 'water'
  | 'electricity'
  | 'internet'
  | 'support_fee'
  | 'capital_repair'
  | 'unknown';

export function parseOpeningBalanceNote(note: string | null | undefined): {
  isOpening: boolean;
  service: OpeningBalanceService;
} {
  const raw = note?.trim() ?? '';
  const m = OPENING_NOTE_RE.exec(raw);
  if (!m) return { isOpening: false, service: 'unknown' };
  const svc = (m[1] ?? 'unknown').toLowerCase();
  if (
    svc === 'water' ||
    svc === 'electricity' ||
    svc === 'internet' ||
    svc === 'support_fee' ||
    svc === 'capital_repair'
  ) {
    return { isOpening: true, service: svc };
  }
  return { isOpening: true, service: 'unknown' };
}

function isOpeningLedgerKind(kind: string | null | undefined): boolean {
  const k = (kind ?? '').trim().toLowerCase();
  return (
    k === 'opening_debit' ||
    k === 'opening_credit' ||
    k === 'opening_obligation' ||
    k === 'opening_historical_settlement'
  );
}

/** Debt vs overpayment from structured ledger kind — not from amount sign. */
export function openingBalanceSense(
  kind: string | null | undefined,
): 'debt' | 'overpayment' | 'neutral' {
  const k = (kind ?? '').trim().toLowerCase();
  if (k === 'adjustment_debit' || k === 'opening_debit' || k === 'opening_obligation') {
    return 'debt';
  }
  if (k === 'adjustment_credit' || k === 'opening_credit') {
    return 'overpayment';
  }
  return 'neutral';
}

function openingNoteKey(
  sense: 'debt' | 'overpayment' | 'neutral',
  service: OpeningBalanceService,
): string {
  const sensePart =
    sense === 'debt' ? 'Debt' : sense === 'overpayment' ? 'Overpayment' : 'Neutral';
  const svcPart =
    service === 'water'
      ? 'Water'
      : service === 'electricity'
        ? 'Electricity'
        : service === 'internet'
          ? 'Internet'
          : service === 'support_fee'
            ? 'SupportFee'
            : service === 'capital_repair'
              ? 'Capital'
              : 'Generic';
  return `admin.financeOpNoteOpening${sensePart}${svcPart}`;
}

/**
 * Type column: opening-balance rows show «Начальный остаток», not «Корректировка (+)».
 * Real adjustments keep their usual labels.
 */
export function presentLedgerOperationKind(input: LedgerPresentInput, t: TranslateFn): string {
  const kind = (input.kind ?? '').trim();
  const opening = parseOpeningBalanceNote(input.note);
  if (opening.isOpening || isOpeningLedgerKind(kind)) {
    return t('admin.financeOpKindOpeningBalance');
  }
  if (kind === 'charge') return t('admin.kindCharge');
  if (kind === 'payment') return t('admin.kindPayment');
  if (kind === 'payment_reversal') return t('admin.kindPaymentReversal');
  if (kind === 'adjustment_debit') return t('admin.kindAdjDebit');
  if (kind === 'adjustment_credit') return t('admin.kindAdjCredit');
  if (!kind) return '—';
  // Unknown kind codes — never echo raw technical tokens
  if (CODE_LIKE_RE.test(kind) && kind.includes('_')) {
    return t('admin.financeOpKindOther');
  }
  return kind;
}

/**
 * Note / description column. System codes → human copy; free-text staff notes pass through.
 */
export function presentLedgerOperationNote(input: LedgerPresentInput, t: TranslateFn): string {
  const raw = input.note?.trim() ?? '';
  if (!raw) {
    // Internet/capital opening rows may carry sense only in kind
    if (isOpeningLedgerKind(input.kind)) {
      const sense = openingBalanceSense(input.kind);
      return t(openingNoteKey(sense, 'unknown'));
    }
    return '—';
  }

  const opening = parseOpeningBalanceNote(raw);
  if (opening.isOpening) {
    return t(openingNoteKey(openingBalanceSense(input.kind), opening.service));
  }

  // Other system tokens (snake_case / code:service) — do not show raw
  if (CODE_LIKE_RE.test(raw) && (raw.includes('_') || raw.includes(':'))) {
    return t('admin.financeOpNoteSystem');
  }

  return raw;
}

/**
 * Financial operation status — independent of receipt PDF readiness.
 * Registered payment → «Получено»; reversal → cancelled; others → clear or «—».
 */
export function presentLedgerOperationStatus(input: LedgerPresentInput, t: TranslateFn): string {
  const kind = (input.kind ?? '').trim().toLowerCase();
  if (kind === 'payment') return t('admin.financeOpStatusReceived');
  if (kind === 'payment_reversal') return t('admin.financeOpStatusCancelled');
  if (kind === 'charge') return t('admin.financeOpStatusCharged');
  // Opening balance / adjustments: no payment-style status
  return '—';
}

/** True when the note looks like a system token that should never be shown raw. */
export function isSystemLedgerNote(note: string | null | undefined): boolean {
  const raw = note?.trim() ?? '';
  if (!raw) return false;
  if (parseOpeningBalanceNote(raw).isOpening) return true;
  return CODE_LIKE_RE.test(raw) && (raw.includes('_') || raw.includes(':'));
}
