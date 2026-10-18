import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FRESH_INSTALL_ORDERED_FILES,
  FRESH_INSTALL_PACKAGE_DIR,
  assertFreshInstallDependencyOrder,
  assertPackageObjectCoverage,
} from '@/lib/moduleCore/freshInstallMeterSchema';
import {
  EMAIL_CROSS_CUTTING_INTEGRATIONS,
  EMAIL_MODULE_INTEGRATIONS,
  emailIntegrationsNeedingDecision,
  emailIntegrationsReady,
} from '@/lib/email/moduleIntegrations';
import { previewTransactionalEmail, renderTransactionalEmail } from '@/lib/email/templates';
import {
  EMAIL_PREVIEW_TEMPLATE_KEYS,
  validateEmailSetupDraft,
} from '@/lib/email/setupValidation';
import { EMAIL_CORE_CONSUMERS, isEmailSendingEnvEnabled } from '@/lib/emailCore';
import { canWorkerSend } from '@/lib/email/outboxWorker';

function read(rel: string) {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

describe('EML-2 · fresh-install Email Core packaging', () => {
  it('orderedFiles includes 88_email_core after book auth and before bootstrap', () => {
    expect(FRESH_INSTALL_ORDERED_FILES).toContain('88_email_core_baseline.sql');
    const order = assertFreshInstallDependencyOrder(FRESH_INSTALL_ORDERED_FILES);
    expect(order.ok).toBe(true);
    const idx = (f: string) =>
      FRESH_INSTALL_ORDERED_FILES.indexOf(f as (typeof FRESH_INSTALL_ORDERED_FILES)[number]);
    expect(idx('88_email_core_baseline.sql')).toBeGreaterThan(idx('45_property_book_auth_helpers.sql'));
    expect(idx('88_email_core_baseline.sql')).toBeLessThan(idx('90_first_admin_bootstrap.sql'));
  });

  it('MANIFEST lists Email Core relations/functions and keeps email_enabled false defaults', () => {
    const manifest = JSON.parse(read(path.join(FRESH_INSTALL_PACKAGE_DIR, 'MANIFEST.json')));
    expect(manifest.orderedFiles).toEqual([...FRESH_INSTALL_ORDERED_FILES]);
    expect(['EML-2', 'EML-3', 'EML-4', 'EML-5']).toContain(manifest.emailCorePhase);
    expect(manifest.requiredRelationsAfterPackage).toEqual(
      expect.arrayContaining([
        'public.complex_email_settings',
        'public.email_outbox',
        'public.email_delivery_attempts',
        'public.email_delivery_events',
      ])
    );
    expect(manifest.requiredFunctionsAfterPackage).toEqual(
      expect.arrayContaining([
        'public.email_core_is_ready()',
        'public.email_core_enqueue(text,text,text,text,text,text,jsonb)',
        'public.admin_get_email_settings()',
      ])
    );
    expect(manifest.forbidden).toEqual(
      expect.arrayContaining(['email_sending_enabled_by_default', 'resend_api_keys_in_database'])
    );

    const sql = read(path.join(FRESH_INSTALL_PACKAGE_DIR, '88_email_core_baseline.sql'));
    expect(sql).toMatch(/email_enabled boolean not null default false/i);
    expect(sql).toMatch(/email_core_assert_can_enqueue/i);
    expect(sql).toMatch(/email_core_claim_outbox_batch/i);
    expect(sql).not.toMatch(/sk_live|re_[A-Za-z0-9]{20,}/);
    // Only singleton settings seed; no hardcoded recipient/verified-sender emails.
    expect(sql).toMatch(/insert into public\.complex_email_settings \(id\)\s*values \(1\)/i);
    expect(sql).not.toMatch(/values\s*\(\s*'[^']+@[^']+'/i);
    expect(sql).not.toMatch(/to_email\s*[:=]\s*'[^']+@/i);

    const coverage = assertPackageObjectCoverage(
      sql,
      [
        'public.complex_email_settings',
        'public.email_verified_senders',
        'public.email_outbox',
        'public.email_delivery_attempts',
        'public.email_delivery_events',
      ],
      [
        'public.email_core_is_ready()',
        'public.admin_get_email_settings()',
        'public.email_core_enqueue(text,text,text,text,text,text,jsonb)',
      ]
    );
    expect(coverage.ok).toBe(true);
  });
});

describe('EML-2 · module integration matrix', () => {
  it('preserves PB1 and Ownership Transfer; Meetings EXCLUDED in R1.0; undecided not invented', () => {
    const byKey = Object.fromEntries(EMAIL_MODULE_INTEGRATIONS.map((m) => [m.moduleKey, m]));
    expect(byKey.property_book.status).toBe('PASS');
    expect(byKey.ownership_transfer.status).toBe('PASS');
    expect(byKey.meetings.status).toBe('EXCLUDED');
    expect(byKey.rental_management.status).toBe('EXCLUDED');
    // EML-5 completes remaining module producers; rental + meetings stay excluded.
    expect(emailIntegrationsNeedingDecision()).toEqual([]);
    expect(byKey.meters.status).toBe('PASS');
    expect(byKey.cleaning.status).toBe('PASS');
    expect(byKey.inventory.status).toBe('PASS');
    expect(emailIntegrationsReady().some((m) => m.moduleKey === 'property_book')).toBe(true);
    expect(EMAIL_CROSS_CUTTING_INTEGRATIONS.some((m) => m.moduleKey === 'user_activation')).toBe(
      true
    );
    expect(EMAIL_CORE_CONSUMERS.pb1.module).toBe('pb1_invite');
    expect(EMAIL_CORE_CONSUMERS.pkgXfer.module).toBe('pkg_xfer');
    expect(EMAIL_CORE_CONSUMERS.meeting.honestyWhenNotReady).toBe('in_app_only');
  });
});

describe('EML-2 · preview + setup validation + dual gates', () => {
  it('previews HTML and text in BG/RU/EN without sending', () => {
    for (const locale of ['bg', 'ru', 'en'] as const) {
      for (const templateKey of EMAIL_PREVIEW_TEMPLATE_KEYS) {
        const preview = previewTransactionalEmail({
          templateKey,
          locale,
          complexName: 'Test Complex',
          payload: {
            invite_link: 'https://example.invalid/auth/invite?token=x',
            apartment: '1',
            event_kind: 'approved',
            reminderType: 'nudge',
          },
        });
        expect(preview.subject.length).toBeGreaterThan(0);
        expect(preview.html).toContain('<html');
        expect(preview.text.length).toBeGreaterThan(0);
        expect(preview.locale).toBe(locale);
      }
    }
    const rendered = renderTransactionalEmail({
      templateKey: 'email_test',
      locale: 'en',
      complexName: 'X',
    });
    expect(rendered).toHaveProperty('text');
  });

  it('validates Initial Setup identity and refuses enable without verified sender/domain', () => {
    const bad = validateEmailSetupDraft({
      senderName: '',
      replyToEmail: 'not-an-email',
      templateLocale: 'bg',
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors).toEqual(expect.arrayContaining(['sender_name_required', 'reply_to_invalid']));

    const okPending = validateEmailSetupDraft(
      {
        senderName: 'Complex Office',
        replyToEmail: 'office@example.com',
        templateLocale: 'en',
      },
      { domainStatus: 'none', verifiedSenderEmails: [] }
    );
    expect(okPending.ok).toBe(true);
    expect(okPending.canSaveIdentity).toBe(true);
    expect(okPending.canEnableSending).toBe(false);
    expect(okPending.warnings).toEqual(
      expect.arrayContaining(['sender_email_pending_ops_verification', 'domain_not_verified'])
    );

    const ready = validateEmailSetupDraft(
      {
        senderName: 'Complex Office',
        replyToEmail: 'office@example.com',
        templateLocale: 'bg',
        senderEmail: 'mail@complex.example',
      },
      {
        verifiedSenderEmails: ['mail@complex.example'],
        domainStatus: 'verified',
        verifiedDomain: 'complex.example',
      }
    );
    expect(ready.canEnableSending).toBe(true);
  });

  it('worker stays skipped when EMAIL_SENDING_ENABLED is false', () => {
    expect(isEmailSendingEnvEnabled({ EMAIL_SENDING_ENABLED: 'false' })).toBe(false);
    expect(canWorkerSend({ EMAIL_SENDING_ENABLED: 'false', RESEND_API_KEY: 're_test' }).ok).toBe(
      false
    );
  });
});
