'use client';

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { formatOwnerDateTime } from '@/lib/ownerFormat';
import {
  announcementBodyPreview,
  announcementStatus,
  announcementStatusLabelKey,
  announcementStatusTone,
  validateAnnouncementInput,
} from '@/lib/announcementsUi';
import {
  AdminEmptyState,
  AdminPageHeader,
  AdminPrimaryButton,
  AdminSecondaryButton,
  StatusBadge,
  adminBtnDangerClass,
  adminBtnSecondaryClass,
  adminCardClass,
  adminFieldClass,
  adminFormPanelClass,
  adminModalHeaderClass,
  adminModalOverlayClass,
  adminModalPanelClass,
} from '@/components/admin/AdminUi';

type Announcement = Database['public']['Tables']['announcements']['Row'];

export function AdminAnnouncements({
  supabase,
  announcements,
  canManage,
  createNonce = 0,
  onChanged,
  onError,
}: {
  supabase: SupabaseClient<Database>;
  announcements: Announcement[];
  canManage: boolean;
  createNonce?: number;
  onChanged: () => Promise<void> | void;
  onError: (msg: string) => void;
}) {
  const { t, locale } = useI18n();
  const [detailId, setDetailId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', created_by: 'УК' });

  const selected = announcements.find((a) => a.id === detailId) ?? null;

  function openCreate() {
    setEditing(null);
    setForm({ title: '', body: '', created_by: 'УК' });
    setShowForm(true);
    setDetailId(null);
  }

  useEffect(() => {
    if (createNonce > 0 && canManage) openCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open only on external quick-action bump
  }, [createNonce]);

  function openEdit(row: Announcement) {
    setEditing(row);
    setForm({
      title: row.title ?? '',
      body: row.body ?? '',
      created_by: row.created_by ?? 'УК',
    });
    setShowForm(true);
    setDetailId(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) {
      onError(t('admin.errNoAccess'));
      return;
    }
    const check = validateAnnouncementInput(form);
    if (!check.ok) {
      onError(t(check.errorKey));
      return;
    }
    setBusy(true);
    try {
      const payload = {
        title: form.title.trim(),
        body: form.body.trim(),
        created_by: form.created_by.trim() || 'УК',
      };
      if (editing) {
        const { error } = await supabase.from('announcements').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('announcements').insert(payload);
        if (error) throw error;
      }
      setShowForm(false);
      setEditing(null);
      setForm({ title: '', body: '', created_by: 'УК' });
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : t('admin.annSaveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: number) {
    if (!canManage) {
      onError(t('admin.errNoAccess'));
      return;
    }
    if (!confirm(t('confirm.deleteAnn'))) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('announcements').delete().eq('id', id);
      if (error) throw error;
      setDetailId((cur) => (cur === id ? null : cur));
      await onChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : t('admin.annDeleteFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title={t('admin.announcements')}
        secondary={t('admin.announcementsLead')}
        action={
          canManage ? (
            <AdminPrimaryButton type="button" onClick={openCreate}>
              + {t('admin.annNew')}
            </AdminPrimaryButton>
          ) : undefined
        }
      />

      {showForm ? (
        <form onSubmit={(e) => void onSubmit(e)} className={adminFormPanelClass}>
          <h3 className="text-sm font-semibold text-foreground">
            {editing ? t('admin.annEdit') : t('admin.annNew')}
          </h3>
          <p className="text-xs text-muted">
            {editing ? t('admin.annEditHint') : t('admin.annPublishHint')}
          </p>
          <input
            className={adminFieldClass}
            placeholder={t('admin.annTitlePh')}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
          />
          <textarea
            className={adminFieldClass}
            placeholder={t('admin.annBodyPh')}
            rows={4}
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            required
          />
          <input
            className={adminFieldClass}
            placeholder={t('admin.annFromPh')}
            value={form.created_by}
            onChange={(e) => setForm({ ...form, created_by: e.target.value })}
          />
          <div className="flex flex-wrap gap-2">
            <AdminPrimaryButton type="submit" disabled={busy}>
              {busy
                ? t('common.saving')
                : editing
                  ? t('admin.annSave')
                  : t('admin.annPublish')}
            </AdminPrimaryButton>
            <AdminSecondaryButton
              type="button"
              disabled={busy}
              onClick={() => {
                setShowForm(false);
                setEditing(null);
              }}
            >
              {t('common.cancel')}
            </AdminSecondaryButton>
          </div>
        </form>
      ) : null}

      {announcements.length === 0 ? (
        <AdminEmptyState title={t('account.noAnnouncements')} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {announcements.map((a) => {
            const status = announcementStatus(a);
            const preview = announcementBodyPreview(a.body);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setDetailId(a.id)}
                className={`${adminCardClass} flex w-full flex-col gap-2 p-3 text-left transition hover:bg-hover/40`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 truncate text-sm font-semibold text-foreground">
                    {a.title?.trim() || t('admin.annUntitled')}
                  </div>
                  <StatusBadge
                    label={t(announcementStatusLabelKey(status))}
                    tone={announcementStatusTone(status)}
                  />
                </div>
                <div className="text-xs text-muted">{formatOwnerDateTime(a.created_at, locale)}</div>
                {preview ? (
                  <div className="line-clamp-2 text-xs text-secondary">{preview}</div>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {selected ? (
        <div className={adminModalOverlayClass} onClick={() => setDetailId(null)}>
          <div
            className={`${adminModalPanelClass} max-w-lg`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={adminModalHeaderClass}>
              <div className="min-w-0">
                <div className="mb-1">
                  <StatusBadge
                    label={t(announcementStatusLabelKey(announcementStatus(selected)))}
                    tone={announcementStatusTone(announcementStatus(selected))}
                  />
                </div>
                <h3 className="text-lg font-semibold text-foreground">
                  {selected.title?.trim() || t('admin.annUntitled')}
                </h3>
                <p className="mt-0.5 text-xs text-muted">
                  {selected.created_by
                    ? `${t('admin.annFrom', { name: selected.created_by })} · `
                    : ''}
                  {formatOwnerDateTime(selected.created_at, locale)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailId(null)}
                className={adminBtnSecondaryClass}
              >
                {t('common.close')}
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <p className="whitespace-pre-wrap text-sm text-secondary">{selected.body}</p>
              {canManage ? (
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  <AdminPrimaryButton
                    type="button"
                    disabled={busy}
                    onClick={() => openEdit(selected)}
                  >
                    {t('admin.annEdit')}
                  </AdminPrimaryButton>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onDelete(selected.id)}
                    className={adminBtnDangerClass}
                  >
                    {t('common.delete')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
