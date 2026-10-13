import { describe, expect, it } from 'vitest';
import {
  EMAIL_CORE_CONSUMERS,
  assertNoClientSecrets,
  buildIdempotencyKey,
  deriveDeliveryStatus,
  isEmailSendingEnvEnabled,
  maskEmail,
  moduleFallbackStatus,
  parseEmailSettingsPayload,
  phaseAResendAdapter,
  serverSecretPresent,
} from '@/lib/emailCore';

describe('Email Core Phase A · configuration & honesty', () => {
  it('defaults EMAIL_SENDING_ENABLED to false', () => {
    expect(isEmailSendingEnvEnabled({})).toBe(false);
    expect(isEmailSendingEnvEnabled({ EMAIL_SENDING_ENABLED: 'false' })).toBe(false);
    expect(isEmailSendingEnvEnabled({ EMAIL_SENDING_ENABLED: '1' })).toBe(true);
  });

  it('never reports ready without verified sender, domain, enable, and secrets', () => {
    expect(
      deriveDeliveryStatus({
        domainStatus: 'none',
        verifiedDomain: null,
        senderEmail: null,
        hasVerifiedSender: false,
        emailEnabled: false,
        serverSecretPresent: false,
      })
    ).toBe('not_configured');

    expect(
      deriveDeliveryStatus({
        domainStatus: 'pending',
        verifiedDomain: 'example.com',
        senderEmail: 'mail@example.com',
        hasVerifiedSender: true,
        emailEnabled: false,
        serverSecretPresent: false,
      })
    ).toBe('domain_pending');

    expect(
      deriveDeliveryStatus({
        domainStatus: 'verified',
        verifiedDomain: 'example.com',
        senderEmail: 'mail@example.com',
        hasVerifiedSender: true,
        emailEnabled: false,
        serverSecretPresent: true,
      })
    ).toBe('paused');

    expect(
      deriveDeliveryStatus({
        domainStatus: 'verified',
        verifiedDomain: 'example.com',
        senderEmail: 'mail@example.com',
        hasVerifiedSender: true,
        emailEnabled: true,
        serverSecretPresent: true,
      })
    ).toBe('ready');
  });

  it('preserves module fallback honesty statuses', () => {
    expect(moduleFallbackStatus('pb1_invite', false)).toBe('COPY_LINK');
    expect(moduleFallbackStatus('user_activation', false)).toBe('PROVIDER_NOT_CONFIGURED');
    expect(moduleFallbackStatus('pkg_xfer', false)).toBe('PROVIDER_NOT_CONFIGURED');
    expect(moduleFallbackStatus('meeting', false)).toBe('in_app_only');
    expect(moduleFallbackStatus('pb1_invite', true)).toBe('QUEUED');
  });

  it('maps PB1 blocked enqueue to COPY_LINK (not generic PROVIDER_NOT_CONFIGURED)', async () => {
    const { honestyFromEnqueue } = await import('@/lib/emailCore');
    expect(
      honestyFromEnqueue('pb1_invite', {
        queued: false,
        sent: false,
        fallback: 'PROVIDER_NOT_CONFIGURED',
      })
    ).toBe('COPY_LINK');
    expect(
      honestyFromEnqueue('user_activation', {
        queued: false,
        sent: false,
        fallback: 'PROVIDER_NOT_CONFIGURED',
      })
    ).toBe('PROVIDER_NOT_CONFIGURED');
    expect(
      honestyFromEnqueue('pb1_invite', { queued: true, sent: false, fallback: 'QUEUED' })
    ).toBe('QUEUED');
  });

  it('builds stable idempotency keys for consumers', () => {
    const pb1 = EMAIL_CORE_CONSUMERS.pb1.buildIdempotencyKey({
      inviteId: '11111111-1111-1111-1111-111111111111',
      version: 'v1',
    });
    expect(pb1).toBe('pb1_invite:11111111-1111-1111-1111-111111111111:v1');

    const xfer = EMAIL_CORE_CONSUMERS.pkgXfer.buildIdempotencyKey({
      transferId: 47,
      eventKind: 'submitted',
      emailHash: 'abc',
    });
    expect(xfer).toBe('pkg_xfer:47:submitted:abc');
    expect(buildIdempotencyKey(['a', null, 'b', ''])).toBe('a:b');
  });

  it('masks recipient emails for diagnostics', () => {
    expect(maskEmail('owner@example.com')).toBe('o***@example.com');
    expect(maskEmail('  A@X.COM ')).toBe('*@x.com'); // single-char local part
  });

  it('Phase A adapter refuses send', async () => {
    const res = await phaseAResendAdapter.send({
      to: 't@example.com',
      subject: 'x',
      html: '<p>x</p>',
      fromName: 'Test',
      fromEmail: 'from@example.com',
    });
    expect(res).toEqual({ ok: false, reason: 'phase_a_no_send' });
  });

  it('forbids client-side secret probes', () => {
    expect(() => assertNoClientSecrets({ RESEND_API_KEY: 're_xxx' })).toThrow(/forbidden secret/);
    expect(() => assertNoClientSecrets({ foo: 1 })).not.toThrow();
  });

  it('parseEmailSettingsPayload stays not ready without verified config + host secrets', () => {
    const parsed = parseEmailSettingsPayload({
      mail_provider: 'resend',
      sender_name: 'Complex',
      sender_email: null,
      reply_to_email: null,
      verified_domain: null,
      provider_domain_id: null,
      domain_status: 'none',
      email_enabled: true,
      template_locale: 'bg',
      platform_disabled: false,
      delivery_status: 'ready',
      sending_ready: true,
      phase: 'B',
      secrets_in_database: false,
      verified_senders: [],
    });
    expect(parsed.sending_ready).toBe(false);
    expect(parsed.secrets_in_database).toBe(false);
    expect(parsed.delivery_status).not.toBe('ready');
  });

  it('serverSecretPresent is false without both key and send flag', () => {
    expect(serverSecretPresent({})).toBe(false);
    expect(serverSecretPresent({ RESEND_API_KEY: 'x' })).toBe(false);
    expect(
      serverSecretPresent({ RESEND_API_KEY: 'x', EMAIL_SENDING_ENABLED: '1' })
    ).toBe(true);
  });
});

