import { NextResponse } from 'next/server';

/**
 * INV-7A.1 isolation probe — enabled only when INV7A1_ISOLATION_PROBE=1.
 * Returns hosts only (no secrets). Used to prove process-env override of .env.local.
 */
export async function GET() {
  if (process.env.INV7A1_ISOLATION_PROBE !== '1') {
    return NextResponse.json({ error: 'probe disabled' }, { status: 404 });
  }

  const publicUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const servicePresent = Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim());
  let host = '';
  try {
    host = new URL(publicUrl).host;
  } catch {
    host = '';
  }

  const isLocal =
    host === '127.0.0.1:54321' ||
    host === 'localhost:54321' ||
    host.startsWith('127.0.0.1:') ||
    host.startsWith('localhost:');
  const isCloud = /klowacuvufknbrkayjhz/i.test(publicUrl);

  return NextResponse.json({
    ok: isLocal && !isCloud,
    publicSupabaseHost: host,
    publicSupabaseUrl: publicUrl,
    isLocal,
    isCloud,
    serviceRoleConfigured: servicePresent,
    inv7a1Local: process.env.INV7A1_LOCAL === '1',
  });
}
