import type { EmailTemplateLocale } from '@/lib/emailCore';
import {
  demoPayloadForTemplate,
  findTemplateVariables,
  substituteTemplateVariables,
  variablesForTemplate,
} from '@/lib/email/templateVariables';

type Locale = EmailTemplateLocale | string;

/** Editable plain-text parts of a transactional email (no raw HTML required). */
export type EmailTemplateParts = {
  subject: string;
  greeting: string;
  body: string;
  cta: string;
  footer: string;
};

export type EmailTemplateOverride = Partial<EmailTemplateParts> & {
  subject?: string;
  greeting?: string;
  body?: string;
  cta?: string;
  footer?: string;
};

export type RenderTransactionalResult = {
  subject: string;
  html: string;
  text: string;
  unresolved: string[];
  unknown: string[];
  missingRequired: string[];
};

function normalizeLocale(locale: Locale): EmailTemplateLocale {
  return ['bg', 'ru', 'en'].includes(String(locale))
    ? (locale as EmailTemplateLocale)
    : 'bg';
}

/** Built-in RU/BG/EN parts with {{variables}} — basis for editor defaults. */
export function getBuiltinTemplateParts(
  templateKey: string,
  locale: Locale
): EmailTemplateParts {
  const loc = normalizeLocale(locale);
  return resolveBuiltinParts(templateKey, loc);
}

export function mergeTemplateParts(
  builtin: EmailTemplateParts,
  override?: EmailTemplateOverride | null
): EmailTemplateParts {
  if (!override) return { ...builtin };
  return {
    subject: pickPart(override.subject, builtin.subject),
    greeting: pickPart(override.greeting, builtin.greeting),
    body: pickPart(override.body, builtin.body),
    cta: pickPart(override.cta, builtin.cta),
    footer: pickPart(override.footer, builtin.footer),
  };
}

function pickPart(override: string | undefined, fallback: string) {
  if (override == null) return fallback;
  return String(override);
}

/** Build variable map from outbox payload + complex name. */
export function buildTemplateVarValues(opts: {
  templateKey: string;
  payload?: Record<string, unknown> | null;
  complexName?: string | null;
}): Record<string, string> {
  const payload = opts.payload ?? {};
  const complex = (opts.complexName ?? '').trim() || '—';
  const apartment = str(payload.apartment ?? payload.apartment_number);
  const preferredDate = str(payload.preferred_date ?? payload.preferredDate);
  const timeSlot = str(payload.time_slot ?? payload.timeSlot);
  const scheduleHint =
    str(payload.schedule_hint) ||
    [preferredDate, timeSlot].filter(Boolean).join(' · ') ||
    '';
  const inviteLink = str(payload.invite_link ?? payload.inviteLink);
  const link = str(payload.link ?? payload.cabinet_link ?? payload.cabinetLink) || inviteLink;

  const values: Record<string, string> = {
    complex,
    recipient_name: str(
      payload.recipient_name ?? payload.recipientName ?? payload.owner_name ?? payload.ownerName
    ),
    apartment: apartment || '—',
    section: str(payload.section ?? payload.section_code ?? payload.sectionCode),
    amount: str(payload.amount ?? payload.amount_formatted ?? payload.amountFormatted),
    period: str(payload.period ?? payload.billing_period ?? payload.billingPeriod),
    invite_link: inviteLink,
    link,
    event_kind: str(payload.event_kind ?? payload.eventKind),
    reminder_type: str(payload.reminderType ?? payload.reminder_type),
    preferred_date: preferredDate,
    time_slot: timeSlot,
    schedule_hint: scheduleHint || '—',
  };
  return values;
}

/**
 * Shared render for worker send and admin preview.
 * Template is applied at send/render time (not rewritten onto queued outbox rows).
 */
