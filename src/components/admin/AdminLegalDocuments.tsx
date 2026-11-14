'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useI18n } from '@/i18n/I18nProvider';
import { legalAdminCall } from '@/lib/portalLegal/adminClient';
import {
  AdminCard,
  AdminPageHeader,
  adminBtnPrimaryClass,
  adminBtnSecondaryClass,
  adminFieldClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';

type RevisionRow = {
  id: string;
  revision_number: number;
  status: 'draft' | 'published' | 'superseded';
  test_edition: boolean;
  published_at: string | null;
  effective_on: string | null;
  acceptance_required: boolean;
  offer_acknowledgement: boolean;
  approval_act_ref: string | null;
  approval_act_date: string | null;
  title: string | null;
  visitor_current: boolean;
  owner_obligation: boolean;
  scheduled: boolean;
};

type KindBlock = {
  document_kind: string;
  visitor_revision_id: string | null;
  obligation_revision_id: string | null;
  revisions: RevisionRow[];
};

type Catalog = { today: string; kinds: KindBlock[] };

type TextRow = {
  id: string;
  locale: 'bg' | 'ru' | 'en';
  title: string;
  body: string;
  body_sha256: string;
  is_original: boolean;
};

type AttachmentRow = {
  id: string;
  file_name: string;
  content_type: string;
  public_access: boolean;
  content_sha256: string | null;
};

type AuditRow = {
  action: string;
  actor_email: string | null;
  actor_role: string;
  created_at: string;
  detail: Record<string, unknown>;
};

type RevisionDetail = RevisionRow & {
  document_kind: string;
  texts: TextRow[];
  attachments: AttachmentRow[];
  audit: AuditRow[];
};

type AckRow = {
  acknowledgement_id: string;
  owner_email: string | null;
  apartments: string[];
  action: string;
  revision_id: string;
  revision_number: number;
  document_kind: string;
  ui_locale: string;
  document_locale: string;
  statement_text: string;
  body_sha256: string;
  confirmed_at: string;
};

type CoverageRow = {
  email: string | null;
  name: string | null;
  apartments: string[];
  accepted: boolean;
  confirmed_at: string | null;
  document_locale: string | null;
};

const KINDS = ['portal_terms', 'privacy', 'cookies', 'house_rules', 'operator_contacts'] as const;
const LOCALES = ['bg', 'ru', 'en'] as const;

function kindKey(kind: string) {
  if (kind === 'portal_terms') return 'legal.admin.kindTerms';
  if (kind === 'privacy') return 'legal.admin.kindPrivacy';
  if (kind === 'cookies') return 'legal.admin.kindCookies';
  if (kind === 'house_rules') return 'legal.admin.kindRules';
  return 'legal.admin.kindOperator';
}

async function fileBase64(file: File) {
  const data = await file.arrayBuffer();
  const bytes = new Uint8Array(data);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function AdminLegalDocuments({ supabase }: { supabase: SupabaseClient }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'documents' | 'registry'>('documents');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<RevisionDetail | null>(null);
  const [locale, setLocale] = useState<(typeof LOCALES)[number]>('bg');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [effective, setEffective] = useState('');
  const [requireAcceptance, setRequireAcceptance] = useState(true);
  const [offerRead, setOfferRead] = useState(false);
  const [approvalRef, setApprovalRef] = useState('');
  const [approvalDate, setApprovalDate] = useState('');
  const [publishOpen, setPublishOpen] = useState(false);
  const [attachmentPublic, setAttachmentPublic] = useState(false);
  const [query, setQuery] = useState('');
  const [filterKind, setFilterKind] = useState('');
  const [filterRevision, setFilterRevision] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [acks, setAcks] = useState<AckRow[]>([]);
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  const [obligationId, setObligationId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AckRow | null>(null);

  const explain = useCallback(
    (message: string) => {
      if (message.includes('portal_legal_approval_required')) return t('legal.admin.approvalRequired');
      if (message.includes('portal_legal_forbidden') || message.includes('42501')) return t('legal.admin.forbidden');
      return t('legal.admin.failed');
    },
    [t],
  );

  const loadCatalog = useCallback(async () => {
    const result = await legalAdminCall(supabase, 'portal_legal_admin_catalog', {});
    if (!result.ok) {
      setNotice(explain(result.message));
      return;
    }
    const data = result.data as Catalog;
    setCatalog(data);
    setEffective((current) => current || data.today);
  }, [explain, supabase]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  function openText(next: RevisionDetail, nextLocale: (typeof LOCALES)[number]) {
    const row = next.texts.find((item) => item.locale === nextLocale);
    setLocale(nextLocale);
    setTitle(row?.title ?? '');
    setBody(row?.body ?? '');
  }

  async function openRevision(id: string) {
    setBusy(true);
    setNotice('');
    const result = await legalAdminCall(supabase, 'portal_legal_admin_revision', { p_revision_id: id });
    setBusy(false);
    if (!result.ok || !result.data) {
      setNotice(explain(result.ok ? 'portal_legal_not_found' : result.message));
      return;
    }
    const next = result.data as RevisionDetail;
    setDetail(next);
    setRequireAcceptance(next.acceptance_required);
    setOfferRead(next.offer_acknowledgement);
    setApprovalRef(next.approval_act_ref ?? '');
    setApprovalDate(next.approval_act_date ?? '');
    openText(next, 'bg');
  }

  async function createDraft(kind: string, fromId: string | null) {
    setBusy(true);
    setNotice('');
    const result = await legalAdminCall(supabase, 'portal_legal_admin_create_draft', {
      p_kind: kind,
      p_effective: effective,
      p_from_revision: fromId,
    });
    setBusy(false);
    if (!result.ok) {
      setNotice(explain(result.message));
      return;
    }
    await loadCatalog();
    await openRevision(String(result.data));
    setNotice(t('legal.admin.saved'));
  }

  async function saveText() {
    if (!detail) return;
    setBusy(true);
    const result = await legalAdminCall(supabase, 'portal_legal_admin_save_text', {
      p_revision_id: detail.id,
      p_locale: locale,
      p_title: title,
      p_body: body,
    });
    setBusy(false);
    if (!result.ok) {
      setNotice(explain(result.message));
      return;
    }
    await openRevision(detail.id);
    setNotice(t('legal.admin.saved'));
  }

  async function addAttachment(file: File) {
    if (!detail) return;
    setBusy(true);
    const encoded = await fileBase64(file);
    const result = await legalAdminCall(supabase, 'portal_legal_admin_add_attachment', {
      p_revision_id: detail.id,
      p_file_name: file.name,
      p_content_type: file.type || 'application/octet-stream',
      p_base64: encoded,
      p_public: attachmentPublic,
    });
    setBusy(false);
    if (!result.ok) {
      setNotice(explain(result.message));
      return;
    }
    await openRevision(detail.id);
    setNotice(t('legal.admin.saved'));
  }

  async function publish() {
    if (!detail) return;
    setBusy(true);
    const result = await legalAdminCall(supabase, 'portal_legal_admin_publish', {
      p_revision_id: detail.id,
      p_acceptance_required: requireAcceptance,
      p_offer_acknowledgement: offerRead,
      p_approval_ref: approvalRef,
      p_approval_date: approvalDate || null,
    });
    setBusy(false);
    if (!result.ok) {
      setNotice(explain(result.message));
      return;
    }
    setPublishOpen(false);
    await loadCatalog();
    await openRevision(detail.id);
    setNotice(t('legal.admin.publishedOk'));
  }

  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (filterKind) params.set('kind', filterKind);
    if (filterRevision) params.set('revision', filterRevision);
    if (filterAction) params.set('action', filterAction);
    if (filterFrom) params.set('from', filterFrom);
    if (filterTo) params.set('to', filterTo);
    return `/api/admin/legal-export?${params.toString()}`;
  }, [filterAction, filterFrom, filterKind, filterRevision, filterTo, query]);

  async function loadRegistry() {
    setBusy(true);
    setNotice('');
    const [list, cover] = await Promise.all([
      legalAdminCall(supabase, 'portal_legal_admin_acknowledgements', {
        p_query: query,
        p_kind: filterKind || null,
        p_revision_id: filterRevision || null,
        p_action: filterAction || null,
        p_from: filterFrom || null,
        p_to: filterTo || null,
      }),
      legalAdminCall(supabase, 'portal_legal_admin_terms_coverage', { p_query: query }),
    ]);
    setBusy(false);
    if (!list.ok || !cover.ok) {
      setNotice(explain(!list.ok ? list.message : !cover.ok ? cover.message : 'portal_legal_forbidden'));
      return;
    }
    setAcks((list.data as AckRow[]) ?? []);
    const coverageData = cover.data as { obligation_id: string | null; rows: CoverageRow[] };
    setObligationId(coverageData.obligation_id);
    setCoverage(coverageData.rows ?? []);
  }

  const selectedText = detail?.texts.find((item) => item.locale === locale);
  const publishScheduled = Boolean(detail?.effective_on && catalog?.today && detail.effective_on > catalog.today);
  const consequence = !detail
    ? ''
    : [
        detail.document_kind === 'portal_terms'
          ? t(requireAcceptance ? 'legal.admin.consequenceRequired' : 'legal.admin.consequenceKeep')
          : detail.document_kind === 'privacy' || detail.document_kind === 'house_rules'
            ? t(offerRead ? 'legal.admin.consequenceOffer' : 'legal.admin.consequenceNone')
            : t('legal.admin.consequenceNone'),
        publishScheduled ? t('legal.admin.consequenceLater') : '',
      ]
        .filter(Boolean)
        .join(' ');

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title={t('legal.admin.title')}
        secondary={catalog ? t('legal.admin.effectiveOn', { date: catalog.today }) : undefined}
        action={
          <div className="flex gap-2">
            <button type="button" className={tab === 'documents' ? adminBtnPrimaryClass : adminBtnSecondaryClass} onClick={() => setTab('documents')}>
              {t('legal.admin.documents')}
            </button>
            <button type="button" className={tab === 'registry' ? adminBtnPrimaryClass : adminBtnSecondaryClass} onClick={() => setTab('registry')}>
              {t('legal.admin.registry')}
            </button>
          </div>
        }
      />
      {notice ? <p className="text-sm text-secondary">{notice}</p> : null}

      {tab === 'documents' ? (
        <div className="space-y-4">
          <label className="grid max-w-xs gap-1 text-sm text-secondary">
            {t('legal.admin.effectiveOn', { date: '' }).replace(/\s+$/, '')}
            <input className={adminFieldClass} type="date" value={effective} onChange={(event) => setEffective(event.target.value)} />
          </label>
          {(catalog?.kinds ?? []).map((kind) => {
            const groups = {
              visitor: kind.revisions.filter((row) => row.visitor_current),
              scheduled: kind.revisions.filter((row) => row.scheduled),
              drafts: kind.revisions.filter((row) => row.status === 'draft'),
              archive: kind.revisions.filter((row) => row.status === 'superseded' && !row.visitor_current && !row.owner_obligation),
            };
            const previous = kind.revisions.find((row) => row.status !== 'draft') ?? kind.revisions[0];
            return (
              <AdminCard key={kind.document_kind}>
                <div className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-semibold">{t(kindKey(kind.document_kind))}</h2>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={adminBtnSecondaryClass} disabled={busy || !effective} onClick={() => void createDraft(kind.document_kind, null)}>
                        {t('legal.admin.newDraft')}
                      </button>
                      <button type="button" className={adminBtnSecondaryClass} disabled={busy || !effective || !previous} onClick={() => void createDraft(kind.document_kind, previous?.id ?? null)}>
                        {t('legal.admin.fromPrevious')}
                      </button>
                    </div>
                  </div>
                  {kind.document_kind === 'house_rules' ? <p className="text-sm text-secondary">{t('legal.admin.rulesStayDraft')}</p> : null}
                  <RevisionList label={t('legal.admin.visitorNow')} rows={groups.visitor} onOpen={openRevision} />
                  {kind.document_kind === 'portal_terms' ? (
                    <RevisionList
                      label={t('legal.admin.ownerMustAccept')}
                      rows={kind.revisions.filter((row) => row.owner_obligation)}
                      onOpen={openRevision}
                    />
                  ) : null}
                  <RevisionList label={t('legal.admin.scheduled')} rows={groups.scheduled} onOpen={openRevision} />
                  <RevisionList label={t('legal.admin.drafts')} rows={groups.drafts} onOpen={openRevision} />
                  <RevisionList label={t('legal.admin.archive')} rows={groups.archive} onOpen={openRevision} />
                </div>
              </AdminCard>
            );
          })}

          {detail ? (
            <AdminCard>
              <div className="space-y-3 p-4">
                <h2 className="text-base font-semibold">
                  {t(kindKey(detail.document_kind))} · {t('legal.revision', { number: detail.revision_number })}
                </h2>
                <p className="text-sm text-secondary">
                  {detail.published_at ? t('legal.admin.publishedOn', { date: detail.published_at.slice(0, 10) }) : t('legal.admin.drafts')}
                  {detail.effective_on ? ` · ${t('legal.admin.effectiveOn', { date: detail.effective_on })}` : ''}
                  {detail.visitor_current ? ` · ${t('legal.admin.visitorNow')}` : ''}
                  {detail.owner_obligation ? ` · ${t('legal.admin.ownerMustAccept')}` : ''}
                  {detail.scheduled ? ` · ${t('legal.admin.scheduled')}` : ''}
                </p>
                <div className="flex gap-2">
                  {LOCALES.map((item) => (
                    <button key={item} type="button" className={locale === item ? adminBtnPrimaryClass : adminBtnSecondaryClass} onClick={() => openText(detail, item)}>
                      {item.toUpperCase()}
                    </button>
                  ))}
                </div>
                <label className="grid gap-1 text-sm text-secondary">
                  {t('legal.admin.titleField')}
                  <input className={adminFieldClass} value={title} disabled={detail.status !== 'draft'} onChange={(event) => setTitle(event.target.value)} />
                </label>
                <label className="grid gap-1 text-sm text-secondary">
                  {t('legal.admin.bodyField')}
                  <textarea className={`${adminFieldClass} min-h-40`} value={body} disabled={detail.status !== 'draft'} onChange={(event) => setBody(event.target.value)} />
                </label>
                {detail.status === 'draft' ? (
                  <button type="button" className={adminBtnPrimaryClass} disabled={busy} onClick={() => void saveText()}>
                    {t('legal.admin.save')}
                  </button>
                ) : null}
                {selectedText ? (
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-sm font-medium">{t('legal.admin.preview')}</p>
                    <h3 className="mt-2 text-base font-semibold">{selectedText.title}</h3>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{selectedText.body}</p>
                    <p className="mt-2 text-xs text-muted">{selectedText.body_sha256}</p>
                  </div>
                ) : null}
                {detail.document_kind === 'portal_terms' ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={requireAcceptance} disabled={detail.status !== 'draft'} onChange={(event) => setRequireAcceptance(event.target.checked)} />
                    {t('legal.admin.requireAcceptance')}
                  </label>
                ) : null}
                {detail.document_kind === 'privacy' || detail.document_kind === 'house_rules' ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={offerRead} disabled={detail.status !== 'draft'} onChange={(event) => setOfferRead(event.target.checked)} />
                    {t('legal.admin.offerRead')}
                  </label>
                ) : null}
                {detail.document_kind === 'house_rules' ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm text-secondary">
                      {t('legal.admin.approvalRef')}
                      <input className={adminFieldClass} value={approvalRef} disabled={detail.status !== 'draft'} onChange={(event) => setApprovalRef(event.target.value)} />
                    </label>
                    <label className="grid gap-1 text-sm text-secondary">
                      {t('legal.admin.approvalDate')}
                      <input className={adminFieldClass} type="date" value={approvalDate} disabled={detail.status !== 'draft'} onChange={(event) => setApprovalDate(event.target.value)} />
                    </label>
                    <p className="text-sm text-secondary sm:col-span-2">{t('legal.admin.approvalRequired')}</p>
                  </div>
                ) : null}
                {detail.status === 'draft' ? (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={attachmentPublic} onChange={(event) => setAttachmentPublic(event.target.checked)} />
                      {attachmentPublic ? t('legal.admin.attachmentPublic') : t('legal.admin.attachmentClosed')}
                    </label>
                    <input
                      type="file"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void addAttachment(file);
                        event.target.value = '';
                      }}
                    />
                  </div>
                ) : null}
                <ul className="text-sm">
                  {detail.attachments.map((item) => (
                    <li key={item.id}>
                      <a className="text-accent hover:underline" href={`/api/admin/legal-attachment/${item.id}`}>
                        {item.file_name}
                      </a>
                      <span className="text-muted"> · {item.public_access ? t('legal.admin.attachmentPublic') : t('legal.admin.attachmentClosed')}</span>
                    </li>
                  ))}
                </ul>
                {detail.audit.length > 0 ? (
                  <div>
                    <p className="text-sm font-medium">{t('legal.admin.audit')}</p>
                    <ul className="text-sm text-secondary">
                      {detail.audit.map((item) => (
                        <li key={`${item.created_at}-${item.actor_email}`}>
                          {item.actor_email} · {item.actor_role} · {item.created_at}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {detail.status === 'draft' ? (
                  <button type="button" className={adminBtnPrimaryClass} disabled={busy} onClick={() => setPublishOpen(true)}>
                    {t('legal.admin.publish')}
                  </button>
                ) : null}
              </div>
            </AdminCard>
          ) : null}
        </div>
      ) : (
        <AdminCard>
          <div className="space-y-3 p-4">
            <div className="grid gap-2 md:grid-cols-3">
              <input className={adminFieldClass} placeholder={t('legal.admin.search')} value={query} onChange={(event) => setQuery(event.target.value)} />
              <select className={adminFieldClass} value={filterKind} onChange={(event) => setFilterKind(event.target.value)}>
                <option value="">{t('legal.admin.all')}</option>
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>{t(kindKey(kind))}</option>
                ))}
              </select>
              <select className={adminFieldClass} value={filterAction} onChange={(event) => setFilterAction(event.target.value)}>
                <option value="">{t('legal.admin.all')}</option>
                <option value="accept_terms">{t('legal.actionAccept')}</option>
                <option value="ack_privacy">{t('legal.actionPrivacy')}</option>
                <option value="ack_house_rules">{t('legal.actionRules')}</option>
              </select>
              <input className={adminFieldClass} placeholder={t('legal.admin.filterRevision')} value={filterRevision} onChange={(event) => setFilterRevision(event.target.value)} />
              <input className={adminFieldClass} type="date" value={filterFrom} onChange={(event) => setFilterFrom(event.target.value)} />
              <input className={adminFieldClass} type="date" value={filterTo} onChange={(event) => setFilterTo(event.target.value)} />
            </div>
            <div className="flex gap-2">
              <button type="button" className={adminBtnPrimaryClass} disabled={busy} onClick={() => void loadRegistry()}>
                {t('legal.admin.apply')}
              </button>
              <a className={adminBtnSecondaryClass} href={exportHref}>
                {t('legal.admin.export')}
              </a>
            </div>
            <p className="text-sm text-secondary">
              {obligationId ? `${t('legal.admin.ownerMustAccept')}: ${obligationId}` : t('legal.admin.notRequired')}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={adminTableHeadRowClass}>
                    <th className={adminTableCellClass}>{t('legal.admin.owner')}</th>
                    <th className={adminTableCellClass}>{t('legal.admin.document')}</th>
                    <th className={adminTableCellClass}>{t('legal.admin.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.map((row) => (
                    <tr key={`${row.email}-${row.confirmed_at ?? 'pending'}`} className={adminTableRowClass}>
                      <td className={adminTableCellClass}>
                        {row.name || row.email} {row.apartments?.length ? `(${row.apartments.join(', ')})` : ''}
                      </td>
                      <td className={adminTableCellClass}>{t('legal.admin.kindTerms')}</td>
                      <td className={adminTableCellClass}>{row.accepted ? t('legal.admin.accepted') : t('legal.admin.pending')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {acks.length === 0 ? <p className="text-sm text-secondary">{t('legal.admin.noRows')}</p> : null}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={adminTableHeadRowClass}>
                    <th className={adminTableCellClass}>{t('legal.admin.owner')}</th>
                    <th className={adminTableCellClass}>{t('legal.admin.document')}</th>
                    <th className={adminTableCellClass}>{t('legal.admin.revision')}</th>
                    <th className={adminTableCellClass}>{t('legal.admin.action')}</th>
                    <th className={adminTableCellClass}>{t('legal.admin.language')}</th>
                    <th className={adminTableCellClass}>{t('legal.admin.confirmed')}</th>
                  </tr>
                </thead>
                <tbody>
                  {acks.map((row) => (
                    <tr key={row.acknowledgement_id} className={adminTableRowClass}>
                      <td className={adminTableCellClass}>{row.owner_email}</td>
                      <td className={adminTableCellClass}>{t(kindKey(row.document_kind))}</td>
                      <td className={adminTableCellClass}>{row.revision_number}</td>
                      <td className={adminTableCellClass}>{row.action}</td>
                      <td className={adminTableCellClass}>{row.document_locale}</td>
                      <td className={adminTableCellClass}>
                        <button type="button" className="text-accent hover:underline" onClick={() => setSnapshot(row)}>
                          {row.confirmed_at}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </AdminCard>
      )}

      {publishOpen && detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-lg space-y-3 rounded-2xl bg-surface p-5">
            <h2 className="text-base font-semibold">{t('legal.admin.publishTitle')}</h2>
            <p className="text-sm">{t('legal.admin.audience')}: {t('legal.admin.audienceOwners')}</p>
            <p className="text-sm">{t('legal.admin.effectiveOn', { date: detail.effective_on ?? effective })}</p>
            <p className="text-sm">{consequence}</p>
            <div className="flex gap-2">
              <button type="button" className={adminBtnPrimaryClass} disabled={busy} onClick={() => void publish()}>
                {t('legal.admin.publish')}
              </button>
              <button type="button" className={adminBtnSecondaryClass} onClick={() => setPublishOpen(false)}>
                {t('legal.admin.cancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {snapshot ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-lg space-y-2 rounded-2xl bg-surface p-5">
            <h2 className="text-base font-semibold">{t('legal.admin.openSnapshot')}</h2>
            <p className="text-sm">{snapshot.owner_email}</p>
            <p className="text-sm">{t('legal.admin.statement')}: {snapshot.statement_text}</p>
            <p className="text-sm">{t('legal.admin.language')}: {snapshot.document_locale} / {snapshot.ui_locale}</p>
            <p className="break-all text-xs text-muted">{t('legal.admin.checksum')}: {snapshot.body_sha256}</p>
            <div className="flex gap-2">
              <a className={adminBtnPrimaryClass} href={`/api/admin/legal-snapshot/${snapshot.acknowledgement_id}`}>
                {t('legal.admin.download')}
              </a>
              <button type="button" className={adminBtnSecondaryClass} onClick={() => setSnapshot(null)}>
                {t('legal.admin.cancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RevisionList({
  label,
  rows,
  onOpen,
}: {
  label: string;
  rows: RevisionRow[];
  onOpen: (id: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <ul className="mt-1 space-y-1 text-sm">
        {rows.map((row) => (
          <li key={`${label}-${row.id}`}>
            <button type="button" className="text-left text-accent hover:underline" onClick={() => onOpen(row.id)}>
              {row.revision_number}. {row.title || row.status}
              {row.published_at ? ` · ${row.published_at.slice(0, 10)}` : ''}
              {row.effective_on ? ` · ${row.effective_on}` : ''}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
