'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { Translate } from '@/i18n/translate';
import type { BuildingDocument, GeneralMeeting, MeetingFileLink, MeetingFileType } from '@/lib/buildingDocuments';
import { labelFileType } from '@/lib/buildingDocuments';
import {
  buildInvitationPostingProtocolHtml,
  parseInvitationDispatchReady,
  type InvitationDispatchReady,
} from '@/lib/meetingCore';
import { downloadHtmlAsPdf } from '@/lib/pdfDownload';
import {
  adminFieldClass,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
  StatusBadge,
} from '@/components/admin/AdminUi';
import { ownerVisibleError } from '@/lib/ownerError';

function MeetingFileSlotMini({
  type,
  label,
  links,
  docs,
  canWrite,
  busy,
  t,
  onUpload,
  onOpen,
}: {
  type: MeetingFileType;
  label: string;
  links: MeetingFileLink[];
  docs: BuildingDocument[];
  canWrite: boolean;
  busy: boolean;
  t: Translate;
  onUpload: () => void;
  onOpen: (doc: BuildingDocument | undefined) => void;
}) {
  return (
    <div className="rounded-[14px] border border-border bg-background px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {links.length > 0 ? <StatusBadge label={t('docs.inviteFileOk')} tone="success" /> : (
          <StatusBadge label={t('docs.inviteFileMissing')} tone="warning" />
        )}
      </div>
      {links.length === 0 ? (
        <p className="mt-1 text-xs text-muted">{t('docs.fileNotUploaded')}</p>
      ) : (
        links.map((link) => {
          const doc = docs.find((d) => d.id === link.document_id);
          return (
            <button
              key={link.id}
              type="button"
              className="mt-2 block text-left text-sm text-accent hover:underline"
              onClick={() => onOpen(doc)}
            >
              {link.title || doc?.title || labelFileType(type, t)}
            </button>
          );
        })
      )}
      {canWrite ? (
        <AdminSecondaryButton type="button" className="mt-2" disabled={busy} onClick={onUpload}>
          {links.length > 0 ? t('docs.inviteReplaceFile') : t('docs.inviteUploadFile')}
        </AdminSecondaryButton>
      ) : null}
    </div>
  );
}

