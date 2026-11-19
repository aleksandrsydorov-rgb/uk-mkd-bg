import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'supabase');
const templatesDir = join(root, 'templates');
const configPath = join(root, 'config.toml');

const AUTH_HTML = [
  'invite.html',
  'confirmation.html',
  'recovery.html',
  'magic_link.html',
  'email_change.html',
  'reauthentication.html',
] as const;

const NOTIFY_HTML = [
  'password_changed_notification.html',
  'email_changed_notification.html',
  'phone_changed_notification.html',
  'mfa_factor_enrolled_notification.html',
  'mfa_factor_unenrolled_notification.html',
  'identity_linked_notification.html',
  'identity_unlinked_notification.html',
] as const;

describe('Supabase Auth · Bulgarian email templates', () => {
  it('ships all Auth HTML templates under supabase/templates', () => {
    expect(existsSync(templatesDir)).toBe(true);
    const names = readdirSync(templatesDir);
    for (const f of [...AUTH_HTML, ...NOTIFY_HTML]) {
      expect(names).toContain(f);
    }
  });

  it('wires Bulgarian subjects and content_path in config.toml', () => {
    const cfg = readFileSync(configPath, 'utf8');
    for (const key of [
      'invite',
      'confirmation',
      'recovery',
      'magic_link',
      'email_change',
      'reauthentication',
    ]) {
      expect(cfg).toMatch(new RegExp(`\\[auth\\.email\\.template\\.${key}\\]`));
    }
    expect(cfg).toMatch(/AMADEUS 11: покана за профил/);
    expect(cfg).toMatch(/AMADEUS 11: възстановяване на парола/);
    expect(cfg).toMatch(/AMADEUS 11: връзка за вход/);
    expect(cfg).toMatch(/content_path = "\.\/supabase\/templates\/invite\.html"/);
    expect(cfg).toMatch(/\[auth\.email\.notification\.password_changed\]/);
    expect(cfg).toMatch(/enabled = true/);
  });

  it('Auth HTML is Bulgarian and keeps required GoTrue variables', () => {
    for (const file of AUTH_HTML) {
      const html = readFileSync(join(templatesDir, file), 'utf8');
      expect(html).toMatch(/lang="bg"/);
      expect(html).toMatch(/Здравейте/);
      expect(html).toMatch(/AMADEUS 11/);
      expect(html).not.toMatch(/You have been invited|Confirm your signup|Reset Your Password|Magic Link/i);
      if (file === 'reauthentication.html') {
        expect(html).toContain('{{ .Token }}');
      } else {
        expect(html).toContain('{{ .ConfirmationURL }}');
        expect(html).toContain('{{ .Token }}');
      }
      if (file === 'email_change.html') {
        expect(html).toContain('{{ .NewEmail }}');
      }
    }
  });

  it('security notification HTML is Bulgarian with required vars', () => {
    const emailChanged = readFileSync(
      join(templatesDir, 'email_changed_notification.html'),
      'utf8'
    );
    expect(emailChanged).toContain('{{ .OldEmail }}');
    expect(emailChanged).toContain('{{ .Email }}');
    expect(emailChanged).toMatch(/променен/);

    const phone = readFileSync(join(templatesDir, 'phone_changed_notification.html'), 'utf8');
    expect(phone).toContain('{{ .OldPhone }}');
    expect(phone).toContain('{{ .Phone }}');

    const mfa = readFileSync(join(templatesDir, 'mfa_factor_enrolled_notification.html'), 'utf8');
    expect(mfa).toContain('{{ .FactorType }}');

    const linked = readFileSync(join(templatesDir, 'identity_linked_notification.html'), 'utf8');
    expect(linked).toContain('{{ .Provider }}');
  });
});
