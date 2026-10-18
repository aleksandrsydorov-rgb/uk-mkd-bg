/**
 * Browser E2E: first-admin style token_hash callback against a live app.
 *
 * Requires:
 *   R1_E2E_BASE_URL          e.g. http://localhost:3080 (must be VPS tunnel)
 *   SUPABASE_URL             TEST cloud API (zcecvbjjmbhwfjtlyjkt)
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Skips (exit 0) when env is missing. Fails if verify hits the wrong Auth host
 * or returns otp_expired for a freshly minted magiclink token.
 *
 * Usage:
 *   node tests/e2e/firstAdminCallback.browser.e2e.mjs
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';

const baseUrl = (process.env.R1_E2E_BASE_URL || '').replace(/\/$/, '');
const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!baseUrl || !supabaseUrl || !serviceKey) {
  console.log(
    JSON.stringify({
      skipped: true,
      reason: 'missing R1_E2E_BASE_URL / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY',
    }),
  );
  process.exit(0);
}

if (/klowacuvufknbrkayjhz/i.test(supabaseUrl)) {
  console.error('REFUSING production Supabase URL');
  process.exit(3);
}

const expectedHost = new URL(supabaseUrl).host;

function fp16(s) {
  return createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 16);
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const email = `r1-e2e-${randomBytes(4).toString('hex')}@example.invalid`;
const { data: inv, error: iErr } = await admin.auth.admin.generateLink({
  type: 'invite',
  email,
  options: { redirectTo: `${baseUrl}/auth/callback?next=%2Faccount` },
});
if (iErr) throw iErr;
const uid = inv.user.id;

const { data: ml, error: mErr } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email,
  options: { redirectTo: `${baseUrl}/auth/callback?next=%2Faccount` },
});
if (mErr) {
  await admin.auth.admin.deleteUser(uid).catch(() => {});
  throw mErr;
}

const hashed = ml.properties.hashed_token;
const thFp = fp16(hashed);
const callback = new URL(`${baseUrl}/auth/callback`);
callback.searchParams.set('token_hash', hashed);
callback.searchParams.set('type', 'recovery');
callback.searchParams.set('next', '/account');

const verifyPosts = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('request', (req) => {
  if (req.method() === 'POST' && req.url().includes('/auth/v1/verify')) {
    const json = JSON.parse(req.postData() || '{}');
    verifyPosts.push({
      phase: 'request',
      url_host: new URL(req.url()).host,
      body_type: json.type ?? null,
      body_th_fp16: json.token_hash ? fp16(json.token_hash) : null,
    });
  }
});
page.on('response', async (res) => {
  if (res.request().method() === 'POST' && res.url().includes('/auth/v1/verify')) {
    let error_code = null;
    try {
      const j = await res.json();
      error_code = j?.error_code || j?.code || null;
    } catch {
      /* ignore */
    }
    verifyPosts.push({ phase: 'response', status: res.status(), error_code });
  }
});

try {
  await page.goto(callback.toString(), { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
} finally {
  await admin.auth.admin.deleteUser(uid).catch(() => {});
  await browser.close();
}

const reqs = verifyPosts.filter((p) => p.phase === 'request');
const resps = verifyPosts.filter((p) => p.phase === 'response');
const hostOk = reqs.length > 0 && reqs.every((p) => p.url_host === expectedHost);
const fpOk =
  reqs.length > 0 &&
  reqs.every((p) => p.body_type === 'recovery' && p.body_th_fp16 === thFp);
const statusOk = resps.some((p) => p.status === 200);

const report = {
  ok: hostOk && fpOk && statusOk,
  expected_verify_host: expectedHost,
  th_fp16: thFp,
  verify_posts: verifyPosts,
  final_path: null,
};

if (!report.ok) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(2);
}

console.log(
  JSON.stringify({
    ok: true,
    expected_verify_host: expectedHost,
    th_fp16: thFp,
    verify_status: 200,
    host_match: true,
    type: 'recovery',
  }),
);