export function AdminMeetingInvitationDispatch({
  supabase,
  meeting,
  files,
  docs,
  canWrite,
  busy,
  t,
  onUpload,
  onOpenDoc,
  onReload,
  onError,
}: {
  supabase: SupabaseClient<Database>;
  meeting: GeneralMeeting;
  files: MeetingFileLink[];
  docs: BuildingDocument[];
  canWrite: boolean;
  busy: boolean;
  t: Translate;
  onUpload: (type: MeetingFileType) => void;
  onOpenDoc: (doc: BuildingDocument | undefined) => void;
  onReload: () => void | Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [ready, setReady] = useState<InvitationDispatchReady | null>(null);
  const [postPlace, setPostPlace] = useState('Табло на входа');
  const [localBusy, setLocalBusy] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<string | null>(null);

  const locked = Boolean(meeting.invitation_locked_at);
  const meetingFiles = files.filter((f) => f.meeting_id === meeting.id);
  const protocolLinks = meetingFiles.filter((f) => f.file_type === 'invitation_posting_protocol');
  const photoLinks = meetingFiles.filter((f) => f.file_type === 'invitation_posting_photo');

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('gm_invitation_dispatch_ready', {
      p_meeting_id: meeting.id,
    });
    if (error) {
      onError(ownerVisibleError(error.message, t('admin.errGeneric')));
      return;
    }
    setReady(parseInvitationDispatchReady(data));
  }, [meeting.id, onError, supabase, t]);

  useEffect(() => {
    void refresh();
  }, [refresh, protocolLinks.length, photoLinks.length, meeting.invitation_posted_at]);

  async function generateProtocol() {
    setLocalBusy(true);
    onError(null);
    try {
      await downloadHtmlAsPdf(
        `protokol-pokana-${meeting.meeting_date || 'draft'}.pdf`,
        buildInvitationPostingProtocolHtml({
          title: meeting.title,
          meeting_date: meeting.meeting_date,
          meeting_time: meeting.meeting_time,
          location: meeting.location,
          posted_place: postPlace,
          is_urgent: meeting.is_urgent,
        }),
      );
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLocalBusy(false);
    }
  }

  async function confirmPosting() {
    setLocalBusy(true);
    onError(null);
    setDispatchResult(null);
    const { error } = await supabase.rpc('gm_confirm_invitation_posting', {
      p_meeting_id: meeting.id,
      p_posted_place: postPlace.trim(),
      p_posted_at: new Date().toISOString(),
    });
    setLocalBusy(false);
    if (error) {
      onError(ownerVisibleError(error.message, t('admin.errGeneric')));
      return;
    }
    await onReload();
    await refresh();
  }

  async function dispatchAll() {
    setLocalBusy(true);
    onError(null);
    setDispatchResult(null);
    const { data, error } = await supabase.rpc('gm_dispatch_meeting_invitations', {
      p_meeting_id: meeting.id,
    });
    setLocalBusy(false);
    if (error) {
      onError(ownerVisibleError(error.message, t('admin.errGeneric')));
      return;
    }
    const row = (data ?? {}) as { sent?: number; skipped?: number; already_sent?: boolean };
    if (row.already_sent) {
      setDispatchResult(t('docs.inviteAlreadySent', { n: String(row.sent ?? 0) }));
    } else {
      setDispatchResult(t('docs.inviteDispatchOk', { sent: String(row.sent ?? 0) }));
    }
    await onReload();
    await refresh();
  }

  const working = busy || localBusy;
  const canConfirm =
    canWrite
    && locked
    && protocolLinks.length > 0
    && photoLinks.length > 0
    && postPlace.trim().length > 0
    && !meeting.invitation_posted_at;
  const canSend = canWrite && Boolean(ready?.can_dispatch);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-foreground">{t('docs.inviteTabLead')}</p>
        <p className="mt-1 text-xs text-muted">{t('docs.inviteTabHint')}</p>
      </div>

      {!locked ? (
        <AdminInlineAlert tone="warning">{t('docs.inviteNeedLock')}</AdminInlineAlert>
      ) : (
        <StatusBadge label={t('docs.mcOkInviteLock')} tone="success" />
      )}

      <div className="space-y-2 rounded-[14px] border border-border p-4">
        <p className="text-sm font-medium text-foreground">1. {t('docs.inviteStepProtocol')}</p>
        <p className="text-xs text-secondary">{t('docs.inviteStepProtocolHint')}</p>
        <label className="grid max-w-md gap-1 text-xs text-secondary">
          {t('docs.mcPostPlace')}
          <input
            className={adminFieldClass}
            value={postPlace}
            disabled={!canWrite || Boolean(meeting.invitation_posted_at)}
            onChange={(e) => setPostPlace(e.target.value)}
          />
        </label>
        <AdminSecondaryButton
          type="button"
          disabled={!canWrite || !locked || working}
          onClick={() => void generateProtocol()}
        >
          {t('docs.inviteGenerateProtocol')}
        </AdminSecondaryButton>
      </div>

      <div className="space-y-2 rounded-[14px] border border-border p-4">
        <p className="text-sm font-medium text-foreground">2. {t('docs.inviteStepUpload')}</p>
        <p className="text-xs text-secondary">{t('docs.inviteStepUploadHint')}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <MeetingFileSlotMini
            type="invitation_posting_protocol"
            label={t('docs.invitationPosting')}
            links={protocolLinks}
            docs={docs}
            canWrite={canWrite && locked && !meeting.invitation_posted_at}
            busy={working}
            t={t}
            onUpload={() => onUpload('invitation_posting_protocol')}
            onOpen={onOpenDoc}
          />
          <MeetingFileSlotMini
            type="invitation_posting_photo"
            label={t('docs.invitePostingPhoto')}
            links={photoLinks}
            docs={docs}
            canWrite={canWrite && locked && !meeting.invitation_posted_at}
            busy={working}
            t={t}
            onUpload={() => onUpload('invitation_posting_photo')}
            onOpen={onOpenDoc}
          />
        </div>
        {meeting.invitation_posted_at ? (
          <StatusBadge label={t('docs.mcOkPost')} tone="success" />
        ) : (
          <AdminPrimaryButton
            type="button"
            disabled={!canConfirm || working}
            onClick={() => void confirmPosting()}
          >
            {t('docs.inviteConfirmPosting')}
          </AdminPrimaryButton>
        )}
      </div>

      <div className="space-y-2 rounded-[14px] border border-border p-4">
        <p className="text-sm font-medium text-foreground">3. {t('docs.inviteStepSend')}</p>
        <p className="text-xs text-secondary">{t('docs.inviteStepSendHint')}</p>
        {!ready?.can_dispatch ? (
          <AdminInlineAlert tone="info">{t('docs.inviteSendLocked')}</AdminInlineAlert>
        ) : null}
        <AdminPrimaryButton
          type="button"
          disabled={!canSend || working || (ready?.invitation_sent_count ?? 0) > 0}
          onClick={() => void dispatchAll()}
        >
          {t('docs.inviteSendAll')}
        </AdminPrimaryButton>
        {(ready?.invitation_sent_count ?? 0) > 0 ? (
          <StatusBadge
            label={t('docs.inviteSentBadge', { n: String(ready?.invitation_sent_count ?? 0) })}
            tone="success"
          />
        ) : null}
        {dispatchResult ? <p className="text-sm text-secondary">{dispatchResult}</p> : null}
      </div>
    </div>
  );
}
