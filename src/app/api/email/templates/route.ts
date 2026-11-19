import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { EMAIL_EVENT_CATALOG } from '@/lib/email/eventCatalog';
import {
  getBuiltinTemplateParts,
  previewTransactionalEmail,
  sanitizeTemplatePlainText,
  validateRenderedTemplate,
  type EmailTemplateParts,
} from '@/lib/email/templates';
import {
  findTemplateVariables,
  listEditableTemplateKeys,
  variablesForTemplate,
} from '@/lib/email/templateVariables';
import { EMAIL_OUTBOUND_LOCALE } from '@/lib/emailCore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Locale = 'bg' | 'ru' | 'en';

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return { ok: false as const, status: 401 as const, error: 'unauthorized' };
  }
  const { data: isAdmin, error: roleErr } = await supabase.rpc('has_staff_role' as never, {
    p_role: 'администрация',
  } as never);
  if (roleErr || isAdmin !== true) {
    return { ok: false as const, status: 403 as const, error: 'forbidden' };
  }
  return { ok: true as const, supabase, user };
}

/** AMADEUS 11: template editor and overrides are Bulgarian-only. */
function asLocale(_raw?: unknown): Locale {
  return EMAIL_OUTBOUND_LOCALE;
}

function eventLabelKey(templateKey: string): string {
  const ev = EMAIL_EVENT_CATALOG.find((e) => e.templateKey === templateKey);
  return ev ? `notify.event.${ev.eventKey}` : `notify.event.${templateKey}`;
}

/**
 * GET ?template_key=&locale=  → one template (builtin + override)
 * GET (no key)               → catalog list + which keys are custom
 */
export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const templateKey = String(url.searchParams.get('template_key') ?? '').trim().toLowerCase();
  const locale = asLocale(url.searchParams.get('locale'));

  const editable = listEditableTemplateKeys();
  let customKeys: string[] = [];
  try {
    const { data } = await auth.supabase.rpc(
      'admin_list_email_template_override_keys' as never
    );
    if (Array.isArray(data)) customKeys = data.map((k) => String(k));
  } catch {
    customKeys = [];
  }

  if (!templateKey) {
    return NextResponse.json({
      ok: true,
      apply_moment: 'send_time',
      outbound_locale: EMAIL_OUTBOUND_LOCALE,
      auth_templates_editable: false,
      templates: editable.map((key) => ({
        template_key: key,
        label_key: eventLabelKey(key),
        is_custom: customKeys.includes(key),
        variables: variablesForTemplate(key).map((v) => ({
          id: v.id,
          label_key: v.labelKey,
          required_when_used: Boolean(v.requiredWhenUsed),
        })),
      })),
    });
  }

  if (!editable.includes(templateKey)) {
    return NextResponse.json({ ok: false, error: 'template_not_editable' }, { status: 400 });
  }

  const builtin = getBuiltinTemplateParts(templateKey, locale);
  let override: EmailTemplateParts | null = null;
  let meta: { updated_at?: string | null; updated_by_email?: string | null } = {};
  try {
    const { data } = await auth.supabase.rpc('admin_get_email_template_override' as never, {
      p_template_key: templateKey,
      p_locale: locale,
    } as never);
    const row = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    if (row.is_custom === true && row.override && typeof row.override === 'object') {
      const o = row.override as Record<string, unknown>;
      override = {
        subject: String(o.subject ?? ''),
        greeting: String(o.greeting ?? ''),
        body: String(o.body ?? ''),
        cta: String(o.cta ?? ''),
        footer: String(o.footer ?? ''),
      };
      meta = {
        updated_at: row.updated_at ? String(row.updated_at) : null,
        updated_by_email: row.updated_by_email ? String(row.updated_by_email) : null,
      };
    }
  } catch {
    override = null;
  }

  const effective = override ?? builtin;
  return NextResponse.json({
    ok: true,
    template_key: templateKey,
    locale,
    is_custom: Boolean(override),
    builtin,
    effective,
    ...meta,
    variables: variablesForTemplate(templateKey).map((v) => ({
      id: v.id,
      label_key: v.labelKey,
      required_when_used: Boolean(v.requiredWhenUsed),
    })),
    apply_moment: 'send_time',
  });
}

