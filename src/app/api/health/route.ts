import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Liveness/readiness for Docker HEALTHCHECK and operators.
 * Does not run migrations. Does not expose secrets.
 */
export async function GET() {
  const started = Date.now();
  const hasPublicUrl = Boolean((process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim());
  const hasAnon = Boolean((process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim());
  const emailSending =
    (process.env.EMAIL_SENDING_ENABLED ?? 'false').trim().toLowerCase() === 'true';

  if (!hasPublicUrl || !hasAnon) {
    return NextResponse.json(
      {
        ok: false,
        status: 'misconfigured',
        error: 'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY',
        email_sending_enabled: emailSending,
        checked_ms: Date.now() - started,
      },
      { status: 503 },
    );
  }

  // Optional deep check: HEAD/GET Auth health when SUPABASE_URL (or public) is reachable.
  const probeBase = (
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    ''
  ).replace(/\/$/, '');
  let supabaseReachable: boolean | null = null;
  let supabaseHost: string | null = null;
  if (probeBase) {
    try {
      supabaseHost = new URL(probeBase).host;
    } catch {
      supabaseHost = null;
    }
    try {
      const ctrl = AbortSignal.timeout(2500);
      const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
      const res = await fetch(`${probeBase}/auth/v1/health`, {
        method: 'GET',
        signal: ctrl,
        headers: {
          Accept: 'application/json',
          // Cloud Auth may require apikey; 401 without key still proves reachability.
          ...(anon ? { apikey: anon } : {}),
        },
      });
      // Any HTTP response (incl. 401) means the Auth endpoint is reachable.
      supabaseReachable = res.status > 0 && res.status < 500;
    } catch {
      supabaseReachable = false;
    }
  }

  const ok = supabaseReachable !== false;
  return NextResponse.json(
    {
      ok,
      status: ok ? 'ok' : 'degraded',
      service: 'amadeus11-app',
      release: '1.0.0-rc8',
      email_sending_enabled: emailSending,
      supabase_reachable: supabaseReachable,
      // Host only (no secrets) — First Boot installer compares this to SUPABASE_URL.
      supabase_host: supabaseHost,
      checked_ms: Date.now() - started,
    },
    { status: ok ? 200 : 503 },
  );
}
