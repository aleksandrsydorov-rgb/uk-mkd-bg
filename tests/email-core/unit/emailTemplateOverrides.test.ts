import { describe, expect, it } from 'vitest';
import {
  getBuiltinTemplateParts,
  mergeTemplateParts,
  previewTransactionalEmail,
  renderTransactionalEmail,
  sanitizeTemplatePlainText,
  validateRenderedTemplate,
} from '@/lib/email/templates';
import {
  listEditableTemplateKeys,
  substituteTemplateVariables,
  variablesForTemplate,
} from '@/lib/email/templateVariables';

describe('Email template overrides', () => {
  it('exposes editable catalog without Auth SMTP templates', () => {
    const keys = listEditableTemplateKeys();
    expect(keys.length).toBeGreaterThan(5);
    expect(keys).toContain('pb1_property_invite');
    expect(keys).toContain('email_test');
    expect(keys.some((k) => k.includes('supabase') || k.includes('auth_otp'))).toBe(false);
  });

  it('builtins exist for RU/BG/EN with placeholders', () => {
    for (const locale of ['bg', 'ru', 'en'] as const) {
      const parts = getBuiltinTemplateParts('pb1_property_invite', locale);
      expect(parts.subject).toContain('{{complex}}');
      expect(parts.body).toContain('{{apartment}}');
    }
  });

  it('override of one locale does not alter merge of another builtin', () => {
    const ruBuiltin = getBuiltinTemplateParts('email_test', 'ru');
    const bgBuiltin = getBuiltinTemplateParts('email_test', 'bg');
    const ruCustom = mergeTemplateParts(ruBuiltin, {
      subject: 'Кастомная тема {{complex}}',
      body: 'Кастомный текст',
    });
    expect(ruCustom.subject).toContain('Кастомная');
    expect(bgBuiltin.subject).not.toContain('Кастомная');
  });

  it('preview and send share renderer; demo data marked', () => {
    const preview = previewTransactionalEmail({
      templateKey: 'email_test',
      locale: 'ru',
      override: {
        subject: 'Проба {{complex}}',
        greeting: 'Здравствуйте,',
        body: 'Текст',
        cta: 'Открыть',
        footer: 'Подвал',
      },
    });
    expect(preview.demo).toBe(true);
    expect(preview.subject).toMatch(/пример|AMADEUS/i);
    const validation = validateRenderedTemplate(preview);
    expect(validation.ok).toBe(true);
  });

  it('rejects unknown variables and unsanitized script tags', () => {
    const sub = substituteTemplateVariables('Hello {{evil}}', { complex: 'X' }, {
      allowed: new Set(['complex']),
    });
    expect(sub.unknown).toContain('evil');

    const clean = sanitizeTemplatePlainText('<script>alert(1)</script>Hi <b>there</b>');
    expect(clean).not.toMatch(/script/i);
    expect(clean).toContain('Hi');
    expect(clean).not.toContain('<b>');
  });

  it('blocks unresolved invite_link when used', () => {
    const rendered = renderTransactionalEmail({
      templateKey: 'pb1_property_invite',
      locale: 'en',
      complexName: 'Complex',
      payload: { apartment: '1' },
      override: {
        subject: 'Invite',
        greeting: 'Hi',
        body: 'Open {{invite_link}}',
        cta: 'Go',
        footer: 'Bye',
      },
    });
    expect(rendered.missingRequired).toContain('invite_link');
    expect(validateRenderedTemplate(rendered).ok).toBe(false);
  });

  it('lists only supported variables per event', () => {
    const invite = variablesForTemplate('pb1_property_invite').map((v) => v.id);
    expect(invite).toContain('invite_link');
    expect(invite).toContain('apartment');
    const meters = variablesForTemplate('meters_payment_recorded').map((v) => v.id);
    expect(meters).toContain('amount');
    expect(meters).not.toContain('invite_link');
  });
});