export function renderTransactionalEmail(opts: {
  templateKey: string;
  locale: Locale;
  subject?: string | null;
  payload?: Record<string, unknown> | null;
  complexName?: string | null;
  override?: EmailTemplateOverride | null;
  /**
   * When false (default for legacy callers), unresolved vars are left escaped as text.
   * Worker/admin preview use strict checks via validateRenderedTemplate.
   */
  demo?: boolean;
}): RenderTransactionalResult {
  const locale = normalizeLocale(opts.locale);
  const builtin = getBuiltinTemplateParts(opts.templateKey, locale);
  const parts = mergeTemplateParts(builtin, opts.override);
  const values = buildTemplateVarValues({
    templateKey: opts.templateKey,
    payload: opts.payload,
    complexName: (opts.complexName ?? '').trim() || defaultComplexLabel(locale),
  });
  if (opts.demo) {
    Object.assign(values, demoPayloadForTemplate(opts.templateKey), {
      complex:
        (opts.complexName ?? '').trim() ||
        demoPayloadForTemplate(opts.templateKey).complex ||
        values.complex,
    });
  } else if ((opts.complexName ?? '').trim()) {
    values.complex = String(opts.complexName).trim();
  }

  const allowed = new Set(variablesForTemplate(opts.templateKey).map((v) => v.id));
  // complex always allowed
  allowed.add('complex');

  const subSubject = substituteTemplateVariables(parts.subject, values, { allowed });
  const subGreeting = substituteTemplateVariables(parts.greeting, values, { allowed });
  const subBody = substituteTemplateVariables(parts.body, values, { allowed });
  const subCta = substituteTemplateVariables(parts.cta, values, { allowed });
  const subFooter = substituteTemplateVariables(parts.footer, values, { allowed });

  const unresolved = uniq([
    ...subSubject.unresolved,
    ...subGreeting.unresolved,
    ...subBody.unresolved,
    ...subCta.unresolved,
    ...subFooter.unresolved,
  ]);
  const unknown = uniq([
    ...subSubject.unknown,
    ...subGreeting.unknown,
    ...subBody.unknown,
    ...subCta.unknown,
    ...subFooter.unknown,
  ]);

  const missingRequired: string[] = [];
  const allText = [parts.subject, parts.greeting, parts.body, parts.cta, parts.footer].join('\n');
  const used = findTemplateVariables(allText);
  for (const def of variablesForTemplate(opts.templateKey)) {
    if (!def.requiredWhenUsed) continue;
    if (!used.includes(def.id)) continue;
    const v = values[def.id];
    if (!v || !String(v).trim()) missingRequired.push(def.id);
  }

  // Legacy: explicit subject on outbox wins only when no override subject and no {{}} in builtin path
  const subjectFromOpts = (opts.subject ?? '').trim();
  const subject =
    subjectFromOpts && !opts.override?.subject
      ? subjectFromOpts
      : subSubject.text;

  const inviteLink = values.invite_link || values.link || '';
  const usesLink =
    used.includes('invite_link') ||
    used.includes('link') ||
    Boolean(inviteLink && (opts.templateKey.startsWith('pb1_') || opts.templateKey.startsWith('ua_')));

  const ctaHtml =
    usesLink && inviteLink
      ? `<p style="margin:20px 0;"><a href="${escapeAttr(inviteLink)}" style="display:inline-block;background:#0f3d4c;color:#fff;text-decoration:none;padding:10px 16px;border-radius:999px;font-weight:600;">${escapeHtml(subCta.text)}</a></p>
  <p style="color:#667085;font-size:12px;word-break:break-all;">${escapeHtml(inviteLink)}</p>`
      : '';

  const html = `<!doctype html>
<html lang="${locale}">
<body style="font-family: Georgia, 'Times New Roman', serif; line-height: 1.55; color: #14202a; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p style="font-size:15px;">${escapeHtml(subGreeting.text)}</p>
  <p style="font-size:15px; white-space: pre-wrap;">${escapeHtml(subBody.text)}</p>
  ${ctaHtml}
  <p style="color:#667085;font-size:12px;margin-top:28px;">${escapeHtml(subFooter.text)}</p>
</body>
</html>`;

  const textParts = [subGreeting.text, '', subBody.text];
  if (usesLink && inviteLink) {
    textParts.push('', `${subCta.text}: ${inviteLink}`);
  }
  textParts.push('', subFooter.text);
  const text = textParts.join('\n');

  return { subject, html, text, unresolved, unknown, missingRequired };
}

export function validateRenderedTemplate(result: RenderTransactionalResult): {
  ok: boolean;
  reason?: string;
} {
  if (result.unknown.length) {
    return { ok: false, reason: `unknown_variables:${result.unknown.join(',')}` };
  }
  if (result.unresolved.length) {
    return { ok: false, reason: `unresolved_variables:${result.unresolved.join(',')}` };
  }
  if (result.missingRequired.length) {
    return { ok: false, reason: `missing_required:${result.missingRequired.join(',')}` };
  }
  // Block leftover {{…}} in output (fail closed)
  if (/\{\{[^}]+\}\}/.test(result.subject + result.html + result.text)) {
    return { ok: false, reason: 'unexpanded_placeholders' };
  }
  return { ok: true };
}

