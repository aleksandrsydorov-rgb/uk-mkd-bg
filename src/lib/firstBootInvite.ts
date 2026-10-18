/**
 * First Boot invite / SMTP types + re-exports for Vitest.
 * Runtime helpers: scripts/lib/firstBootInvite.mjs
 */

export type AuthSmtpPreflightResult = {
  ok: boolean;
  mode: 'local_inbucket' | 'cloud_smtp' | 'blocked';
  projectRef: string | null;
  smtpConfigured: boolean;
  disableSignup: boolean | null;
  siteUrl: string | null;
  externalEmailEnabled: boolean | null;
  issues: string[];
  warnings: string[];
};

export type AuthConfigProbe = {
  smtp_host?: string | null;
  smtp_port?: string | number | null;
  smtp_admin_email?: string | null;
  smtp_sender_name?: string | null;
  smtp_user?: string | null;
  smtp_pass_set?: boolean;
  disable_signup?: boolean | null;
  site_url?: string | null;
  external_email_enabled?: boolean | null;
  uri_allow_list?: string | null;
};

export {
  alreadyRegisteredAuthError,
  assertBaseUrlSchemeForInstall,
  assessAuthSmtpConfig,
  expectedAuthRedirectPaths,
  extractProjectRefFromSupabaseUrl,
  isLocalSupabaseUrl,
  originFromBaseUrl,
  redactInviteOperatorPayload,
  summarizeAuthConfigForLog,
} from '../../scripts/lib/firstBootInvite.mjs';
