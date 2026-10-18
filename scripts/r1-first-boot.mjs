#!/usr/bin/env node
/**
 * R1-FIRST-BOOT — installer-only first administrator provisioning.
 *
 * Requires server-side env (never expose to browser / Docker image layers):
 *   SUPABASE_URL              Target API (e.g. http://127.0.0.1:55021)
 *   SUPABASE_SERVICE_ROLE_KEY Service role JWT for that project only
 *   FIRST_BOOT_CONFIRM_PROJECT Optional but recommended: must match --confirm-project
 *   SUPABASE_ACCESS_TOKEN     Required for cloud SMTP preflight (Management API auth_config_read)
 *
 * Invitation delivery uses Supabase Auth SMTP (inviteUserByEmail), NOT AMADEUS Email Core.
 * Invitation URLs / token_hash are never printed or written to disk.
 *
 * Usage:
 *   node scripts/r1-first-boot.mjs status
 *   node scripts/r1-first-boot.mjs smtp-preflight [--base-url <url>] [--confirm-project <id>]
 *   node scripts/r1-first-boot.mjs provision --email a@b.c --base-url http://127.0.0.1:3085 --confirm-project <id> [--display-name "Admin"]
 *   node scripts/r1-first-boot.mjs resend --base-url http://127.0.0.1:3085
 */

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const inviteHelpers = await import(
  pathToFileURL(resolve(__dirname, 'lib/firstBootInvite.mjs')).href
);