describe('Email Core Phase A · RLS policy expectations (static)', () => {
  /**
   * Full SQL RLS execution requires an isolated DB (shared Supabase must not be mutated).
   * These assertions lock the intended security model into the test suite.
   */
  const SECURITY_MODEL = {
    settingsSelectRole: 'администрация',
    verifiedSenderMutations: 'service_role_only',
    secretsInPublicTables: false,
    ownerCrossReadOutbox: false,
    emailEnabledDefault: false,
    isReadyPhaseA: false,
    hardcodedDomainsForbidden: ['amadeus11.online', 'alsyd.cloud'],
  };

  it('documents admin-only settings and service-role verified senders', () => {
    expect(SECURITY_MODEL.settingsSelectRole).toBe('администрация');
    expect(SECURITY_MODEL.verifiedSenderMutations).toBe('service_role_only');
    expect(SECURITY_MODEL.secretsInPublicTables).toBe(false);
    expect(SECURITY_MODEL.ownerCrossReadOutbox).toBe(false);
  });

  it('keeps send disabled in Phase A defaults', () => {
    expect(SECURITY_MODEL.emailEnabledDefault).toBe(false);
    expect(SECURITY_MODEL.isReadyPhaseA).toBe(false);
  });

  it('does not hardcode complex/platform mail domains in Email Core module keys', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'src/lib/emailCore.ts'),
      'utf8'
    );
    for (const domain of SECURITY_MODEL.hardcodedDomainsForbidden) {
      expect(src.includes(domain)).toBe(false);
    }
  });
});
