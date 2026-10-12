import type { EmailTemplateLocale } from '@/lib/emailCore';

type Locale = EmailTemplateLocale | string;

export function renderTransactionalEmail(opts: {
  templateKey: string;
  locale: Locale;
  subject?: string | null;
  payload?: Record<string, unknown> | null;
  complexName?: string | null;
}): { subject: string; html: string } {
  const locale: EmailTemplateLocale = ['bg', 'ru', 'en'].includes(opts.locale)
    ? (opts.locale as EmailTemplateLocale)
    : 'bg';
  const complex = (opts.complexName ?? '').trim() || defaultComplexLabel(locale);
  const payload = opts.payload ?? {};
  const inviteLink = str(payload.invite_link ?? payload.inviteLink);
  const apartment = str(payload.apartment ?? payload.apartment_number);
  const eventKind = str(payload.event_kind ?? payload.eventKind);
  const reminderType = str(payload.reminderType ?? payload.reminder_type);

  const pack = resolveTemplate(opts.templateKey, locale, {
    complex,
    inviteLink,
    apartment,
    eventKind,
    reminderType,
  });

  const subject = (opts.subject ?? '').trim() || pack.subject;
  const cta =
    inviteLink.length > 0
      ? `<p style="margin:20px 0;"><a href="${escapeAttr(inviteLink)}" style="display:inline-block;background:#0f3d4c;color:#fff;text-decoration:none;padding:10px 16px;border-radius:999px;font-weight:600;">${escapeHtml(pack.cta)}</a></p>
  <p style="color:#667085;font-size:12px;word-break:break-all;">${escapeHtml(inviteLink)}</p>`
      : '';

  const html = `<!doctype html>
<html lang="${locale}">
<body style="font-family: Georgia, 'Times New Roman', serif; line-height: 1.55; color: #14202a; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p style="font-size:15px;">${escapeHtml(pack.greeting)}</p>
  <p style="font-size:15px;">${escapeHtml(pack.body)}</p>
  ${cta}
  <p style="color:#667085;font-size:12px;margin-top:28px;">${escapeHtml(pack.footer)}</p>
</body>
</html>`;

  return { subject, html };
}

function resolveTemplate(
  templateKey: string,
  locale: EmailTemplateLocale,
  ctx: {
    complex: string;
    inviteLink: string;
    apartment: string;
    eventKind: string;
    reminderType: string;
  }
): { subject: string; greeting: string; body: string; cta: string; footer: string } {
  const key = templateKey.trim().toLowerCase();
  const apt = ctx.apartment || '—';

  if (key === 'pb1_property_invite' || key.startsWith('pb1_')) {
    return {
      subject: t(locale, {
        bg: `${ctx.complex}: покана в кабинета`,
        ru: `${ctx.complex}: приглашение в кабинет`,
        en: `${ctx.complex}: cabinet invitation`,
      }),
      greeting: greeting(locale),
      body: t(locale, {
        bg: `Получихте покана за достъп до апартамент ${apt} в ${ctx.complex}. Отворете връзката, задайте парола и потвърдете имейла.`,
        ru: `Вас пригласили к доступу в апартамент ${apt} комплекса ${ctx.complex}. Откройте ссылку, задайте пароль и подтвердите email.`,
        en: `You are invited to access apartment ${apt} at ${ctx.complex}. Open the link, set a password, and confirm your email.`,
      }),
      cta: t(locale, { bg: 'Отвори поканата', ru: 'Открыть приглашение', en: 'Open invitation' }),
      footer: footer(locale),
    };
  }

  if (key.startsWith('ua_') || key.includes('activation')) {
    const kind = ctx.reminderType || key.replace(/^ua_/, '');
    return {
      subject: t(locale, {
        bg: `${ctx.complex}: активирайте кабинета`,
        ru: `${ctx.complex}: активируйте кабинет`,
        en: `${ctx.complex}: activate your cabinet`,
      }),
      greeting: greeting(locale),
      body: t(locale, {
        bg: `Напомняне (${kind}) от ${ctx.complex}. Влезте в кабинета или завършете поканата, за да ползвате услугите.`,
        ru: `Напоминание (${kind}) от ${ctx.complex}. Войдите в кабинет или завершите приглашение, чтобы пользоваться сервисом.`,
        en: `Reminder (${kind}) from ${ctx.complex}. Sign in or finish your invitation to use the cabinet.`,
      }),
      cta: t(locale, { bg: 'Към кабинета', ru: 'В кабинет', en: 'Open cabinet' }),
      footer: footer(locale),
    };
  }

  if (key.startsWith('ownership_change') || key.includes('xfer') || key.includes('transfer')) {
    const event = ctx.eventKind || templateKey;
    return {
      subject: t(locale, {
        bg: `${ctx.complex}: промяна на собственост`,
        ru: `${ctx.complex}: смена собственности`,
        en: `${ctx.complex}: ownership change`,
      }),
      greeting: greeting(locale),
      body: t(locale, {
        bg: `Известие за промяна на собственост (${event}) в ${ctx.complex}. Проверете детайлите в кабинета.`,
        ru: `Уведомление о смене собственности (${event}) в ${ctx.complex}. Подробности — в кабинете.`,
        en: `Ownership change notice (${event}) at ${ctx.complex}. See details in your cabinet.`,
      }),
      cta: t(locale, { bg: 'Отвори кабинета', ru: 'Открыть кабинет', en: 'Open cabinet' }),
      footer: footer(locale),
    };
  }

  if (key.startsWith('meeting_')) {
    return {
      subject: t(locale, {
        bg: `${ctx.complex}: събрание`,
        ru: `${ctx.complex}: собрание`,
        en: `${ctx.complex}: meeting`,
      }),
      greeting: greeting(locale),
      body: t(locale, {
        bg: `Информация за събрание от ${ctx.complex}. Подробностите са в кабинета.`,
        ru: `Информация о собрании от ${ctx.complex}. Подробности в кабинете.`,
        en: `Meeting information from ${ctx.complex}. Details are in your cabinet.`,
      }),
      cta: t(locale, { bg: 'Към кабинета', ru: 'В кабинет', en: 'Open cabinet' }),
      footer: footer(locale),
    };
  }

  if (key === 'email_test' || key.startsWith('email_test')) {
    return {
      subject: t(locale, {
        bg: `${ctx.complex}: тестов имейл`,
        ru: `${ctx.complex}: тестовое письмо`,
        en: `${ctx.complex}: test email`,
      }),
      greeting: greeting(locale),
      body: t(locale, {
        bg: `Това е контролиран тестов имейл от Email Core на ${ctx.complex}. Ако го виждате, доставката през Resend работи.`,
        ru: `Это контролируемое тестовое письмо Email Core комплекса ${ctx.complex}. Если оно дошло, доставка через Resend работает.`,
        en: `This is a controlled Email Core test message from ${ctx.complex}. Receiving it means Resend delivery works.`,
      }),
      cta: t(locale, { bg: 'Към админ', ru: 'В админку', en: 'Open admin' }),
      footer: footer(locale),
    };
  }

  return {
    subject: `${ctx.complex}: ${templateKey}`,
    greeting: greeting(locale),
    body: t(locale, {
      bg: `Известие «${templateKey}» от ${ctx.complex}. Отворете кабинета за подробности.`,
      ru: `Уведомление «${templateKey}» от ${ctx.complex}. Откройте кабинет для подробностей.`,
      en: `Notification “${templateKey}” from ${ctx.complex}. Open your account for details.`,
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