function usage(exitCode = 1) {
  console.error(`Usage:
  node scripts/r1-first-boot.mjs status
  node scripts/r1-first-boot.mjs smtp-preflight [--base-url <url>] [--confirm-project <id>]
  node scripts/r1-first-boot.mjs provision --email <email> --base-url <url> --confirm-project <id> [--display-name <name>] [--token-file <path>]
  node scripts/r1-first-boot.mjs resend --base-url <url> [--token-file <path>]
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[key] = val;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function fail(code, message) {
  const err = new Error(message);
  err.exitCode = code;
  throw err;
}

function requireEnv() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    fail(2, 'Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.');
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(url) && process.env.FIRST_BOOT_ALLOW_REMOTE !== '1') {
    fail(
      2,
      'Refusing non-localhost SUPABASE_URL. Set FIRST_BOOT_ALLOW_REMOTE=1 only for intentional staging/VPS provision.',
    );
  }
  return { url, key };
}

function assertProjectConfirm(confirmProject) {
  const expected = (process.env.FIRST_BOOT_CONFIRM_PROJECT || '').trim();
  if (expected) {
    if (!confirmProject || confirmProject !== expected) {
      fail(
        3,
        `Project confirmation mismatch. Expected FIRST_BOOT_CONFIRM_PROJECT=${expected}, got --confirm-project=${confirmProject || '(missing)'}`,
      );
    }
  } else if (!confirmProject) {
    fail(3, 'Provide --confirm-project <supabase-project-id> (and prefer FIRST_BOOT_CONFIRM_PROJECT env).');
  }
  console.log(`TARGET_CONFIRMED project=${confirmProject}`);
  console.log(`TARGET_URL=${(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()}`);
}

function adminClient() {
  const { url, key } = requireEnv();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function rpcStatus(supabase) {
  const { data, error } = await supabase.rpc('install_bootstrap_status');
  if (error) throw error;
  return data;
}

function makeToken() {
  return randomBytes(32).toString('base64url');
}

function buildFirstAdminNext(token, displayName) {
  const next = new URL('/auth/first-admin', 'http://local.invalid');
  next.searchParams.set('t', token);
  if (displayName) next.searchParams.set('name', displayName);
  return `${next.pathname}${next.search}`;
}

function buildRedirectTo(baseUrl, token, displayName) {
  const origin = baseUrl.replace(/\/$/, '');
  const callback = new URL('/auth/callback', origin);
  callback.searchParams.set('next', buildFirstAdminNext(token, displayName));
  return callback.toString();
}

/**
 * Guard: the app at --base-url must be the installation whose client bundle
 * targets the same Auth host as SUPABASE_URL. Prevents minting cloud OTPs while
 * localhost:3080 is bound by a different local Docker app (otp_expired in browser).
 *
 * Also checks /api/health supabase_host when available (RC7+).
 * Never kills unrelated processes — fails closed with an actionable message.
 */
async function assertBaseUrlMatchesAuthHost(baseUrl) {
  const expectedHost = new URL(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim(),
  ).host;
  if (!expectedHost) {
    fail(2, 'SUPABASE_URL required for base-url Auth host preflight.');
  }
  const origin = baseUrl.replace(/\/$/, '');

  // Health probe first — cheap, explicit mismatch when RC7+ image is running.
  try {
    const healthRes = await fetch(`${origin}/api/health`, {
      signal: AbortSignal.timeout(10000),
    });
    if (healthRes.ok) {
      const health = await healthRes.json();
      const reported = String(health.supabase_host || '').trim();
      if (reported && reported !== expectedHost) {
        fail(
          9,
          `base-url preflight FAIL: /api/health reports supabase_host=${reported} but installer SUPABASE_URL host is ${expectedHost}. Port ${origin} is likely serving a different installation (e.g. obsolete local Docker). Free the port or fix the SSH tunnel; do not open the invite yet.`,
        );
      }
      if (health.email_sending_enabled === true) {
        console.log('BASE_URL_PREFLIGHT warn: email_sending_enabled=true on app health (unexpected for First Boot)');
      }
      console.log(
        `BASE_URL_HEALTH ok=true release=${health.release || '?'} supabase_host=${reported || '(n/a)'}`,
      );
    } else {
      console.log(`BASE_URL_HEALTH warn: GET /api/health → HTTP ${healthRes.status}`);
    }
  } catch (err) {
    console.log(`BASE_URL_HEALTH warn: ${err?.message || err}`);
  }

  let html;
  try {
    const res = await fetch(`${origin}/auth/callback`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      fail(9, `base-url preflight: GET ${origin}/auth/callback → HTTP ${res.status}`);
    }
    html = await res.text();
  } catch (err) {
    fail(9, `base-url preflight: cannot reach ${origin} (${err?.message || err})`);
  }
  const chunkPaths = [
    ...html.matchAll(/\/_next\/static(?:\/immutable)?\/chunks\/[^"'\s>]+\.js/g),
  ].map((m) => m[0]);
  if (chunkPaths.length === 0) {
    fail(9, 'base-url preflight: no /_next/static/chunks in callback HTML');
  }
  let sawExpected = false;
  const foreign = new Set();
  for (const path of chunkPaths.slice(0, 12)) {
    try {
      const jsRes = await fetch(`${origin}${path}`, {
        signal: AbortSignal.timeout(20000),
      });
      if (!jsRes.ok) continue;
      const js = await jsRes.text();
      if (js.includes(expectedHost)) sawExpected = true;
      for (const m of js.matchAll(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/g)) {
        foreign.add(m[0]);
      }
    } catch {
      /* try next chunk */
    }
  }
  if (!sawExpected) {
    fail(
      9,
      `base-url preflight FAIL: app at ${origin} client bundle does not reference Auth host ${expectedHost}. Another process may be bound to this port (e.g. local Docker RC). Fix the SSH tunnel / free the port before generating an invite.`,
    );
  }
  const badLocal = [...foreign].filter((h) => !h.includes(expectedHost));
  if (badLocal.length) {
    console.log(
      `BASE_URL_PREFLIGHT warn: bundle also mentions ${badLocal.join(', ')} (expected ${expectedHost})`,
    );
  }
  console.log(`BASE_URL_PREFLIGHT ok=true origin=${origin} auth_host=${expectedHost}`);
}

/**
 * Management API auth config (cloud only). Never logs smtp_pass.
 * Requires SUPABASE_ACCESS_TOKEN with auth_config_read.
 */
async function fetchCloudAuthConfig(supabaseUrl) {
  const ref = inviteHelpers.extractProjectRefFromSupabaseUrl(supabaseUrl);
  if (!ref) {
    fail(
      10,
      'AUTH_SMTP_BLOCKER: cannot derive project ref from SUPABASE_URL (expected https://<ref>.supabase.co).',
    );
  }
  const token = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
  if (!token) {
    return null;
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    fail(
      10,
      `AUTH_SMTP_BLOCKER: Management API GET /v1/projects/${ref}/config/auth → HTTP ${res.status}${body ? ` (${body.slice(0, 180)})` : ''}`,
    );
  }
  return res.json();
}

async function runSmtpPreflight(baseUrl) {
  const { url } = requireEnv();
  let auth = null;
  if (!inviteHelpers.isLocalSupabaseUrl(url)) {
    auth = await fetchCloudAuthConfig(url);
  }
  const assessment = inviteHelpers.assessAuthSmtpConfig(url, auth, baseUrl || null);
  console.log(
    JSON.stringify(
      {
        smtp_preflight: assessment.mode,
        ok: assessment.ok,
        project_ref: assessment.projectRef,
        smtp_configured: assessment.smtpConfigured,
        disable_signup: assessment.disableSignup,
        site_url: assessment.siteUrl,
        auth_config: inviteHelpers.summarizeAuthConfigForLog(auth),
        issues: assessment.issues,
        warnings: assessment.warnings,
        note: 'Auth SMTP only — AMADEUS Email Core / Debt Gate remain OFF. Invitation URLs are never printed.',
      },
      null,
      2,
    ),
  );
  for (const w of assessment.warnings) {
    console.log(`SMTP_PREFLIGHT_WARN ${w}`);
  }
  if (!assessment.ok) {
    fail(10, `AUTH_SMTP_BLOCKER: ${assessment.issues.join(' | ')}`);
  }
  console.log(`SMTP_PREFLIGHT ok=true mode=${assessment.mode}`);
  return assessment;
}

async function findAuthUserByEmail(supabase, email) {
  const needle = String(email || '')
    .trim()
    .toLowerCase();
  if (!needle) return null;
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users || [];
    const hit = users.find((u) => String(u.email || '').toLowerCase() === needle);
    if (hit) return hit;
    if (users.length < 200) break;
  }
  return null;
}

/**
 * Send first-admin invite via Auth SMTP (inviteUserByEmail).
 * Never returns or logs action_link / token_hash.
 * Expired / already-invited recovery: delete unconfirmed Auth user, then re-invite.
 */
async function sendInviteEmail(supabase, email, redirectTo) {
  let { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { amadeus_first_boot: true },
  });

  if (error && inviteHelpers.alreadyRegisteredAuthError(error.message)) {
    const existing = await findAuthUserByEmail(supabase, email);
    if (!existing?.id) {
      fail(
        5,
        `Auth reports user already registered for ${email}, but no Auth user was found. Check Auth admin API access.`,
      );
    }
    if (existing.email_confirmed_at) {
      fail(
        5,
        `Auth user ${email} is already confirmed. First Boot cannot re-invite a confirmed account; use status / login recovery.`,
      );
    }
    console.log(
      'INVITE_RECOVERY deleting_unconfirmed_auth_user=true (expired or prior invite; no secrets logged)',
    );
    const { error: delErr } = await supabase.auth.admin.deleteUser(existing.id);
    if (delErr) throw delErr;
    ({ data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { amadeus_first_boot: true },
    }));
  }

  if (error) throw error;
  const userId = data?.user?.id ?? null;
  if (!userId) {
    fail(5, 'inviteUserByEmail returned no user id — Auth SMTP delivery may have failed.');
  }
  console.log(`INVITE_EMAIL_SENT ok=true email=${email} auth_user_id=${userId}`);
  return { userId, delivery: 'auth_smtp_invite' };
}

async function cmdStatus() {
  const supabase = adminClient();
  const status = await rpcStatus(supabase);
  console.log(JSON.stringify(status, null, 2));
  if (status?.closed) {
    console.log('BOOTSTRAP_CLOSED=true');
  } else {
    console.log('BOOTSTRAP_CLOSED=false');
  }
}

async function cmdSmtpPreflight(args) {
  const baseUrl = String(args['base-url'] || '').trim();
  const confirmProject = String(args['confirm-project'] || '').trim();
  if (confirmProject) assertProjectConfirm(confirmProject);
  if (baseUrl) {
    const schemeIssue = inviteHelpers.assertBaseUrlSchemeForInstall(baseUrl);
    if (schemeIssue) fail(10, `AUTH_SMTP_BLOCKER: ${schemeIssue}`);
  }
  await runSmtpPreflight(baseUrl || null);
}

async function cmdProvision(args) {
  const email = String(args.email || '')
    .trim()
    .toLowerCase();
  const baseUrl = String(args['base-url'] || '').trim();
  const confirmProject = String(args['confirm-project'] || '').trim();
  const displayName = String(args['display-name'] || 'Administrator').trim();
  const tokenFile = args['token-file']
    ? resolve(String(args['token-file']))
    : resolve('tmp', 'r1_first_boot_token.txt');

  if (!email || !email.includes('@')) {
    console.error('--email required');
    usage();
  }
  if (!baseUrl.startsWith('http')) {
    console.error('--base-url required (http:// or https://)');
    usage();
  }
  const schemeIssue = inviteHelpers.assertBaseUrlSchemeForInstall(baseUrl);
  if (schemeIssue) fail(10, `AUTH_SMTP_BLOCKER: ${schemeIssue}`);
  assertProjectConfirm(confirmProject);

  await runSmtpPreflight(baseUrl);

  const supabase = adminClient();
  const before = await rpcStatus(supabase);
  if (before?.closed) {
    console.error(JSON.stringify(before, null, 2));
    fail(4, 'Bootstrap already closed for this installation.');
  }

  const { data: acquired, error: acqErr } = await supabase.rpc(
    'install_bootstrap_acquire_provision',
    { p_email: email },
  );
  if (acqErr) throw acqErr;
  console.log('ACQUIRE', JSON.stringify(acquired));

  let token = makeToken();
  let reusedToken = false;
  if (acquired?.approval_ready && acquired?.idempotent) {
    try {
      const { readFileSync } = await import('node:fs');
      const prev = readFileSync(tokenFile, 'utf8').trim();
      if (prev.length >= 32) {
        token = prev;
        reusedToken = true;
      }
    } catch {
      /* mint new and rotate approval */
    }
  }

  if (!reusedToken || !acquired?.approval_ready) {
    const { error: apprErr } = await supabase.rpc('install_bootstrap_set_approval', {
      p_approval_token: token,
      p_note: `r1-first-boot:${confirmProject}`,
    });
    if (apprErr) throw apprErr;
    mkdirSync(resolve('tmp'), { recursive: true });
    writeFileSync(tokenFile, token, { encoding: 'utf8', mode: 0o600 });
    console.log(`TOKEN_FILE=${tokenFile} (approval token only; keep offline; not for git)`);
  } else {
    console.log(`TOKEN_REUSED_FROM=${tokenFile}`);
  }

  await assertBaseUrlMatchesAuthHost(baseUrl);

  const redirectTo = buildRedirectTo(baseUrl, token, displayName);
  const { userId, delivery } = await sendInviteEmail(supabase, email, redirectTo);

  const { error: recErr } = await supabase.rpc('install_bootstrap_record_invite', {
    p_email: email,
    p_auth_user_id: userId,
  });
  if (recErr) throw recErr;

  try {
    await supabase.rpc('install_bootstrap_audit', {
      p_event_type: 'invite_email_sent',
      p_detail: {
        email,
        confirm_project: confirmProject,
        base_url: baseUrl,
        delivery,
        redirect_origin: inviteHelpers.originFromBaseUrl(baseUrl),
        has_secret_url_in_output: false,
      },
    });
  } catch {
    /* audit is best-effort */
  }

  const after = await rpcStatus(supabase);
  const out = inviteHelpers.redactInviteOperatorPayload({
    ok: true,
    email,
    confirm_project: confirmProject,
    delivery,
    invite_delivery: 'auth_smtp_email',
    redirect_origin: inviteHelpers.originFromBaseUrl(baseUrl),
    callback_path: '/auth/callback',
    first_admin_path: '/auth/first-admin',
    auth_user_id: userId,
    status: after,
    note:
      'Invitation sent to the administrator Email via Supabase Auth SMTP. Open the link in the Email, set password on /auth/first-admin, then claim. AMADEUS Email Core remains OFF. Invitation URLs are never written to disk.',
  });
  console.log(JSON.stringify(out, null, 2));
}

async function cmdResend(args) {
  const baseUrl = String(args['base-url'] || '').trim();
  const tokenFile = args['token-file']
    ? resolve(String(args['token-file']))
    : resolve('tmp', 'r1_first_boot_token.txt');
  if (!baseUrl.startsWith('http')) {
    console.error('--base-url required');
    usage();
  }
  const schemeIssue = inviteHelpers.assertBaseUrlSchemeForInstall(baseUrl);
  if (schemeIssue) fail(10, `AUTH_SMTP_BLOCKER: ${schemeIssue}`);

  await runSmtpPreflight(baseUrl);

  const supabase = adminClient();
  const status = await rpcStatus(supabase);
  if (status?.closed) {
    fail(4, 'Bootstrap closed — cannot resend.');
  }
  const email = (status?.pending_admin_email || '').trim();
  if (!email) {
    fail(6, 'No pending_admin_email — run provision first.');
  }

  const { readFileSync } = await import('node:fs');
  let token;
  try {
    token = readFileSync(tokenFile, 'utf8').trim();
  } catch {
    fail(7, `Missing token file ${tokenFile}. Re-run provision (same email) to rotate.`);
  }
  if (token.length < 32) {
    fail(7, 'Token file too short.');
  }

  if (!status.approval_ready) {
    const { error } = await supabase.rpc('install_bootstrap_set_approval', {
      p_approval_token: token,
      p_note: 'r1-first-boot:resend',
    });
    if (error) throw error;
  }

  await assertBaseUrlMatchesAuthHost(baseUrl);

  const redirectTo = buildRedirectTo(baseUrl, token, 'Administrator');
  const { userId, delivery } = await sendInviteEmail(supabase, email, redirectTo);

  const { error: recErr } = await supabase.rpc('install_bootstrap_record_invite', {
    p_email: email,
    p_auth_user_id: userId,
  });
  if (recErr) throw recErr;

  try {
    await supabase.rpc('install_bootstrap_audit', {
      p_event_type: 'invite_email_resent',
      p_detail: {
        email,
        base_url: baseUrl,
        delivery,
        has_secret_url_in_output: false,
      },
    });
  } catch {
    /* best-effort */
  }

  console.log(
    JSON.stringify(
      inviteHelpers.redactInviteOperatorPayload({
        ok: true,
        mode: 'resend',
        email,
        delivery,
        invite_delivery: 'auth_smtp_email',
        redirect_origin: inviteHelpers.originFromBaseUrl(baseUrl),
        auth_user_id: userId,
        status: await rpcStatus(supabase),
        note: 'Fresh invitation Email sent via Auth SMTP. Prior invite links are invalid after recovery delete+reinvite.',
      }),
      null,
      2,
    ),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === 'help' || args.help) usage(cmd === 'help' ? 0 : 1);
  try {
    if (cmd === 'status') await cmdStatus();
    else if (cmd === 'smtp-preflight') await cmdSmtpPreflight(args);
    else if (cmd === 'provision') await cmdProvision(args);
    else if (cmd === 'resend') await cmdResend(args);
    else usage();
  } catch (err) {
    console.error('FIRST_BOOT_ERROR', err?.message || err);
    if (err?.details) console.error(err.details);
    process.exitCode = Number(err?.exitCode) || 1;
  }
}

await main();