type Body = {
  action?: 'save' | 'restore' | 'preview';
  template_key?: string;
  locale?: string;
  subject?: string;
  greeting?: string;
  body?: string;
  cta?: string;
  footer?: string;
};

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const action = body.action === 'restore' || body.action === 'preview' ? body.action : 'save';
  const templateKey = String(body.template_key ?? '').trim().toLowerCase();
  const locale = asLocale(body.locale);
  const editable = listEditableTemplateKeys();

  if (!editable.includes(templateKey)) {
    return NextResponse.json({ ok: false, error: 'template_not_editable' }, { status: 400 });
  }

  if (action === 'restore') {
    const { data, error } = await auth.supabase.rpc(
      'admin_restore_email_template_override' as never,
      { p_template_key: templateKey, p_locale: locale } as never
    );
    if (error) {
      return NextResponse.json({ ok: false, error: 'restore_failed' }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      ...(typeof data === 'object' && data ? data : {}),
      // Restore does not send mail.
      sent: false,
    });
  }

  const parts: EmailTemplateParts = {
    subject: sanitizeTemplatePlainText(String(body.subject ?? ''), 500),
    greeting: sanitizeTemplatePlainText(String(body.greeting ?? ''), 2000),
    body: sanitizeTemplatePlainText(String(body.body ?? ''), 8000),
    cta: sanitizeTemplatePlainText(String(body.cta ?? ''), 200),
    footer: sanitizeTemplatePlainText(String(body.footer ?? ''), 2000),
  };

  const allowed = new Set(variablesForTemplate(templateKey).map((v) => v.id));
  allowed.add('complex');
  const used = findTemplateVariables(
    [parts.subject, parts.greeting, parts.body, parts.cta, parts.footer].join('\n')
  );
  const unknown = used.filter((id) => !allowed.has(id as never));

  if (action === 'preview') {
    let complexName = 'AMADEUS XI (пример)';
    try {
      const admin = createServiceRoleClient();
      const nameRes = await admin.rpc('admin_get_complex_display_name' as never);
      if (typeof nameRes.data === 'string' && nameRes.data.trim()) {
        complexName = `${nameRes.data.trim()} (пример)`;
      }
    } catch {
      /* demo label */
    }
    const preview = previewTransactionalEmail({
      templateKey,
      locale,
      override: parts,
      complexName,
    });
    const validation = validateRenderedTemplate(preview);
    return NextResponse.json({
      ok: validation.ok && unknown.length === 0,
      demo: true,
      demo_notice: true,
      preview: {
        subject: preview.subject,
        html: preview.html,
        text: preview.text,
      },
      unknown_variables: unknown,
      unresolved: preview.unresolved,
      missing_required: preview.missingRequired,
      validation_reason: validation.reason ?? null,
      // Preview never sends.
      sent: false,
    });
  }

  // save
  if (unknown.length) {
    return NextResponse.json(
      { ok: false, error: 'unknown_variables', unknown_variables: unknown },
      { status: 400 }
    );
  }
  if (!parts.subject.trim() || !parts.body.trim()) {
    return NextResponse.json({ ok: false, error: 'subject_or_body_required' }, { status: 400 });
  }

  const { data, error } = await auth.supabase.rpc('admin_save_email_template_override' as never, {
    p_template_key: templateKey,
    p_locale: locale,
    p_subject: parts.subject,
    p_greeting: parts.greeting,
    p_body: parts.body,
    p_cta: parts.cta,
    p_footer: parts.footer,
  } as never);
  if (error) {
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    ...(typeof data === 'object' && data ? data : {}),
    locale,
    template_key: templateKey,
    // Saving a template never sends mail and does not rewrite the outbox.
    sent: false,
    apply_moment: 'send_time',
  });
}
