/**
 * Internet opening — payment coverage status (Europe/Sofia calendar dates).
 * Paid periods are factual coverage; gaps are not treated as continuously paid.
 */

export type InternetPaymentStatusCode =
  | 'unknown'
  | 'active_paid'
  | 'expired'
  | 'future';

export type InternetPaidPeriod = {
  start: string | null;
  end: string;
};

function isoOk(raw: string | null | undefined): string | null {
  const t = String(raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

/** Inclusive coverage: today in [start, end] when start known; else today <= end (paid-through-only). */
export function periodCoversDay(period: InternetPaidPeriod, dayIso: string): boolean {
  const end = isoOk(period.end);
  if (!end) return false;
  if (dayIso > end) return false;
  const start = isoOk(period.start);
  if (start && dayIso < start) return false;
  return true;
}

/**
 * Status from factual periods / paid-through.
 * - unknown: no payment data
 * - active_paid: today covered by at least one period (or paid-through-only)
 * - future: no coverage today, but a later period starts after today
 * - expired: all known coverage ended before today (including gap-before-future → expired with gap note left to caller)
 */
export function internetPaymentStatus(
  periods: InternetPaidPeriod[],
  sofiaTodayIso: string,
): {
  code: InternetPaymentStatusCode;
  paidThrough: string | null;
  futureStart: string | null;
  gapToday: boolean;
} {
  const cleaned = periods
    .map((p) => ({ start: isoOk(p.start), end: isoOk(p.end) }))
    .filter((p): p is { start: string | null; end: string } => Boolean(p.end));

  if (cleaned.length === 0) {
    return { code: 'unknown', paidThrough: null, futureStart: null, gapToday: false };
  }

  const covering = cleaned.filter((p) => periodCoversDay(p, sofiaTodayIso));
  if (covering.length > 0) {
    const paidThrough = covering.reduce((max, p) => (p.end > max ? p.end : max), covering[0].end);
    return { code: 'active_paid', paidThrough, futureStart: null, gapToday: false };
  }

  const future = cleaned
    .filter((p) => p.start && p.start > sofiaTodayIso)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const pastEnds = cleaned.map((p) => p.end).sort();
  const maxEnd = pastEnds[pastEnds.length - 1] ?? null;

  if (future.length > 0) {
    // Today in a gap before a future period → not "paid"; surface as expired/gap for honesty.
    const hasPast = cleaned.some((p) => p.end < sofiaTodayIso || (p.start && p.start < sofiaTodayIso));
    if (hasPast) {
      return {
        code: 'expired',
        paidThrough: maxEnd,
        futureStart: future[0].start,
        gapToday: true,
      };
    }
    return {
      code: 'future',
      paidThrough: maxEnd,
      futureStart: future[0].start,
      gapToday: false,
    };
  }

  return { code: 'expired', paidThrough: maxEnd, futureStart: null, gapToday: false };
}

export function formatInternetPaymentStatusLabel(
  status: ReturnType<typeof internetPaymentStatus>,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  if (status.code === 'unknown') return t('admin.internetPaymentStatusUnknown');
  if (status.code === 'active_paid' && status.paidThrough) {
    return t('admin.internetPaymentStatusPaidThrough', { date: status.paidThrough });
  }
  if (status.code === 'future' && status.futureStart) {
    return t('admin.internetPaymentStatusFuture', { date: status.futureStart });
  }
  if (status.code === 'expired' && status.paidThrough) {
    return t('admin.internetPaymentStatusExpired', { date: status.paidThrough });
  }
  return t('admin.internetPaymentStatusUnknown');
}
