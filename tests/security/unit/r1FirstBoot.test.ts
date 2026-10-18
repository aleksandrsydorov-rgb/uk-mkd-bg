import { describe, expect, it } from 'vitest';
import {
  FIRST_ADMIN_PATH,
  INITIAL_SETUP_ADMIN_PATH,
  buildFirstAdminPath,
  isValidBootstrapToken,
} from '@/lib/firstBoot';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('R1-FIRST-BOOT helpers', () => {
  it('builds first-admin path with token', () => {
    const p = buildFirstAdminPath({ token: 'a'.repeat(32), displayName: 'Ada' });
    expect(p.startsWith(FIRST_ADMIN_PATH)).toBe(true);
    expect(p).toContain('t=');
    expect(p).toContain('name=Ada');
  });

  it('rejects short bootstrap tokens', () => {
    expect(isValidBootstrapToken('short')).toBe(false);
    expect(isValidBootstrapToken('x'.repeat(32))).toBe(true);
  });

  it('points Initial Setup at encoded admin section', () => {
    expect(INITIAL_SETUP_ADMIN_PATH.startsWith('/admin?section=')).toBe(true);
    expect(decodeURIComponent(INITIAL_SETUP_ADMIN_PATH)).toContain('начальная_настройка');
  });

  it('ships installer CLI and migration package file', () => {
    const cli = readFileSync(resolve('scripts/r1-first-boot.mjs'), 'utf8');
    expect(cli).toContain('inviteUserByEmail');
    expect(cli).toContain('install_bootstrap_set_approval');
    expect(cli).toContain('FIRST_BOOT_ALLOW_REMOTE');
    expect(cli).toContain('assertBaseUrlMatchesAuthHost');
    expect(cli).toContain('BASE_URL_PREFLIGHT');
    expect(cli).toContain('smtp-preflight');
    expect(cli).toContain('AUTH_SMTP_BLOCKER');
    expect(cli).not.toContain('generateLink');

    const mig = readFileSync(
      resolve('supabase/migrations/20261118120000_r1_first_boot_bootstrap_invite.sql'),
      'utf8',
    );
    expect(mig).toContain('install_bootstrap_acquire_provision');
    expect(mig).toContain('pending_admin_email');
    expect(mig).toContain('pg_advisory_xact_lock');

    const page = readFileSync(resolve('src/app/auth/first-admin/page.tsx'), 'utf8');
    expect(page).toContain('install_bootstrap_claim_first_admin');
    expect(page).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});
