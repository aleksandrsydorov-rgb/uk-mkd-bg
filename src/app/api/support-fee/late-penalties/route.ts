import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Cron / ops endpoint: apply Support Fee late penalties after early-payment deadlines.
 * Auth: Authorization Bearer = SUPPORT_FEE_CRON_SECRET or EMAIL_CRON_SECRET.
 * Deploy: schedule daily shortly after midnight Europe/Sofia (e.g. 00:15).
 */
export async function POST(request: Request) {
  const secret =
    process.env.SUPPORT_FEE_CRON_SECRET?.trim() ||
    process.env.EMAIL_CRON_SECRET?.trim() ||
    '';
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!secret || token !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: 'misconfigured' }, { status: 500 });
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const body = (await request.json().catch(() => ({}))) as { asOf?: string };
  const asOf = body.asOf ? new Date(body.asOf).toISOString() : new Date().toISOString();

  const { data, error } = await supabase.rpc('process_support_fee_late_penalties', {
    p_as_of: asOf,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, result: data });
}

export async function GET(request: Request) {
  return POST(request);
}
