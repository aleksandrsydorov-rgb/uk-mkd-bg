import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EMAIL_EVENT_CATALOG,
  getEmailEvent,
  isSecurityMandatory,
  NOTIFICATION_MODES,
} from '@/lib/email/eventCatalog';
import {
  EMAIL_MODULE_INTEGRATIONS,
  emailIntegrationsNeedingDecision,
  emailIntegrationsReady,
} from '@/lib/email/moduleIntegrations';
import { evaluateNotificationPolicy } from '@/lib/email/notificationPolicy';
import { previewTransactionalEmail } from '@/lib/email/templates';
import { ticketChatAggregationBucket } from '@/lib/email/eventProducers';
import {
  FRESH_INSTALL_ORDERED_FILES,
  FRESH_INSTALL_PACKAGE_DIR,
} from '@/lib/moduleCore/freshInstallMeterSchema';
import { isEmailSendingEnvEnabled } from '@/lib/emailCore';
import { canEnqueueEmail } from '@/lib/securityRpcPolicy';

const BUSINESS_12 = [
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

describe('EML-5 · cleaning + ticket chat producers', () => {
  it('marks cleaning and ticket_new_message as wired', () => {
    expect(getEmailEvent('cleaning_schedule_updated')?.producerStatus).toBe('wired');
    expect(getEmailEvent('ticket_new_message')?.producerStatus).toBe('wired');
    expect(getEmailEvent('ticket_new_message')?.highFrequency).toBe(true);
    expect(emailIntegrationsNeedingDecision()).toEqual([]);
  });

  it('aggregates ticket chat into 15-minute buckets (same bucket = same idempotency window)', () => {
    const windowMs = 15 * 60 * 1000;
    const t0 = Math.floor(1_700_000_000_000 / windowMs) * windowMs + 60_000;
    const t1 = t0 + 5 * 60 * 1000;
    const t2 = t0 + 16 * 60 * 1000;
    expect(ticketChatAggregationBucket(t0)).toBe(ticketChatAggregationBucket(t1));
    expect(ticketChatAggregationBucket(t0)).not.toBe(ticketChatAggregationBucket(t2));
  });

  it('respects five modes + complex disable for new events', () => {
    for (const mode of NOTIFICATION_MODES) {
      expect(NOTIFICATION_MODES).toContain(mode);
    }
    expect(
      evaluateNotificationPolicy({
        eventKey: 'ticket_new_message',
        complex: { modules: {}, events: {} },
        personal: { mode: 'IMPORTANT_ONLY', eventOverrides: {} },
      }).allow
    ).toBe(false);
    expect(
      evaluateNotificationPolicy({
        eventKey: 'cleaning_schedule_updated',
        complex: { modules: { cleaning: false }, events: {} },
        personal: { mode: 'ALL', eventOverrides: {} },
      }).allow
    ).toBe(false);
    const digest = evaluateNotificationPolicy({
      eventKey: 'ticket_new_message',
      complex: { modules: {}, events: {} },
      personal: { mode: 'DAILY_DIGEST', eventOverrides: {} },
    });
    expect(digest.allow).toBe(true);
    expect(digest.channel).toBe('digest');
    expect(
      evaluateNotificationPolicy({
        eventKey: 'ticket_new_message',
        complex: { modules: {}, events: {} },
        personal: { mode: 'ALL', eventOverrides: {} },
        throttled: true,
      }).allow
    ).toBe(false);
  });

  it('keeps mandatory security exempt from optional suppression', () => {
    expect(isSecurityMandatory('pb1_invite_create')).toBe(true);
    const blocked = evaluateNotificationPolicy({
      eventKey: 'pb1_invite_create',
      complex: { modules: { property_book: false }, events: { pb1_invite_create: false } },
      personal: { mode: 'INFORMATIONAL_OFF', eventOverrides: { pb1_invite_create: false } },
    });
    expect(blocked.allow).toBe(true);
  });

  it('renders cleaning + ticket_new_message BG/RU/EN without chat body', () => {
    for (const locale of ['bg', 'ru', 'en'] as const) {
      const clean = previewTransactionalEmail({
        templateKey: 'cleaning_schedule_updated',
        locale,
        complexName: 'Test',
        payload: { preferred_date: '2026-10-20', time_slot: 'morning' },
      });
      expect(clean.subject.length).toBeGreaterThan(0);
      expect(clean.text).toMatch(/2026-10-20|morning|уборк|cleaning|график/i);

      const msg = previewTransactionalEmail({
        templateKey: 'ticket_new_message',
        locale,
        complexName: 'Test',
      });
      expect(msg.text.toLowerCase()).not.toMatch(/secret chat body/);
      expect(msg.html.toLowerCase()).toMatch(/кабинет|cabinet|чат|chat|message|съобщение|сообщение/);
    }
  });

  it('authz: owner may enqueue ticket_* to staff admin; unrelated denied', () => {
    expect(
      canEnqueueEmail({
        role: 'authenticated',
        isBookAdmin: false,
        ownsPayloadProperty: true,
        moduleKey: 'system',
        templateKey: 'ticket_new_message',
        recipientIsStaffAdmin: true,
      })
    ).toBe(true);
    expect(
      canEnqueueEmail({
        role: 'authenticated',
        isBookAdmin: false,
        ownsPayloadProperty: false,
        moduleKey: 'system',
        templateKey: 'ticket_new_message',
        recipientIsStaffAdmin: true,
      })
    ).toBe(false);
  });
});

describe('EML-5 · 12-module matrix + packaging', () => {
  it('RC8 email matrix: Meetings INFORMATIONAL; Rental EXCLUDED', () => {
    const byKey = Object.fromEntries(EMAIL_MODULE_INTEGRATIONS.map((m) => [m.moduleKey, m]));
    for (const k of BUSINESS_12) {
      expect(['PASS', 'INFORMATIONAL', 'IN_APP_ONLY']).toContain(byKey[k].status);
    }
    expect(byKey.meetings.status).toBe('INFORMATIONAL');
    expect(byKey.rental_management.status).toBe('EXCLUDED');
    expect(emailIntegrationsReady().map((m) => m.moduleKey)).toContain('meetings');
    expect(emailIntegrationsReady().length).toBeGreaterThanOrEqual(12);
    expect(EMAIL_EVENT_CATALOG.some((e) => e.moduleKey === 'rental_management')).toBe(false);
  });

  it('fresh-install packages EML-5 authz; sending remains OFF', () => {
    expect(isEmailSendingEnvEnabled({})).toBe(false);
    expect(FRESH_INSTALL_ORDERED_FILES).toContain('88_email_core_baseline.sql');
    expect(FRESH_INSTALL_ORDERED_FILES).toContain('89_email_notification_policy.sql');
    const manifest = JSON.parse(
      readFileSync(path.join(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, 'MANIFEST.json'), 'utf8')
    );
    expect(manifest.emailCorePhase).toBe('EML-5');
    expect(manifest.chronologicalMigrationsPackaged).toContain(
      'supabase/migrations/20261116140000_eml5_cleaning_schedule_and_ticket_authz.sql'
    );
    const sql88 = readFileSync(
      path.join(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, '88_email_core_baseline.sql'),
      'utf8'
    );
    expect(sql88).toMatch(/ticket_%/);
    expect(sql88).toMatch(/email_enabled boolean not null default false/);
    expect(sql88).not.toMatch(/RESEND_API_KEY\s*=/);
    const mig = readFileSync(
      path.join(
        process.cwd(),
        'supabase/migrations/20261116140000_eml5_cleaning_schedule_and_ticket_authz.sql'
      ),
      'utf8'
    );
    expect(mig).toMatch(/admin_update_cleaning_order_schedule/);
    expect(mig).toMatch(/email_core_assert_can_enqueue/);
  });
});