/** Preview helper — same renderer as send; demo payload marked as example. */
export function previewTransactionalEmail(opts: {
  templateKey: string;
  locale: Locale;
  payload?: Record<string, unknown> | null;
  complexName?: string | null;
  override?: EmailTemplateOverride | null;
}): RenderTransactionalResult & { locale: EmailTemplateLocale; demo: true } {
  const locale = normalizeLocale(opts.locale);
  const demoPayload = {
    ...demoPayloadForTemplate(opts.templateKey),
    ...(opts.payload ?? {}),
  };
  const rendered = renderTransactionalEmail({
    templateKey: opts.templateKey,
    locale,
    payload: demoPayload,
    complexName: opts.complexName ?? demoPayload.complex,
    override: opts.override,
    demo: true,
  });
  return { ...rendered, locale, demo: true };
}

function resolveBuiltinParts(
  templateKey: string,
  locale: EmailTemplateLocale
): EmailTemplateParts {
  const key = templateKey.trim().toLowerCase();

  if (key === 'pb1_property_invite' || key.startsWith('pb1_')) {
    return {
      subject: t(locale, {
        bg: '{{complex}}: покана в кабинета',
        ru: '{{complex}}: приглашение в кабинет',
        en: '{{complex}}: cabinet invitation',
      }),
      greeting: greeting(locale),
      body: t(locale, {
        bg: 'Получихте покана за достъп до апартамент {{apartment}} в {{complex}}. Отворете връзката, задайте парола и потвърдете имейла.',
        ru: 'Вас пригласили к доступу в апартамент {{apartment}} комплекса {{complex}}. Откройте ссылку, задайте пароль и подтвердите email.',
        en: 'You are invited to access apartment {{apartment}} at {{complex}}. Open the link, set a password, and confirm your email.',
      }),
      cta: t(locale, { bg: 'Отвори поканата', ru: 'Открыть приглашение', en: 'Open invitation' }),
      footer: footer(locale),
    };
  }

  if (key.startsWith('ua_') || key.includes('activation')) {
    return {
      subject: t(locale, {
        bg: '{{complex}}: активирайте кабинета',
        ru: '{{complex}}: активируйте кабинет',
        en: '{{complex}}: activate your cabinet',
      }),
      greeting: greeting(locale),
      body: t(locale, {
        bg: 'Напомняне ({{reminder_type}}) от {{complex}}. Влезте в кабинета или завършете поканата, за да ползвате услугите.',
        ru: 'Напоминание ({{reminder_type}}) от {{complex}}. Войдите в кабинет или завершите приглашение, чтобы пользоваться сервисом.',
        en: 'Reminder ({{reminder_type}}) from {{complex}}. Sign in or finish your invitation to use the cabinet.',
      }),
      cta: t(locale, { bg: 'Към кабинета', ru: 'В кабинет', en: 'Open cabinet' }),
      footer: footer(locale),
    };
  }

  if (key.startsWith('ownership_change') || key.includes('xfer') || key.includes('transfer')) {
    return {
      subject: t(locale, {
        bg: '{{complex}}: промяна на собственост',
        ru: '{{complex}}: смена собственности',
        en: '{{complex}}: ownership change',
      }),
      greeting: greeting(locale),
      body: t(locale, {
        bg: 'Известие за промяна на собственост ({{event_kind}}) в {{complex}}. Проверете детайлите в кабинета.',
        ru: 'Уведомление о смене собственности ({{event_kind}}) в {{complex}}. Подробности — в кабинете.',
        en: 'Ownership change notice ({{event_kind}}) at {{complex}}. See details in your cabinet.',
      }),
      cta: t(locale, { bg: 'Отвори кабинета', ru: 'Открыть кабинет', en: 'Open cabinet' }),
      footer: footer(locale),
    };
  }

  if (key.startsWith('meters_') || key.startsWith('support_fee_') || key.startsWith('capital_repair_')) {
    const isPay = key.includes('payment');
    return {
      subject: t(locale, {
        bg: isPay ? '{{complex}}: плащане' : '{{complex}}: финансово известие',
        ru: isPay ? '{{complex}}: платёж' : '{{complex}}: финансовое уведомление',
        en: isPay ? '{{complex}}: payment' : '{{complex}}: financial notice',
      }),
      greeting: greeting(locale),
      body: t(locale, {
        bg: isPay
          ? 'Регистрирано е плащане по вашия апартамент в {{complex}} ({{amount}}, {{period}}). Детайлите са в кабинета. Това не е напомняне за дълг.'
          : 'Има промяна по финансов запис за вашия апартамент в {{complex}} ({{period}}). Проверете кабинета. Това не е напомняне за дълг.',
        ru: isPay
          ? 'Зафиксирован платёж по вашей квартире в {{complex}} ({{amount}}, {{period}}). Подробности в кабинете. Это не напоминание о долге.'
          : 'Изменение финансового записи по вашей квартире в {{complex}} ({{period}}). Проверьте кабинет. Это не напоминание о долге.',
        en: isPay
          ? 'A payment was recorded for your apartment at {{complex}} ({{amount}}, {{period}}). See details in your cabinet. This is not a debt reminder.'
          : 'A financial record changed for your apartment at {{complex}} ({{period}}). Check your cabinet. This is not a debt reminder.',
      }),
      cta: t(locale, { bg: 'Към кабинета', ru: 'В кабинет', en: 'Open cabinet' }),
      footer: footer(locale),
    };
  }

  if (key === 'ticket_new_message') {
    return {
      subject: t(locale, {
        bg: '{{complex}}: ново съобщение',
        ru: '{{complex}}: новое сообщение',
        en: '{{complex}}: new message',
      }),
      greeting: greeting(locale),
      body: t(locale, {
        bg: 'Има ново съобщение в чата по вашия апартамент в {{complex}}. Отворете кабинета, за да го прочетете. Съдържанието не се изпраща по имейл.',
        ru: 'В чате по вашей квартире в {{complex}} есть новое сообщение. Откройте кабинет, чтобы прочитать. Текст сообщения в письме не передаётся.',
        en: 'There is a new message in your apartment chat at {{complex}}. Open the cabinet to read it. Message content is not included in this email.',
      }),
      cta: t(locale, { bg: 'Към чата', ru: 'К чату', en: 'Open chat' }),
      footer: footer(locale),
    };
  }

  if (key.startsWith('ticket_')) {
    return {
      subject: t(locale, {
        bg: '{{complex}}: заявка',
        ru: '{{complex}}: заявка',
        en: '{{complex}}: ticket',
      }),
      greeting: greeting(locale),
      body: t(locale, {
        bg: 'Статусът на вашата заявка е обновен ({{event_kind}}). Подробности в кабинета.',
        ru: 'Статус вашей заявки обновлён ({{event_kind}}). Подробности в кабинете.',
        en: 'Your ticket status was updated ({{event_kind}}). See details in your cabinet.',
      }),
      cta: t(locale, { bg: 'Към кабинета', ru: 'В кабинет', en: 'Open cabinet' }),
      footer: footer(locale),
    };
  }

  if (key.startsWith('cleaning_')) {
    return {
      subject: t(locale, {
        bg: '{{complex}}: промяна в графика за почистване',
        ru: '{{complex}}: изменение графика уборки',
        en: '{{complex}}: cleaning schedule change',
      }),
      greeting: greeting(locale),
      body: t(locale, {
        bg: 'Графикът или назначението на вашата задача за почистване е променено ({{schedule_hint}}). Отворете кабинета за детайли.',
        ru: 'График или назначение вашей задачи по уборке изменено ({{schedule_hint}}). Подробности — в кабинете.',
        en: 'Your cleaning task schedule or assignment changed ({{schedule_hint}}). See details in your cabinet.',
      }),
      cta: t(locale, { bg: 'Към задачите', ru: 'К задачам', en: 'Open tasks' }),
      footer: footer(locale),
    };
  }

  if (
    key.startsWith('residence_') ||
    key.startsWith('internet_') ||
    key.startsWith('uk_') ||
    key.startsWith('inventory_')
  ) {
    return {
      subject: t(locale, {
        bg: '{{complex}}: известие',
        ru: '{{complex}}: уведомление',
        en: '{{complex}}: notice',
      }),
      greeting: greeting(locale),
      body: t(locale, {
        bg: 'Служебно известие от {{complex}}. Отворете кабинета за подробности.',
        ru: 'Служебное уведомление от {{complex}}. Откройте кабинет для подробностей.',
        en: 'Service notice from {{complex}}. Open your cabinet for details.',
      }),
      cta: t(locale, { bg: 'Отвори', ru: 'Открыть', en: 'Open' }),
      footer: footer(locale),
    };
  }

  if (key === 'email_digest_daily' || key.startsWith('email_digest')) {
    return {
      subject: t(locale, {
        bg: '{{complex}}: дневен преглед',
        ru: '{{complex}}: дневная сводка',
        en: '{{complex}}: daily digest',
      }),
      greeting: greeting(locale),
      body: t(locale, {
        bg: 'Обобщение на информационни известия от {{complex}} за деня. Отворете кабинета за детайли.',
        ru: 'Сводка информационных уведомлений комплекса {{complex}} за день. Подробности — в кабинете.',
        en: 'A summary of informational notices from {{complex}} for the day. Open your cabinet for details.',
      }),
      cta: t(locale, { bg: 'Към кабинета', ru: 'В кабинет', en: 'Open cabinet' }),
      footer: footer(locale),
    };
  }

  if (key.startsWith('meeting_')) {
    return {
      subject: t(locale, {
        bg: '{{complex}}: събрание (информационно)',
        ru: '{{complex}}: собрание (информационно)',
        en: '{{complex}}: meeting (informational)',
      }),
      greeting: greeting(locale),
      body: t(locale, {
        bg: 'Информационно известие за събрание в {{complex}}. Това не замества законовите процедури по ЗУЕС. Подробностите са в кабинета.',
        ru: 'Информационное уведомление о собрании в {{complex}}. Это не заменяет предусмотренные законом процедуры. Подробности в кабинете.',
        en: 'Informational meeting notice for {{complex}}. This does not replace legally required procedures. Details are in your cabinet.',
      }),
      cta: t(locale, { bg: 'Към кабинета', ru: 'В кабинет', en: 'Open cabinet' }),
      footer: footer(locale),
    };
  }

  if (key === 'email_test' || key.startsWith('email_test')) {
    return {
      subject: t(locale, {
        bg: '{{complex}}: тестов имейл',
        ru: '{{complex}}: тестовое письмо',
        en: '{{complex}}: test email',
      }),
      greeting: greeting(locale),
      body: t(locale, {
        bg: 'Това е контролиран тестов имейл от Email Core на {{complex}}. Ако го виждате, доставката през пощенския доставчик работи.',
        ru: 'Это контролируемое тестовое письмо Email Core комплекса {{complex}}. Если оно дошло, доставка через почтового провайдера работает.',
        en: 'This is a controlled Email Core test message from {{complex}}. Receiving it means provider delivery works.',
      }),
      cta: t(locale, { bg: 'Към админ', ru: 'В админку', en: 'Open admin' }),
      footer: footer(locale),
    };
  }

  return {
    subject: t(locale, {
      bg: '{{complex}}: известие',
      ru: '{{complex}}: уведомление',
      en: '{{complex}}: notice',
    }),
    greeting: greeting(locale),
    body: t(locale, {
      bg: 'Известие от {{complex}}. Отворете кабинета за подробности.',
      ru: 'Уведомление от {{complex}}. Откройте кабинет для подробностей.',
      en: 'Notification from {{complex}}. Open your account for details.',
    }),
    cta: t(locale, { bg: 'Отвори', ru: 'Открыть', en: 'Open' }),
    footer: footer(locale),
  };
}

