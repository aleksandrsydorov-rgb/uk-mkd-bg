import { describe, expect, it } from 'vitest';
import {
  canEnqueueEmail,
  emailTemplateMatchesModule,
} from '@/lib/securityRpcPolicy';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = path.resolve(
  process.cwd(),
  'supabase/migrations/20261015120000_phase_e1_security_hardening.sql'
);

describe('SEC-P1-2 · email_core_enqueue authz', () => {
  it('matches template prefixes to modules (anti-spoof)', () => {
    expect(emailTemplateMatchesModule('pb1_invite', 'pb1_property_invite')).toBe(true);
    expect(emailTemplateMatchesModule('pb1_invite', 'ownership_change_submitted')).toBe(false);
    expect(emailTemplateMatchesModule('pkg_xfer', 'ownership_change_approved')).toBe(true);
    expect(emailTemplateMatchesModule('pkg_xfer', 'pb1_property_invite')).toBe(false);
    expect(emailTemplateMatchesModule('user_activation', 'ua_reminder')).toBe(true);
    expect(emailTemplateMatchesModule('meeting', 'meeting_notice')).toBe(true);
    expect(emailTemplateMatchesModule('email_test', 'email_test')).toBe(true);
    expect(emailTemplateMatchesModule('system', 'meters_payment_recorded')).toBe(true);
    expect(emailTemplateMatchesModule('system', 'system_ping')).toBe(false);
  });

  it('allows service_role for any valid module/template', () => {
    expect(
      canEnqueueEmail({
        role: 'service_role',
        isBookAdmin: false,
        ownsPayloadProperty: false,
        moduleKey: 'system',
        templateKey: 'system_ping',
      })
    ).toBe(true);
  });

  it('allows admin for PB1 / UA / email_test; denies meeting (R1-MT-HIDE) and random user', () => {
    for (const moduleKey of ['pb1_invite', 'user_activation', 'email_test'] as const) {
      const templateKey =
        moduleKey === 'pb1_invite'
          ? 'pb1_property_invite'
          : moduleKey === 'user_activation'
            ? 'ua_reminder'
            : 'email_test';
      expect(
        canEnqueueEmail({
          role: 'authenticated',
          isBookAdmin: true,
          ownsPayloadProperty: false,
          moduleKey,
          templateKey,
        })
      ).toBe(true);
      expect(
        canEnqueueEmail({
          role: 'authenticated',
          isBookAdmin: false,
          ownsPayloadProperty: false,
          moduleKey,
          templateKey,
        })
      ).toBe(false);
    }
    expect(
      canEnqueueEmail({
        role: 'authenticated',
        isBookAdmin: true,
        ownsPayloadProperty: false,
        moduleKey: 'meeting',
        templateKey: 'meeting_notice',
      })
    ).toBe(false);
  });

  it('allows pkg_xfer for admin or owner of payload property; denies unrelated', () => {
    expect(
      canEnqueueEmail({
        role: 'authenticated',
        isBookAdmin: true,
        ownsPayloadProperty: false,
        moduleKey: 'pkg_xfer',
        templateKey: 'ownership_change_submitted',
      })
    ).toBe(true);
    expect(
      canEnqueueEmail({
        role: 'authenticated',
        isBookAdmin: false,
        ownsPayloadProperty: true,
        moduleKey: 'pkg_xfer',
        templateKey: 'ownership_change_submitted',
      })
    ).toBe(true);
    expect(
      canEnqueueEmail({
        role: 'authenticated',
        isBookAdmin: false,
        ownsPayloadProperty: false,
        moduleKey: 'pkg_xfer',
        templateKey: 'ownership_change_submitted',
      })
    ).toBe(false);
  });

  it('EML-4: allowlisted system templates for admin/owner; denies unknown system_*', () => {
    expect(
      canEnqueueEmail({
        role: 'authenticated',
        isBookAdmin: true,
        ownsPayloadProperty: false,
        moduleKey: 'system',
        templateKey: 'system_ping',
      })
    ).toBe(false);
    expect(
      canEnqueueEmail({
        role: 'authenticated',
        isBookAdmin: true,
        ownsPayloadProperty: false,
        moduleKey: 'system',
        templateKey: 'meters_payment_recorded',
      })
    ).toBe(true);
    expect(
      canEnqueueEmail({
        role: 'authenticated',
        isBookAdmin: false,
        ownsPayloadProperty: true,
        moduleKey: 'system',
        templateKey: 'meters_reading_accepted',
      })
    ).toBe(true);
    expect(
      canEnqueueEmail({
        role: 'authenticated',
        isBookAdmin: false,
        ownsPayloadProperty: false,
        moduleKey: 'system',
        templateKey: 'meters_reading_accepted',
      })
    ).toBe(false);
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
  });

  it('denies template/module mismatch even for admin', () => {
    expect(
      canEnqueueEmail({
        role: 'authenticated',
        isBookAdmin: true,
        ownsPayloadProperty: false,
        moduleKey: 'pb1_invite',
        templateKey: 'ownership_change_submitted',
      })
    ).toBe(false);
  });

  it('migration asserts before enqueue insert and keeps sending gates untouched', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('email_core_assert_can_enqueue');
    expect(sql).toContain('perform public.email_core_assert_can_enqueue');
    expect(sql).toContain('template_key mismatch');
    expect(sql).toContain('email_core_enqueue: forbidden');
    expect(sql).not.toMatch(/email_enabled\s*=\s*true/i);
    expect(sql).not.toMatch(/ordinary_debt_gate_enabled\s*=\s*true/i);
  });
});
