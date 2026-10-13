import { describe, expect, it } from 'vitest';
import {
  buildAuthCallbackUrl,
  buildInviteAcceptPath,
  normalizeAuthOtpType,
  safeNextPath,
  signupOtpVerifyTypes,
} from '@/lib/auth/emailConfirmation';
import { renderTransactionalEmail } from '@/lib/email/templates';
import { computeBackoffSeconds } from '@/lib/email/outboxWorker';
import { buildIdempotencyKey, EMAIL_CORE_PHASE } from '@/lib/emailCore';

describe('Email Core Phase C · Auth confirmation helpers', () => {
  it('normalizes signup/confirm types to email OTP family', () => {
    expect(normalizeAuthOtpType('signup')).toBe('signup');
    expect(normalizeAuthOtpType('email')).toBe('email');
    expect(normalizeAuthOtpType('confirm')).toBe('email');
    expect(normalizeAuthOtpType('weird')).toBe('email');
  });

  it('prefers type=email then signup for typed OTP verify', () => {
    expect(signupOtpVerifyTypes()).toEqual(['email', 'signup']);
  });

  it('builds callback URL with safe next path for invite accept', () => {
    const next = buildInviteAcceptPath('abc123');
    expect(next).toBe('/auth/invite?token=abc123');
    const url = buildAuthCallbackUrl({
      origin: 'https://amadeus11.online',
      nextPath: next,
    });
    expect(url).toContain('https://amadeus11.online/auth/callback?next=');
    expect(decodeURIComponent(url)).toContain('/auth/invite?token=abc123');
  });

  it('rejects open redirects in next path', () => {
    expect(safeNextPath('https://evil.example')).toBe('/account');
    expect(safeNextPath('//evil.example')).toBe('/account');
    expect(safeNextPath('/auth/update-password')).toBe('/auth/update-password');
  });
});

describe('Email Core Phase C · templates BG/RU/EN', () => {
  it('renders PB1 invite with CTA link in all locales', () => {
    for (const locale of ['bg', 'ru', 'en'] as const) {
      const { subject, html } = renderTransactionalEmail({
        templateKey: 'pb1_property_invite',
        locale,
        payload: {
          invite_link: 'https://amadeus11.online/auth/invite?token=t1',
          apartment: '12',
        },
        complexName: 'Amadeus 11',
      });
      expect(subject.toLowerCase()).toContain('amadeus 11');
      expect(html).toContain('https://amadeus11.online/auth/invite?token=t1');
      expect(html).toContain('12');
    }
  });

  it('renders email_test and ownership_change subjects without leaking raw keys only', () => {
    const testMail = renderTransactionalEmail({
      templateKey: 'email_test',
      locale: 'en',
      complexName: 'Amadeus 11',
    });
    expect(testMail.subject).toMatch(/test email/i);

    const xfer = renderTransactionalEmail({
      templateKey: 'ownership_change_approved',
      locale: 'ru',
      payload: { event_kind: 'approved' },
      complexName: 'Amadeus 11',
    });
    expect(xfer.subject).toMatch(/собствен/i);
    expect(xfer.html).toContain('approved');
  });
});

describe('Email Core Phase C · idempotency & retry helpers', () => {
  it('keeps phase marker at D (supersedes C)', () => {
    expect(EMAIL_CORE_PHASE).toBe('D');
  });

  it('builds stable idempotency keys for test + invite', () => {
    expect(buildIdempotencyKey(['pb1_invite', 'id-1', 'v1'])).toBe('pb1_invite:id-1:v1');
    expect(buildIdempotencyKey(['email_test', 'a@b.com', 'n1'])).toBe('email_test:a@b.com:n1');
  });

  it('backoff grows then caps at 3600s', () => {
    expect(computeBackoffSeconds(1)).toBe(60);
    expect(computeBackoffSeconds(2)).toBe(120);
    expect(computeBackoffSeconds(10)).toBe(3600);
  });
});
