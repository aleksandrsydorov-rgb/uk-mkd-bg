import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  alreadyRegisteredAuthError,
  assertBaseUrlSchemeForInstall,
  assessAuthSmtpConfig,
  expectedAuthRedirectPaths,
  extractProjectRefFromSupabaseUrl,
  isLocalSupabaseUrl,
  originFromBaseUrl,
  redactInviteOperatorPayload,
  summarizeAuthConfigForLog,
} from '@/lib/firstBootInvite';
import {
  otpTypeFromGenerateLinkVerification,
  otpTypeFromStoredTokenKind,
} from '@/lib/auth/otpTokenTypes';

describe('First Boot Auth SMTP helpers', () => {
  it('detects local Supabase URLs', () => {
    expect(isLocalSupabaseUrl('http://127.0.0.1:54321')).toBe(true);
    expect(isLocalSupabaseUrl('http://localhost:54321')).toBe(true);
    expect(isLocalSupabaseUrl('https://abcd.supabase.co')).toBe(false);
  });

  it('extracts cloud project ref', () => {
    expect(extractProjectRefFromSupabaseUrl('https://abc123.supabase.co')).toBe('abc123');
    expect(extractProjectRefFromSupabaseUrl('http://127.0.0.1:54321')).toBeNull();
  });

  it('allows http localhost and requires https for production origins', () => {
    expect(assertBaseUrlSchemeForInstall('http://127.0.0.1:3080')).toBeNull();
    expect(assertBaseUrlSchemeForInstall('https://app.example.com')).toBeNull();
    expect(assertBaseUrlSchemeForInstall('http://app.example.com')).toMatch(/https/);
  });

  it('lists expected Auth redirect paths', () => {
    const paths = expectedAuthRedirectPaths('https://app.example.com');
    expect(paths).toContain('https://app.example.com/auth/callback');
    expect(paths).toContain('https://app.example.com/auth/first-admin');
    expect(paths).toContain('https://app.example.com/auth/update-password');
  });

  it('passes local Inbucket mode without Management API config', () => {
    const r = assessAuthSmtpConfig('http://127.0.0.1:54321', null, 'http://127.0.0.1:3080');
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('local_inbucket');
  });

  it('blocks cloud when SMTP host missing', () => {
    const r = assessAuthSmtpConfig(
      'https://abc123.supabase.co',
      {
        smtp_host: '',
        disable_signup: true,
        external_email_enabled: true,
        site_url: 'https://app.example.com',
      },
      'https://app.example.com',
    );
    expect(r.ok).toBe(false);
    expect(r.mode).toBe('blocked');
    expect(r.issues.some((i) => /smtp_host/i.test(i))).toBe(true);
  });

  it('blocks cloud when Management API token/config unavailable', () => {
    const r = assessAuthSmtpConfig('https://abc123.supabase.co', null, 'https://app.example.com');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /SUPABASE_ACCESS_TOKEN/i.test(i))).toBe(true);
  });

  it('blocks public signup enabled', () => {
    const r = assessAuthSmtpConfig(
      'https://abc123.supabase.co',
      {
        smtp_host: 'smtp.example.com',
        disable_signup: false,
        external_email_enabled: true,
        site_url: 'https://app.example.com',
      },
      'https://app.example.com',
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /disable_signup/i.test(i))).toBe(true);
  });

  it('passes cloud SMTP when configured and signup disabled', () => {
    const r = assessAuthSmtpConfig(
      'https://abc123.supabase.co',
      {
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        disable_signup: true,
        external_email_enabled: true,
        site_url: 'https://app.example.com',
        uri_allow_list: 'https://app.example.com/**',
      },
      'https://app.example.com',
    );
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('cloud_smtp');
  });

  it('redacts invitation secrets from operator payloads', () => {
    const redacted = redactInviteOperatorPayload({
      ok: true,
      email: 'a@b.c',
      action_link: 'https://secret/verify?token=abc',
      app_callback_url: 'http://127.0.0.1/auth/callback?token_hash=xyz&type=invite',
      hashed_token: 'xyz',
      approval_token: 'should-not-appear',
      note: 'safe',
    });
    expect(redacted).toEqual({ ok: true, email: 'a@b.c', note: 'safe' });
    expect(JSON.stringify(redacted)).not.toMatch(/token_hash|action_link|approval_token/);
  });

  it('never summarizes smtp_pass', () => {
    const s = summarizeAuthConfigForLog({
      smtp_host: 'smtp.example.com',
      smtp_pass: 'super-secret',
      disable_signup: true,
      site_url: 'https://app.example.com',
    });
    expect(s).not.toBeNull();
    expect(JSON.stringify(s)).not.toContain('super-secret');
    expect(s?.smtp_host_set).toBe(true);
  });

  it('detects already-registered Auth errors', () => {
    expect(alreadyRegisteredAuthError('User already registered')).toBe(true);
    expect(alreadyRegisteredAuthError('network error')).toBe(false);
  });

  it('preserves magiclink → recovery OTP mapping (callback verify)', () => {
    expect(otpTypeFromGenerateLinkVerification('magiclink')).toBe('recovery');
    expect(otpTypeFromGenerateLinkVerification('invite')).toBe('invite');
    expect(otpTypeFromStoredTokenKind('recovery_token')).toBe('recovery');
  });

  it('originFromBaseUrl strips path', () => {
    expect(originFromBaseUrl('https://app.example.com/admin')).toBe('https://app.example.com');
  });
});

describe('First Boot CLI email delivery contract', () => {
  it('ships inviteUserByEmail path without secret URL files', () => {
    const cli = readFileSync(resolve('scripts/r1-first-boot.mjs'), 'utf8');
    expect(cli).toContain('inviteUserByEmail');
    expect(cli).toContain('smtp-preflight');
    expect(cli).toContain('AUTH_SMTP_BLOCKER');
    expect(cli).toContain('runSmtpPreflight');
    expect(cli).toContain('redactInviteOperatorPayload');
    expect(cli).toContain('INVITE_RECOVERY');
    expect(cli).toContain('install_bootstrap_set_approval');
    expect(cli).toContain('FIRST_BOOT_ALLOW_REMOTE');
    expect(cli).toContain('assertBaseUrlMatchesAuthHost');
    expect(cli).toContain('BASE_URL_PREFLIGHT');
    expect(cli).not.toContain('generateLink');
    expect(cli).not.toContain('r1_first_boot_app_callback.url.txt');
    expect(cli).not.toContain('action_link:');

    const helpers = readFileSync(resolve('scripts/lib/firstBootInvite.mjs'), 'utf8');
    expect(helpers).toContain('assessAuthSmtpConfig');
    expect(helpers).toContain('redactInviteOperatorPayload');

    const ps1 = readFileSync(resolve('scripts/r1-first-boot.ps1'), 'utf8');
    expect(ps1).toContain('smtp-preflight');
  });
});
