import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FRESH_INSTALL_ORDERED_FILES,
  FRESH_INSTALL_PACKAGE_DIR,
  assertFreshInstallDependencyOrder,
} from '@/lib/moduleCore/freshInstallMeterSchema';
import {
  EMAIL_EVENT_CATALOG,
  SUGGESTED_ADMIN_NOTIFICATION_MODE,
  isSecurityMandatory,
  resolveEventKeyFromEnqueue,
} from '@/lib/email/eventCatalog';
import {
  evaluateNotificationPolicy,
  previewEffectiveEvent,
  type ComplexNotificationState,
} from '@/lib/email/notificationPolicy';
import { previewTransactionalEmail } from '@/lib/email/templates';
import { EMAIL_MODULE_INTEGRATIONS } from '@/lib/email/moduleIntegrations';

const emptyComplex = (): ComplexNotificationState => ({ modules: {}, events: {} });

describe('EML-3 · event catalog classifications', () => {
  it('does not mark every event important; security set is narrow', () => {
    const security = EMAIL_EVENT_CATALOG.filter((e) => e.importance === 'security_mandatory');
    const informational = EMAIL_EVENT_CATALOG.filter((e) => e.importance === 'informational');
    expect(security.length).toBeGreaterThan(0);
    expect(security.length).toBeLessThan(EMAIL_EVENT_CATALOG.length / 2);
    expect(informational.some((e) => e.eventKey.includes('meters'))).toBe(true);
    expect(isSecurityMandatory('pb1_invite_create')).toBe(true);
    expect(isSecurityMandatory('meters_reading_accepted')).toBe(false);
    expect(SUGGESTED_ADMIN_NOTIFICATION_MODE).toBe('IMPORTANT_ONLY');
  });

  it('covers 12 business modules without rental producers', () => {
    const modules = new Set(EMAIL_EVENT_CATALOG.map((e) => e.moduleKey));
    for (const key of [
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
    ]) {
      expect(modules.has(key)).toBe(true);
    }
    expect(EMAIL_EVENT_CATALOG.some((e) => e.moduleKey === 'rental_management')).toBe(false);
    expect(EMAIL_MODULE_INTEGRATIONS.find((m) => m.moduleKey === 'rental_management')?.status).toBe(
      'EXCLUDED'
    );
  });
});

describe('EML-3 · three-level policy', () => {
  it('complex disable blocks optional but not security', () => {
    const complex: ComplexNotificationState = {
      modules: { ownership_transfer: false, property_book: false },
      events: { ownership_change_cancelled: false },
    };
    const blocked = evaluateNotificationPolicy({
      eventKey: 'ownership_change_cancelled',
      complex,
      personal: { mode: 'ALL', eventOverrides: {} },
    });
    expect(blocked.allow).toBe(false);

    const security = evaluateNotificationPolicy({
      eventKey: 'pb1_invite_create',
      complex,
      personal: { mode: 'INFORMATIONAL_OFF', eventOverrides: { pb1_invite_create: false } },
    });
    expect(security.allow).toBe(true);
    expect(security.channel).toBe('immediate');
  });

  it('supports five personal modes including digest and custom', () => {
    const complex = emptyComplex();
    const informational = 'meeting_published';

    expect(
      evaluateNotificationPolicy({
        eventKey: informational,
        complex,
        personal: { mode: 'IMPORTANT_ONLY', eventOverrides: {} },
      }).allow
    ).toBe(false);

    expect(
      evaluateNotificationPolicy({
        eventKey: informational,
        complex,
        personal: { mode: 'INFORMATIONAL_OFF', eventOverrides: {} },
      }).allow
    ).toBe(false);

    const digest = evaluateNotificationPolicy({
      eventKey: informational,
      complex,
      personal: { mode: 'DAILY_DIGEST', eventOverrides: {} },
    });
    expect(digest.allow).toBe(true);
    expect(digest.channel).toBe('digest');

    const customOff = evaluateNotificationPolicy({
      eventKey: informational,
      complex,
      personal: { mode: 'CUSTOM', eventOverrides: { meeting_published: false } },
    });
    expect(customOff.allow).toBe(false);

    const all = evaluateNotificationPolicy({
      eventKey: informational,
      complex,
      personal: { mode: 'ALL', eventOverrides: {} },
    });
    expect(all.allow).toBe(true);
    expect(all.channel).toBe('immediate');
  });

  it('marks complex-disabled events in effective preview', () => {
    const preview = previewEffectiveEvent({
      eventKey: 'meeting_published',
      complex: { modules: { meetings: false }, events: {} },
      personal: { mode: 'ALL', eventOverrides: {} },
    });
    expect(preview.blockedByComplex).toBe(true);
    expect(preview.effective).toBe('blocked');
  });

  it('throttles high-frequency optional events', () => {
    const decision = evaluateNotificationPolicy({
      eventKey: 'ticket_new_message',
      complex: emptyComplex(),
      personal: { mode: 'ALL', eventOverrides: {} },
      throttled: true,
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe('recipient_throttled');
  });
});

describe('EML-3 · enqueue mapping + templates', () => {
  it('resolves legacy module/template to catalog keys', () => {
    expect(
      resolveEventKeyFromEnqueue({
        moduleKey: 'pb1_invite',
        templateKey: 'pb1_property_invite',
        payload: {},
      })
    ).toBe('pb1_invite_create');
    expect(
      resolveEventKeyFromEnqueue({
        moduleKey: 'pkg_xfer',
        templateKey: 'ownership_change_access_revoked',
        payload: { event_kind: 'access_revoked' },
      })
    ).toBe('ownership_change_access_revoked');
  });

  it('renders digest and meeting informational templates BG/RU/EN', () => {
    for (const locale of ['bg', 'ru', 'en'] as const) {
      const digest = previewTransactionalEmail({
        templateKey: 'email_digest_daily',
        locale,
        complexName: 'Test',
      });
      expect(digest.subject.length).toBeGreaterThan(0);
      expect(digest.text.length).toBeGreaterThan(0);
      const meeting = previewTransactionalEmail({
        templateKey: 'meeting_published',
        locale,
        complexName: 'Test',
      });
      expect(meeting.html.toLowerCase()).toMatch(/информац|informational|зуес|legal/i);
    }
  });
});

describe('EML-3 · fresh-install packaging', () => {
  it('orders 89 policy after 88 email core', () => {
    expect(FRESH_INSTALL_ORDERED_FILES).toContain('89_email_notification_policy.sql');
    expect(assertFreshInstallDependencyOrder(FRESH_INSTALL_ORDERED_FILES).ok).toBe(true);
    const idx = (f: string) =>
      FRESH_INSTALL_ORDERED_FILES.indexOf(f as (typeof FRESH_INSTALL_ORDERED_FILES)[number]);
    expect(idx('89_email_notification_policy.sql')).toBeGreaterThan(
      idx('88_email_core_baseline.sql')
    );
    const manifest = JSON.parse(
      readFileSync(path.join(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, 'MANIFEST.json'), 'utf8')
    );
    expect(manifest.orderedFiles).toEqual([...FRESH_INSTALL_ORDERED_FILES]);
    expect(['EML-3', 'EML-4', 'EML-5']).toContain(manifest.emailCorePhase);
    const sql = readFileSync(
      path.join(process.cwd(), FRESH_INSTALL_PACKAGE_DIR, '89_email_notification_policy.sql'),
      'utf8'
    );
    expect(sql).toMatch(/email_user_notification_prefs/);
    expect(sql).toMatch(/email_digest_buffer/);
    expect(sql).not.toMatch(/email_enabled\s*=\s*true/i);
  });
});
