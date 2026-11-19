import { describe, expect, it } from 'vitest';
import {
  EMAIL_OUTBOUND_LOCALE,
  resolveEmailLocale,
} from '@/lib/emailCore';
import { renderTransactionalEmail } from '@/lib/email/templates';

describe('AMADEUS 11 · outbound mail Bulgarian-only', () => {
  it('exports bg as the sole outbound locale', () => {
    expect(EMAIL_OUTBOUND_LOCALE).toBe('bg');
  });

  it('ignores UI / profile / installation locale hints', () => {
    for (const ui of ['ru', 'bg', 'en', null, undefined, 'xx'] as const) {
      for (const install of ['ru', 'en', 'bg', null] as const) {
        expect(resolveEmailLocale(ui as never, install as never)).toBe('bg');
      }
    }
  });

  it('send-time render with subject:null yields Bulgarian template (queue retries)', () => {
    // Worker always passes subject:null + EMAIL_OUTBOUND_LOCALE so a prior RU/EN
    // enqueue subject cannot leak into the provider payload.
    const atSend = renderTransactionalEmail({
      templateKey: 'email_test',
      locale: EMAIL_OUTBOUND_LOCALE,
      subject: null,
      complexName: 'AMADEUS XI E2E',
      override: null,
    });
    expect(atSend.subject).toMatch(/тестово писмо/i);
    expect(atSend.html).toMatch(/Здравейте/);
    expect(atSend.html).toMatch(/пощенския доставчик|връзката/i);
    expect(atSend.html + atSend.text).not.toMatch(/Email Core|контролируем/i);
  });

  it('uses Bulgarian builtins for invite / test when locale forced to bg', () => {
    const invite = renderTransactionalEmail({
      templateKey: 'pb1_property_invite',
      locale: 'bg',
      complexName: 'AMADEUS XI',
      payload: { invite_link: 'https://example.test/invite' },
    });
    expect(invite.subject).toMatch(/покана в кабинета/i);
    expect(invite.html).toMatch(/Отвори поканата/);
    expect(invite.html).toMatch(/Здравейте/);

    const test = renderTransactionalEmail({
      templateKey: 'email_test',
      locale: 'bg',
      complexName: 'AMADEUS XI',
    });
    expect(test.subject).toMatch(/тестово писмо/i);
    expect(test.html).toMatch(/Здравейте/);
  });
});
