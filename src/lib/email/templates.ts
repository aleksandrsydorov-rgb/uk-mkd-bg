import type { EmailTemplateLocale } from '@/lib/emailCore';

export function renderTransactionalEmail(opts: {
  templateKey: string;
  locale: EmailTemplateLocale | string;
  subject?: string | null;
  payload?: Record<string, unknown> | null;
  complexName?: string | null;
}): { subject: string; html: string } {
  const locale = ['bg', 'ru', 'en'].includes(opts.locale) ? opts.locale : 'bg';
  const complex = (opts.complexName ?? '').trim() || defaultComplexLabel(locale);
  const event = String(opts.payload?.event_kind ?? opts.templateKey);

  const subject =
    (opts.subject ?? '').trim() ||
    subjectFor(locale, opts.templateKey, complex);

  const html = `<!doctype html>
<html lang="${locale}">
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #14202a;">
  <p>${greeting(locale)}</p>
  <p>${bodyLine(locale, event, complex)}</p>
  <p style="color:#667085;font-size:12px;">${footer(locale)}</p>
</body>
</html>`;

  return { subject, html };
}

function defaultComplexLabel(locale: string) {
  if (locale === 'ru') return 'Ваш комплекс';
  if (locale === 'en') return 'Your complex';
  return 'Вашият комплекс';
}

function greeting(locale: string) {
  if (locale === 'ru') return 'Здравствуйте,';
  if (locale === 'en') return 'Hello,';
  return 'Здравейте,';
}

function bodyLine(locale: string, event: string, complex: string) {
  if (locale === 'ru') {
    return `Уведомление «${escapeHtml(event)}» от ${escapeHtml(complex)}. Откройте кабинет для подробностей.`;
  }
  if (locale === 'en') {
    return `Notification “${escapeHtml(event)}” from ${escapeHtml(complex)}. Open your account for details.`;
  }
  return `Известие «${escapeHtml(event)}» от ${escapeHtml(complex)}. Отворете кабинета за подробности.`;
}

function footer(locale: string) {
  if (locale === 'ru') return 'Это служебное сообщение. Отвечать на него не нужно.';
  if (locale === 'en') return 'This is a transactional message. Please do not reply.';
  return 'Това е служебно съобщение. Моля, не отговаряйте.';
}

function subjectFor(locale: string, templateKey: string, complex: string) {
  if (locale === 'ru') return `${complex}: ${templateKey}`;
  if (locale === 'en') return `${complex}: ${templateKey}`;
  return `${complex}: ${templateKey}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
