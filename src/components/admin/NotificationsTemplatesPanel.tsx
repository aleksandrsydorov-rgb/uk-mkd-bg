'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import {
  AdminCard,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminDangerButton,
  adminBtnSecondaryClass,
  adminFieldClass,
} from '@/components/admin/AdminUi';
import { EMAIL_OUTBOUND_LOCALE } from '@/lib/emailCore';

type TemplateListItem = {
  template_key: string;
  label_key: string;
  is_custom: boolean;
  variables: { id: string; label_key: string; required_when_used: boolean }[];
};

type Parts = {
  subject: string;
  greeting: string;
  body: string;
  cta: string;
  footer: string;
};

type Props = {
  canManage: boolean;
  dirty: boolean;
  onDirtyChange: (dirty: boolean) => void;
};

function partsEqual(a: Parts | null, b: Parts | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.subject === b.subject &&
    a.greeting === b.greeting &&
    a.body === b.body &&
    a.cta === b.cta &&
    a.footer === b.footer
  );
}

export function NotificationsTemplatesPanel({ canManage, dirty, onDirtyChange }: Props) {
  const { t, locale } = useI18n();
  const [catalog, setCatalog] = useState<TemplateListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [parts, setParts] = useState<Parts | null>(null);
  const [savedParts, setSavedParts] = useState<Parts | null>(null);
  const [variables, setVariables] = useState<TemplateListItem['variables']>([]);
  const [meta, setMeta] = useState<{ updated_at?: string | null; updated_by_email?: string | null }>(
    {}
  );
  const [saving, setSaving] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewSubject, setPreviewSubject] = useState<string | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  /** Monotonic load token — ignore stale responses after fast type switches. */
  const loadSeqRef = useRef(0);
  const activeKeyRef = useRef('');

  const editorDirty = useMemo(() => {
    if (!parts || !savedParts) return false;
    return !partsEqual(parts, savedParts);
  }, [parts, savedParts]);

  // Sync computed dirty to parent after commit — never from setState updaters / render.
  useEffect(() => {
    onDirtyChange(editorDirty);
  }, [editorDirty, onDirtyChange]);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/email/templates');
      const json = (await res.json()) as {
        ok?: boolean;
        templates?: TemplateListItem[];
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'load_failed');
      const list = json.templates ?? [];
      setCatalog(list);
      setTemplateKey((prev) => prev || list[0]?.template_key || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load_failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOne = useCallback(async (key: string) => {
    if (!key) return;
    const seq = ++loadSeqRef.current;
    activeKeyRef.current = key;
    setError(null);
    setPreviewHtml(null);
    setPreviewSubject(null);
    setBanner(null);
    try {
      const res = await fetch(
        `/api/email/templates?template_key=${encodeURIComponent(key)}&locale=${EMAIL_OUTBOUND_LOCALE}`
      );
      const json = (await res.json()) as {
        ok?: boolean;
        is_custom?: boolean;
        effective?: Parts;
        variables?: TemplateListItem['variables'];
        updated_at?: string | null;
        updated_by_email?: string | null;
        error?: string;
      };
      // Stale: a newer loadOne started, or the selected key already moved on.
      if (seq !== loadSeqRef.current || activeKeyRef.current !== key) return;
      if (!res.ok || !json.ok || !json.effective) throw new Error(json.error ?? 'load_failed');
      setIsCustom(Boolean(json.is_custom));
      setParts(json.effective);
      setSavedParts(json.effective);
      setVariables(json.variables ?? []);
      setMeta({
        updated_at: json.updated_at ?? null,
        updated_by_email: json.updated_by_email ?? null,
      });
    } catch (e) {
      if (seq !== loadSeqRef.current || activeKeyRef.current !== key) return;
      setError(e instanceof Error ? e.message : 'load_failed');
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!templateKey) return;
    void loadOne(templateKey);
  }, [templateKey, loadOne]);

  const markField = useCallback((field: keyof Parts, value: string) => {
    // Pure state update only — dirty is derived from parts vs savedParts.
    setParts((prev) => (prev ? { ...prev, [field]: value } : prev));
  }, []);

  const insertVar = useCallback(
    (id: string) => {
      if (!parts) return;
      const token = `{{${id}}}`;
      const spacer = parts.body.endsWith(' ') || !parts.body ? '' : ' ';
      markField('body', `${parts.body}${spacer}${token}`);
    },
    [markField, parts]
  );

  const selectedLabel = useMemo(() => {
    const item = catalog.find((c) => c.template_key === templateKey);
    if (!item) return templateKey;
    const label = t(item.label_key);
    return label === item.label_key ? templateKey : label;
  }, [catalog, t, templateKey]);

  const onCancel = () => {
    if (!savedParts) return;
    if (editorDirty && !window.confirm(t('common.discardChangesBody'))) return;
    setParts(savedParts);
    setPreviewHtml(null);
    setBanner(null);
  };

  const onSave = async () => {
    if (!canManage || !parts || !templateKey) return;
    setSaving(true);
    setBanner(null);
    setError(null);
    const snapshot = parts;
    try {
      const res = await fetch('/api/email/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          template_key: templateKey,
          locale: EMAIL_OUTBOUND_LOCALE,
          ...snapshot,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; unknown_variables?: string[] };
      if (!res.ok || !json.ok) {
        if (json.unknown_variables?.length) {
          throw new Error(`${t('admin.tplUnknownVars')}: ${json.unknown_variables.join(', ')}`);
        }
        throw new Error(json.error ?? 'save_failed');
      }
      // Keep typed values; baseline catches up so editorDirty → false.
      setSavedParts(snapshot);
      setIsCustom(true);
      setBanner(t('admin.tplSaved'));
      await loadCatalog();
    } catch (e) {
      // Preserve user input on failure (parts unchanged).
      setError(e instanceof Error ? e.message : 'save_failed');
    } finally {
      setSaving(false);
    }
  };

  const onRestore = async () => {
    if (!canManage || !templateKey) return;
    if (!window.confirm(t('admin.tplRestoreConfirm'))) return;
    if (editorDirty && !window.confirm(t('common.discardChangesBody'))) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/email/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'restore',
          template_key: templateKey,
          locale: EMAIL_OUTBOUND_LOCALE,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'restore_failed');
      setBanner(t('admin.tplRestored'));
      await loadOne(templateKey);
      await loadCatalog();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'restore_failed');
    } finally {
      setSaving(false);
    }
  };

  const onPreview = async () => {
    if (!parts || !templateKey) return;
    setError(null);
    try {
      const res = await fetch('/api/email/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'preview',
          template_key: templateKey,
          locale: EMAIL_OUTBOUND_LOCALE,
          ...parts,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        preview?: { subject: string; html: string };
        error?: string;
        unknown_variables?: string[];
        unresolved?: string[];
        missing_required?: string[];
        validation_reason?: string | null;
      };
      if (json.preview) {
        setPreviewSubject(json.preview.subject);
        setPreviewHtml(json.preview.html);
        setPreviewNote(t('admin.tplPreviewDemoNote'));
      }
      if (!res.ok || !json.ok) {
        const bits = [
          json.error,
          json.unknown_variables?.length
            ? `${t('admin.tplUnknownVars')}: ${json.unknown_variables.join(', ')}`
            : null,
          json.unresolved?.length
            ? `${t('admin.tplUnresolvedVars')}: ${json.unresolved.join(', ')}`
            : null,
          json.missing_required?.length
            ? `${t('admin.tplMissingRequired')}: ${json.missing_required.join(', ')}`
            : null,
          json.validation_reason,
        ].filter(Boolean);
        setError(bits.join(' · ') || 'preview_failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'preview_failed');
    }
  };

  const requestTemplateChange = (next: string) => {
    if (next === templateKey) return;
    if (editorDirty && !window.confirm(t('common.discardChangesBody'))) return;
    // Invalidate in-flight loads for the previous key immediately.
    loadSeqRef.current += 1;
    activeKeyRef.current = next;
    setTemplateKey(next);
  };

  return (
    <div className="space-y-4">
      <AdminCard>
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-[var(--admin-ink)]">{t('admin.tplTitle')}</h2>
          <p className="text-sm text-[var(--admin-muted)]">{t('admin.tplLead')}</p>
          <p className="text-xs text-[var(--admin-muted)]">{t('admin.tplApplyMoment')}</p>
          {loading ? <p className="text-sm text-[var(--admin-muted)]">{t('common.loading')}</p> : null}
          {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
          {banner ? <AdminInlineAlert tone="success">{banner}</AdminInlineAlert> : null}

          <label className="block text-sm sm:max-w-md">
            <span className="mb-1 block text-[var(--admin-muted)]">{t('admin.tplSelectType')}</span>
            <select
              className={adminFieldClass}
              value={templateKey}
              disabled={!canManage && catalog.length === 0}
              onChange={(e) => requestTemplateChange(e.target.value)}
            >
              {catalog.map((c) => {
                const label = t(c.label_key);
                const title = label === c.label_key ? c.template_key : label;
                return (
                  <option key={c.template_key} value={c.template_key}>
                    {title}
                    {c.is_custom ? ` · ${t('admin.tplBadgeCustom')}` : ''}
                  </option>
                );
              })}
            </select>
          </label>
          <p className="text-xs text-[var(--admin-muted)]">{t('admin.tplOutboundLocaleNote')}</p>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded border border-[var(--admin-border)] px-2 py-0.5">
              {isCustom ? t('admin.tplBadgeCustom') : t('admin.tplBadgeBuiltin')}
            </span>
            <span className="text-[var(--admin-muted)]">{selectedLabel}</span>
            {meta.updated_at ? (
              <span className="text-xs text-[var(--admin-muted)]">
                {t('admin.tplUpdatedMeta', {
                  when: formatWhen(meta.updated_at, locale),
                  who: meta.updated_by_email || '—',
                })}
              </span>
            ) : null}
            {dirty ? (
              <span className="text-xs font-medium text-amber-800">{t('admin.tplUnsaved')}</span>
            ) : null}
          </div>
        </div>
      </AdminCard>

      {parts ? (
        <AdminCard>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {variables.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={adminBtnSecondaryClass}
                  disabled={!canManage}
                  onClick={() => insertVar(v.id)}
                  title={`{{${v.id}}}`}
                >
                  {t(v.label_key)}
                  {v.required_when_used ? ' *' : ''}
                </button>
              ))}
            </div>
            <p className="text-xs text-[var(--admin-muted)]">{t('admin.tplVarsHint')}</p>

            <label className="block text-sm">
              <span className="mb-1 block">{t('admin.tplSubject')}</span>
              <input
                className={adminFieldClass}
                value={parts.subject}
                disabled={!canManage}
                onChange={(e) => markField('subject', e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block">{t('admin.tplGreeting')}</span>
              <input
                className={adminFieldClass}
                value={parts.greeting}
                disabled={!canManage}
                onChange={(e) => markField('greeting', e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block">{t('admin.tplBody')}</span>
              <textarea
                className={adminFieldClass}
                rows={6}
                value={parts.body}
                disabled={!canManage}
                onChange={(e) => markField('body', e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block">{t('admin.tplCta')}</span>
              <input
                className={adminFieldClass}
                value={parts.cta}
                disabled={!canManage}
                onChange={(e) => markField('cta', e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block">{t('admin.tplFooter')}</span>
              <textarea
                className={adminFieldClass}
                rows={2}
                value={parts.footer}
                disabled={!canManage}
                onChange={(e) => markField('footer', e.target.value)}
              />
            </label>

            <div className="flex flex-wrap gap-2 pt-1">
              <AdminPrimaryButton
                disabled={!canManage || saving || !editorDirty}
                onClick={() => void onSave()}
              >
                {t('common.save')}
              </AdminPrimaryButton>
              <button
                type="button"
                className={adminBtnSecondaryClass}
                disabled={!canManage || saving || !editorDirty}
                onClick={onCancel}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={adminBtnSecondaryClass}
                disabled={!canManage || saving}
                onClick={() => void onPreview()}
              >
                {t('admin.tplPreview')}
              </button>
              <AdminDangerButton
                disabled={!canManage || saving || (!isCustom && !editorDirty)}
                onClick={() => void onRestore()}
              >
                {t('admin.tplRestore')}
              </AdminDangerButton>
            </div>
          </div>
        </AdminCard>
      ) : null}

      {previewHtml ? (
        <AdminCard>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t('admin.tplPreview')}</h3>
            {previewNote ? (
              <p className="text-xs text-[var(--admin-muted)]">{previewNote}</p>
            ) : null}
            {previewSubject ? (
              <p className="text-sm">
                <span className="text-[var(--admin-muted)]">{t('admin.tplSubject')}: </span>
                {previewSubject}
              </p>
            ) : null}
            <iframe
              title={t('admin.tplPreview')}
              sandbox=""
              className="h-[320px] w-full rounded border border-[var(--admin-border)] bg-white"
              srcDoc={previewHtml}
            />
          </div>
        </AdminCard>
      ) : null}
    </div>
  );
}

function formatWhen(iso: string, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : locale === 'en' ? 'en-GB' : 'ru-RU', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
