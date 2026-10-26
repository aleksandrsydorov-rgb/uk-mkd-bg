import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EMAIL_EVENT_CATALOG,
  getEmailEvent,
  isSecurityMandatory,
} from '@/lib/email/eventCatalog';
import {
  EMAIL_MODULE_INTEGRATIONS,
  emailIntegrationsNeedingDecision,
  emailIntegrationsReady,
} from '@/lib/email/moduleIntegrations';
import { evaluateNotificationPolicy } from '@/lib/email/notificationPolicy';
import { previewTransactionalEmail } from '@/lib/email/templates';
import {
  FRESH_INSTALL_ORDERED_FILES,
  FRESH_INSTALL_PACKAGE_DIR,
} from '@/lib/moduleCore/freshInstallMeterSchema';
import { isEmailSendingEnvEnabled } from '@/lib/emailCore';

const BUSINESS_MODULES = [
  'property_book',
  'meetings',
  'meters',
  'uk_budget_expenses',
  'internet',
  'tickets_chat',
  'ownership_transfer',
  'residence_status',
  'cleaning',
  'support_fee',
  'capital_repair',
  'inventory',
] as const;

describe('EML-4 · event integration matrix', () => {
  it('covers all 12 Release 1.0 modules; rental excluded', () => {
    const keys = new Set(EMAIL_MODULE_INTEGRATIONS.map((m) => m.moduleKey));
    for (const k of BUSINESS_MODULES) expect(keys.has(k)).toBe(true);
    expect(EMAIL_MODULE_INTEGRATIONS.find((m) => m.moduleKey === 'rental_management')?.status).toBe(
      'EXCLUDED'
    );
  });

  it('wires approved producers for Release 1.0 modules (EML-5 completes cleaning + chat)', () => {
    expect(emailIntegrationsNeedingDecision()).toEqual([]);
    expect(getEmailEvent('ticket_new_message')?.producerStatus).toBe('wired');
    expect(getEmailEvent('cleaning_schedule_updated')?.producerStatus).toBe('wired');

    for (const key of [
      'meters_reading_accepted',
      'meters_payment_recorded',
      'uk_expense_approved',
      'internet_subscription_changed',
      'ticket_status_decided',
      'ticket_new_message',
      'residence_status_changed',
      'cleaning_schedule_updated',
      'support_fee_assessment_posted',
      'support_fee_payment_recorded',
      'capital_repair_assessment_posted',
      'capital_repair_payment_recorded',
      'inventory_assignment_changed',
      'meeting_published',
      'meeting_registration_open',
    ]) {
      expect(getEmailEvent(key)?.producerStatus).toBe('wired');
    }

    const ready = emailIntegrationsReady().map((m) => m.moduleKey);
    expect(ready).toContain('meters');
    expect(ready).toContain('meetings'); // RC8+ informational
    expect(ready).toContain('cleaning');
    expect(ready).not.toContain('rental_management');
    expect(
      EMAIL_MODULE_INTEGRATIONS.find((m) => m.moduleKey === 'meetings')?.status,
    ).toBe('INFORMATIONAL');
  });

  it('keeps financial events owner-scoped / informational (not security or debt)', () => {
    for (const key of [
      'meters_payment_recorded',
      'support_fee_payment_recorded',
      'capital_repair_payment_recorded',
      'support_fee_assessment_posted',
      'capital_repair_assessment_posted',
    ]) {
      const ev = getEmailEvent(key)!;
      expect(ev.recipientKind).toBe('owner_email');
      expect(ev.importance).toBe('informational');
      expect(isSecurityMandatory(key)).toBe(false);
    }
  });

  it('admin noise: IMPORTANT_ONLY + DAILY_DIGEST suppress informational finance flood', () => {
    const finance = 'meters_payment_recorded';
    expect(
      evaluateNotificationPolicy({
        eventKey: finance,
        complex: { modules: {}, events: {} },
        personal: { mode: 'IMPORTANT_ONLY', eventOverrides: {} },
      }).allow
    ).toBe(false);

    const digest = evaluateNotificationPolicy({
      eventKey: finance,
      complex: { modules: {}, events: {} },
      personal: { mode: 'DAILY_DIGEST', eventOverrides: {} },
    });
    expect(digest.allow).toBe(true);
    expect(digest.channel).toBe('digest');

    const optedOut = evaluateNotificationPolicy({
      eventKey: finance,
      complex: { modules: {}, events: {} },
      personal: { mode: 'CUSTOM', eventOverrides: { meters_payment_recorded: false } },
    });
    expect(optedOut.allow).toBe(false);
  });

  it('renders EML-4 templates BG/RU/EN without debt language as collection', () => {
    for (const locale of ['bg', 'ru', 'en'] as const) {
      for (const templateKey of [
        'meters_payment_recorded',
        'internet_subscription_changed',
        'inventory_assignment_changed',
        'residence_status_changed',
        'uk_expense_approved',
        'ticket_status_decided',
      ]) {
        const preview = previewTransactionalEmail({
          templateKey,
          locale,
          complexName: 'Test',
          payload: { event_kind: templateKey },
        });
        expect(preview.subject.length).toBeGreaterThan(0);
        expect(preview.text.length).toBeGreaterThan(0);
        expect(preview.html.length).toBeGreaterThan(0);
      }
    }
  });

  it('sending stays OFF by default; catalog has no rental events', () => {
    expect(isEmailSendingEnvEnabled({})).toBe(false);
    expect(EMAIL_EVENT_CATALOG.some((e) => e.moduleKey === 'rental_management')).toBe(false);
  });
});

describe('EML-4 · fresh-install packaging', () => {
  it('packages EML-4 system enqueue allowlist; sending remains false', () => {
    expect(FRESH_INSTALL_ORDERED_FILES).toContain('88_email_core_baseline.sql');
    expect(FRESH_INSTALL_ORDERED_FILES).toContain('89_email_notification_policy.sql');
    const manifest = JSON.parse(
      readFileSync(path.join(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, 'MANIFEST.json'), 'utf8')
    );
    expect(['EML-4', 'EML-5']).toContain(manifest.emailCorePhase);
    expect(manifest.chronologicalMigrationsPackaged).toContain(
      'supabase/migrations/20261116130000_eml4_system_enqueue_authz.sql'
    );
    const sql88 = readFileSync(
      path.join(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, '88_email_core_baseline.sql'),
      'utf8'
    );
    expect(sql88).toMatch(/meters_%/);
    expect(sql88).toMatch(/property_book_active_owner_by_email/);
    expect(sql88).toMatch(/email_enabled boolean not null default false/);
    expect(sql88).toMatch(/email_enabled must default false/);
    const sql89 = readFileSync(
      path.join(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, '89_email_notification_policy.sql'),
      'utf8'
    );
    expect(sql89).toMatch(/email_user_notification_prefs/);
    expect(sql89).not.toMatch(/resend_api_key|RESEND_API_KEY/i);
  });
});
