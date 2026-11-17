/**
 * Support-fee opening billing year = complex activation (launch) year.
 * Single source for preview, inventarisation rows, and later launch stamp.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

/** Europe/Sofia calendar year for a Date (or "now" if omitted). */
export function sofiaCalendarYear(at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
  }).formatToParts(at);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  return Number.isFinite(y) ? y : at.getUTCFullYear();
}

/**
 * Resolve opening billing year from the server (stamps launch year once if missing).
 * Falls back to Sofia calendar year only when the RPC is unavailable.
 */
export async function resolveSupportFeeOpeningBillingYear(
  supabase: SupabaseClient<Database>,
): Promise<number> {
  const { data, error } = await supabase.rpc('ensure_complex_launch_year' as never, {} as never);
  if (!error && data != null) {
    const n = Number(data);
    if (Number.isFinite(n) && n >= 2000 && n <= 2100) return n;
  }
  // Fallback: try read-only launch year
  const { data: launch } = await supabase.rpc('complex_launch_year' as never, {} as never);
  const fromLaunch = Number(launch);
  if (Number.isFinite(fromLaunch) && fromLaunch >= 2000 && fromLaunch <= 2100) {
    return fromLaunch;
  }
  return sofiaCalendarYear();
}

/** Technical transition date for inventarisation (Sofia calendar date of resolve time). */
export function supportFeeOpeningTransitionDate(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}