function t(locale: EmailTemplateLocale, pack: Record<EmailTemplateLocale, string>) {
  return pack[locale] ?? pack.bg;
}

function defaultComplexLabel(locale: EmailTemplateLocale) {
  return t(locale, {
    bg: 'Вашият комплекс',
    ru: 'Ваш комплекс',
    en: 'Your complex',
  });
}

function greeting(locale: EmailTemplateLocale) {
  return t(locale, { bg: 'Здравейте,', ru: 'Здравствуйте,', en: 'Hello,' });
}

function footer(locale: EmailTemplateLocale) {
  return t(locale, {
    bg: 'Това е служебно съобщение. Моля, не отговаряйте.',
    ru: 'Это служебное сообщение. Отвечать на него не нужно.',
    en: 'This is a transactional message. Please do not reply.',
  });
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function uniq(xs: string[]) {
  return [...new Set(xs)];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

/** Sanitize admin-entered plain text (no HTML/JS). */
export function sanitizeTemplatePlainText(raw: string, maxLen = 8000): string {
  let s = String(raw ?? '');
  // Strip tags and script-like sequences; keep as plain text.
  s = s.replace(/<\s*script[\s\S]*?>[\s\S]*?<\s*\/\s*script\s*>/gi, '');
  s = s.replace(/<[^>]*>/g, '');
  s = s.replace(/javascript:/gi, '');
  s = s.replace(/\u0000/g, '');
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}
