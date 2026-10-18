/**
 * R1 First Boot — Auth invite / SMTP helpers (pure ESM for installer + Vitest).
 * Does not send mail. Does not log secrets.
 */

export function isLocalSupabaseUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
  } catch {
    return false;
  }
}

export function extractProjectRefFromSupabaseUrl(url) {
  try {
    const host = new URL(url).hostname;
    const m = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function originFromBaseUrl(baseUrl) {
  return new URL(baseUrl).origin;
}

export function assertBaseUrlSchemeForInstall(baseUrl) {
  let u;
  try {
    u = new URL(baseUrl);
  } catch {
    return 'Invalid --base-url';
  }
  const local =
    u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
  if (local) {
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return 'Local --base-url must be http:// or https://';
    }
    return null;
  }
  if (u.protocol !== 'https:') {
    return `Non-local --base-url must use https:// (got ${u.protocol}//${u.host})`;
  }
  return null;
}

export function expectedAuthRedirectPaths(origin) {
  const o = origin.replace(/\/$/, '');
  return [`${o}/auth/callback`, `${o}/auth/first-admin`, `${o}/auth/update-password`];
}

/**
 * @param {string} supabaseUrl
 * @param {Record<string, unknown> | null} auth
 * @param {string | null} baseUrl
 */
export function assessAuthSmtpConfig(supabaseUrl, auth, baseUrl) {
  const issues = [];
  const warnings = [];
  const projectRef = extractProjectRefFromSupabaseUrl(supabaseUrl);
  const local = isLocalSupabaseUrl(supabaseUrl);

  if (local) {
    return {
      ok: true,
      mode: 'local_inbucket',
      projectRef,
      smtpConfigured: true,
      disableSignup: auth?.disable_signup ?? null,
      siteUrl: auth?.site_url ?? null,
      externalEmailEnabled: auth?.external_email_enabled ?? null,
      issues: [],
      warnings: [
        'Local Supabase Auth: invite emails go to Inbucket/Mailpit (not AMADEUS Email Core).',
      ],
    };
  }

  if (!auth) {
    return {
      ok: false,
      mode: 'blocked',
      projectRef,
      smtpConfigured: false,
      disableSignup: null,
      siteUrl: null,
      externalEmailEnabled: null,
      issues: [
        'Auth SMTP preflight unavailable: set SUPABASE_ACCESS_TOKEN (Management API, auth_config_read) so the installer can verify custom SMTP. First Boot does not fall back to printing invitation URLs.',
      ],
      warnings: [],
    };
  }

  const host = String(auth.smtp_host ?? '').trim();
  const smtpConfigured = Boolean(host);
  const disableSignup = auth.disable_signup ?? null;
  const siteUrl = auth.site_url ?? null;
  const externalEmailEnabled = auth.external_email_enabled ?? null;

  if (!smtpConfigured) {
    issues.push(
      'Auth custom SMTP is not configured (smtp_host empty). Configure Authentication → SMTP in the Supabase Dashboard before First Boot. Invitation secret URLs will not be printed.',
    );
  }
  if (externalEmailEnabled === false) {
    issues.push('external_email_enabled is false — Auth will not send email.');
  }
  if (disableSignup === false) {
    issues.push(
      'disable_signup is false — public signup must remain disabled for First Boot installs.',
    );
  } else if (disableSignup == null) {
    warnings.push('disable_signup could not be read; verify public signup is OFF in Auth settings.');
  }

  if (baseUrl) {
    const schemeIssue = assertBaseUrlSchemeForInstall(baseUrl);
    if (schemeIssue) issues.push(schemeIssue);
    try {
      const origin = originFromBaseUrl(baseUrl);
      if (siteUrl) {
        const configuredOrigin = originFromBaseUrl(String(siteUrl));
        if (configuredOrigin !== origin) {
          warnings.push(
            `Auth site_url origin (${configuredOrigin}) differs from --base-url (${origin}). Align Site URL and redirect allow list.`,
          );
        }
      } else {
        warnings.push('Auth site_url not returned; set Site URL to the app --base-url origin.');
      }
      const allow = String(auth.uri_allow_list ?? '');
      if (allow) {
        const missing = expectedAuthRedirectPaths(origin).filter(
          (p) => !allow.includes(p) && !allow.includes(origin),
        );
        if (missing.length) {
          warnings.push(
            `Redirect allow list may omit callback paths (e.g. ${missing[0]}). Add them under Auth → URL Configuration.`,
          );
        }
      }
    } catch {
      issues.push('Invalid --base-url for redirect checks');
    }
  }

  const ok = issues.length === 0 && smtpConfigured;
  return {
    ok,
    mode: ok ? 'cloud_smtp' : 'blocked',
    projectRef,
    smtpConfigured,
    disableSignup,
    siteUrl,
    externalEmailEnabled,
    issues,
    warnings,
  };
}

export function redactInviteOperatorPayload(payload) {
  const banned = new Set([
    'action_link',
    'app_callback_url',
    'hashed_token',
    'token_hash',
    'email_otp',
    'password',
    'approval_token',
  ]);
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (banned.has(k)) continue;
    if (typeof v === 'string' && /token_hash=|type=invite|type=recovery|access_token=/i.test(v)) {
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function alreadyRegisteredAuthError(message) {
  return /already been registered|already registered|user already|email_exists|User already registered/i.test(
    String(message ?? ''),
  );
}

/** Safe summary of Management auth config (never includes smtp_pass). */
export function summarizeAuthConfigForLog(auth) {
  if (!auth) return null;
  return {
    smtp_host_set: Boolean(String(auth.smtp_host ?? '').trim()),
    smtp_port: auth.smtp_port ?? null,
    smtp_admin_email_set: Boolean(String(auth.smtp_admin_email ?? '').trim()),
    smtp_sender_name_set: Boolean(String(auth.smtp_sender_name ?? '').trim()),
    smtp_user_set: Boolean(String(auth.smtp_user ?? '').trim()),
    disable_signup: auth.disable_signup ?? null,
    site_url: auth.site_url ?? null,
    external_email_enabled: auth.external_email_enabled ?? null,
  };
}
