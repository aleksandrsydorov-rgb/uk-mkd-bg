'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { ownerVisibleError } from '@/lib/ownerError';
import { isMissingRelation } from '@/lib/polls';
import {
  BOOK_ENTITY_KINDS,
  OWNERSHIP_TYPES,
  canSeePropertyBookAdmin,
  downloadPropertyBookExcelTemplate,
  parsePropertyBookWorkbook,
  type BookEntityKind,
  type OwnershipType,
  type PropertyBookListRow,
} from '@/lib/propertyBookAdmin';
import {
  AdminPageHeader,
  AdminEmptyState,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
  AdminTableShell,
  adminCardClass,
  adminFieldClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import { StatusBadge } from '@/components/account/ownerUi';

type PropertyOption = {
  id: number;
  apartment_number: string | number | null;
};

type OwnerForm = {
  entity_kind: BookEntityKind;
  first_name: string;
  middle_name: string;
  last_name: string;
  entity_name: string;
  eik_bulstat: string;
  email: string;
  ownership_share_percent: string;
  ideal_parts_percent: string;
};

const emptyOwner = (): OwnerForm => ({
  entity_kind: 'natural_person',
  first_name: '',
  middle_name: '',
  last_name: '',
  entity_name: '',
  eik_bulstat: '',
  email: '',
  ownership_share_percent: '100',
  ideal_parts_percent: '',
});

function aptLabel(v: string | number | null | undefined) {
  return String(v ?? '');
}

export function AdminPropertyBook({
  supabase,
  properties,
  staffRole,
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyOption[];
  staffRole: string;
}) {
  const { t } = useI18n();
  const canSee = canSeePropertyBookAdmin(staffRole);
  const [rows, setRows] = useState<PropertyBookListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'complete' | 'incomplete'>('all');

  const [selectedId, setSelectedId] = useState<number | ''>('');
  const [purpose, setPurpose] = useState('');
  const [areaSqm, setAreaSqm] = useState('');
  const [idealParts, setIdealParts] = useState('');
  const [ownershipType, setOwnershipType] = useState<OwnershipType>('sole');
  const [owners, setOwners] = useState<OwnerForm[]>([emptyOwner()]);
  const [importErrors, setImportErrors] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [invites, setInvites] = useState<
    Array<{ id: string; email: string; status: string; expires_at: string; created_at: string }>
  >([]);

  const sortedProps = useMemo(
    () =>
      [...properties].sort(
        (a, b) => Number(a.apartment_number) - Number(b.apartment_number),
      ),
    [properties],
  );

  const filtered = useMemo(() => {
    const list =
      filter === 'complete'
        ? rows.filter((r) => r.book_complete)
        : filter === 'incomplete'
          ? rows.filter((r) => !r.book_complete)
          : [...rows];
    return list.sort(
      (a, b) => Number(a.apartment_number) - Number(b.apartment_number),
    );
  }, [rows, filter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_list_property_book', {
        p_limit: 1000,
      });
      if (rpcErr) {
        if (isMissingRelation(rpcErr, 'admin_list_property_book')) {
          setRows([]);
          setError(t('admin.bookMigrationNeeded'));
          return;
        }
        throw rpcErr;
      }
      setRows((data as PropertyBookListRow[] | null) ?? []);
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setLoading(false);
    }
  }, [supabase, t]);

  useEffect(() => {
    if (canSee) void load();
  }, [canSee, load]);

  async function openProperty(id: number) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_get_property_book', {
        p_property_id: id,
      });
      if (rpcErr) throw rpcErr;
      const payload = data as {
        property: {
          id: number;
          purpose: string | null;
          area_sqm: number | null;
          ideal_parts_percent: number | null;
          ownership_type: string | null;
        };
        owners: Array<Record<string, unknown>>;
      };
      setSelectedId(id);
      setPurpose(payload.property.purpose ?? '');
      setAreaSqm(payload.property.area_sqm != null ? String(payload.property.area_sqm) : '');
      setIdealParts(
        payload.property.ideal_parts_percent != null
          ? String(payload.property.ideal_parts_percent)
          : '',
      );
      setOwnershipType(
        payload.property.ownership_type === 'shared' ? 'shared' : 'sole',
      );
      const mapped = (payload.owners ?? []).map((o) => ({
        entity_kind: (String(o.entity_kind || 'natural_person') as BookEntityKind),
        first_name: String(o.first_name ?? ''),
        middle_name: String(o.middle_name ?? ''),
        last_name: String(o.last_name ?? ''),
        entity_name: String(o.entity_name ?? ''),
        eik_bulstat: String(o.eik_bulstat ?? ''),
        email: String(o.email ?? ''),
        ownership_share_percent:
          o.ownership_share_percent != null ? String(o.ownership_share_percent) : '',
        ideal_parts_percent:
          o.ideal_parts_percent != null ? String(o.ideal_parts_percent) : '',
      }));
      setOwners(mapped.length > 0 ? mapped : [emptyOwner()]);
      const { data: invData, error: invErr } = await supabase.rpc('admin_list_property_invites', {
        p_property_id: id,
      });
      if (!invErr) {
        setInvites(
          ((invData as Array<Record<string, unknown>>) ?? []).map((i) => ({
            id: String(i.id),
            email: String(i.email ?? ''),
            status: String(i.status ?? ''),
            expires_at: String(i.expires_at ?? ''),
            created_at: String(i.created_at ?? ''),
          })),
        );
      } else {
        setInvites([]);
      }
      setInviteLink(null);
      setInviteEmail(mapped[0]?.email ?? '');
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function saveCard() {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const { error: objErr } = await supabase.rpc('admin_upsert_property_book_object', {
        p_property_id: selectedId,
        p_purpose: purpose,
        p_area_sqm: Number(areaSqm),
        p_ideal_parts_percent: Number(idealParts),
        p_ownership_type: ownershipType,
      });
      if (objErr) throw objErr;

      const { data, error: ownErr } = await supabase.rpc('admin_replace_property_book_owners', {
        p_property_id: selectedId,
        p_owners: owners.map((o) => ({
          entity_kind: o.entity_kind,
          first_name: o.first_name || null,
          middle_name: o.middle_name || null,
          last_name: o.last_name || null,
          entity_name: o.entity_name || null,
          eik_bulstat: o.eik_bulstat || null,
          email: o.email || null,
          ownership_share_percent: o.ownership_share_percent,
          ideal_parts_percent: o.ideal_parts_percent,
        })),
      });
      if (ownErr) throw ownErr;
      const validation = (data as { validation?: { ok?: boolean; errors?: string[] } })?.validation;
      if (validation && validation.ok === false) {
        setSuccess(null);
        setError(
          `${t('admin.bookSavedIncomplete')}: ${(validation.errors ?? []).join(', ')}`,
        );
      } else {
        setSuccess(t('admin.bookSaved'));
      }
      await load();
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function runImport(file: File, dryRun: boolean) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    setImportErrors(null);
    try {
      const { objects: objectRows, owners: ownerRows } = await parsePropertyBookWorkbook(file);
      if (objectRows.length === 0) throw new Error(t('admin.bookExcelEmptyObjects'));
      if (ownerRows.length === 0) throw new Error(t('admin.bookExcelEmptyOwners'));
      const { data, error: rpcErr } = await supabase.rpc('admin_import_property_book', {
        p_objects: objectRows,
        p_owners: ownerRows,
        p_dry_run: dryRun,
      });
      if (rpcErr) throw rpcErr;
      const result = data as {
        ok: boolean;
        dry_run: boolean;
        errors: unknown[];
        complete_count?: number;
      };
      if (!result.ok) {
        setImportErrors(JSON.stringify(result.errors, null, 2));
        setError(t('admin.bookImportHasErrors'));
      } else if (dryRun) {
        setSuccess(t('admin.bookImportDryOk'));
      } else {
        setSuccess(
          t('admin.bookImportApplied', { n: String(result.complete_count ?? 0) }),
        );
        await load();
      }
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  if (!canSee) {
    return (
      <div className="space-y-4">
        <AdminPageHeader title={t('admin.book')} secondary={t('admin.bookLead')} />
        <AdminInlineAlert tone="warning">{t('admin.errNoAccess')}</AdminInlineAlert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t('admin.book')} secondary={t('admin.bookLead')} />
      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}
      {success ? <AdminInlineAlert tone="success">{success}</AdminInlineAlert> : null}

      <section className={`${adminCardClass} space-y-3 p-4`}>
        <h3 className="text-sm font-semibold text-foreground">{t('admin.bookImport')}</h3>
        <p className="text-xs text-secondary">{t('admin.bookImportHint')}</p>
        <div className="flex flex-wrap gap-2">
          <AdminSecondaryButton
            type="button"
            onClick={() => downloadPropertyBookExcelTemplate('property_book_template.xlsx')}
          >
            {t('admin.bookTplExcel')}
          </AdminSecondaryButton>
        </div>
        <label className="grid max-w-xl gap-1 text-sm text-secondary">
          {t('admin.bookFileExcel')}
          <input
            id="book-excel-file"
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className={adminFieldClass}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <AdminSecondaryButton
            type="button"
            disabled={busy}
            onClick={() => {
              const f = (document.getElementById('book-excel-file') as HTMLInputElement)?.files?.[0];
              if (!f) {
                setError(t('admin.bookFileRequired'));
                return;
              }
              void runImport(f, true);
            }}
          >
            {t('admin.bookDryRun')}
          </AdminSecondaryButton>
          <AdminPrimaryButton
            type="button"
            disabled={busy}
            onClick={() => {
              const f = (document.getElementById('book-excel-file') as HTMLInputElement)?.files?.[0];
              if (!f) {
                setError(t('admin.bookFileRequired'));
                return;
              }
              if (!confirm(t('admin.bookImportConfirm'))) return;
              void runImport(f, false);
            }}
          >
            {t('admin.bookApplyImport')}
          </AdminPrimaryButton>
        </div>
        {importErrors ? (
          <pre className="max-h-48 overflow-auto rounded-lg bg-background p-3 text-xs text-danger">
            {importErrors}
          </pre>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-foreground">{t('admin.bookList')}</h3>
          <div className="flex flex-wrap gap-2">
            <select
              className={adminFieldClass}
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
            >
              <option value="all">{t('admin.bookFilterAll')}</option>
              <option value="complete">{t('admin.bookFilterComplete')}</option>
              <option value="incomplete">{t('admin.bookFilterIncomplete')}</option>
            </select>
            <AdminSecondaryButton type="button" disabled={busy || loading} onClick={() => void load()}>
              {t('admin.secRefresh')}
            </AdminSecondaryButton>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        ) : filtered.length === 0 ? (
          <AdminEmptyState title={t('admin.bookEmpty')} />
        ) : (
          <AdminTableShell>
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className={adminTableHeadRowClass}>
                  <th className={adminTableCellClass}>{t('admin.apartments')}</th>
                  <th className={adminTableCellClass}>{t('admin.bookOwnershipType')}</th>
                  <th className={adminTableCellClass}>{t('admin.bookOwners')}</th>
                  <th className={adminTableCellClass}>{t('admin.status')}</th>
                  <th className={adminTableCellClass} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.property_id} className={adminTableRowClass}>
                    <td className={adminTableCellClass}>{row.apartment_number}</td>
                    <td className={adminTableCellClass}>
                      {row.ownership_type
                        ? t(`admin.bookType_${row.ownership_type}`)
                        : '—'}
                    </td>
                    <td className={adminTableCellClass}>{row.owner_count}</td>
                    <td className={adminTableCellClass}>
                      <StatusBadge
                        label={
                          row.book_complete
                            ? t('admin.bookComplete')
                            : t('admin.bookIncomplete')
                        }
                        tone={row.book_complete ? 'success' : 'warning'}
                      />
                    </td>
                    <td className={adminTableCellClass}>
                      <button
                        type="button"
                        className="text-sm text-accent hover:underline"
                        disabled={busy}
                        onClick={() => void openProperty(row.property_id)}
                      >
                        {t('common.open')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableShell>
        )}
      </section>

      {selectedId ? (
        <section className={`${adminCardClass} space-y-4 p-4`}>
          <h3 className="text-base font-semibold text-foreground">
            {t('admin.bookEdit')} ·{' '}
            {aptLabel(sortedProps.find((p) => p.id === selectedId)?.apartment_number)}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm text-secondary">
              {t('admin.bookPurpose')}
              <input className={adminFieldClass} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm text-secondary">
              {t('admin.bookArea')}
              <input className={adminFieldClass} value={areaSqm} onChange={(e) => setAreaSqm(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm text-secondary">
              {t('admin.bookIdealParts')}
              <input
                className={adminFieldClass}
                value={idealParts}
                onChange={(e) => setIdealParts(e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm text-secondary">
              {t('admin.bookOwnershipType')}
              <select
                className={adminFieldClass}
                value={ownershipType}
                onChange={(e) => setOwnershipType(e.target.value as OwnershipType)}
              >
                {OWNERSHIP_TYPES.map((ot) => (
                  <option key={ot} value={ot}>
                    {t(`admin.bookType_${ot}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">{t('admin.bookOwners')}</h4>
              <AdminSecondaryButton
                type="button"
                onClick={() => setOwners((prev) => [...prev, emptyOwner()])}
              >
                {t('admin.bookAddOwner')}
              </AdminSecondaryButton>
            </div>
            {owners.map((owner, idx) => (
              <div key={idx} className="space-y-2 rounded-xl border border-border p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs text-secondary">
                    {t('admin.bookEntityKind')}
                    <select
                      className={adminFieldClass}
                      value={owner.entity_kind}
                      onChange={(e) => {
                        const v = e.target.value as BookEntityKind;
                        setOwners((prev) =>
                          prev.map((o, i) => (i === idx ? { ...o, entity_kind: v } : o)),
                        );
                      }}
                    >
                      {BOOK_ENTITY_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {t(`admin.bookEntity_${k}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs text-secondary">
                    Email
                    <input
                      className={adminFieldClass}
                      value={owner.email}
                      onChange={(e) =>
                        setOwners((prev) =>
                          prev.map((o, i) => (i === idx ? { ...o, email: e.target.value } : o)),
                        )
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-secondary">
                    {t('admin.bookShare')}
                    <input
                      className={adminFieldClass}
                      value={owner.ownership_share_percent}
                      onChange={(e) =>
                        setOwners((prev) =>
                          prev.map((o, i) =>
                            i === idx ? { ...o, ownership_share_percent: e.target.value } : o,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-secondary">
                    {t('admin.bookOwnerIdeal')}
                    <input
                      className={adminFieldClass}
                      value={owner.ideal_parts_percent}
                      onChange={(e) =>
                        setOwners((prev) =>
                          prev.map((o, i) =>
                            i === idx ? { ...o, ideal_parts_percent: e.target.value } : o,
                          ),
                        )
                      }
                    />
                  </label>
                  {owner.entity_kind === 'legal_entity' || owner.entity_kind === 'sole_trader' ? (
                    <>
                      <label className="grid gap-1 text-xs text-secondary">
                        {t('admin.bookEntityName')}
                        <input
                          className={adminFieldClass}
                          value={owner.entity_name}
                          onChange={(e) =>
                            setOwners((prev) =>
                              prev.map((o, i) =>
                                i === idx ? { ...o, entity_name: e.target.value } : o,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="grid gap-1 text-xs text-secondary">
                        {t('admin.bookEik')}
                        <input
                          className={adminFieldClass}
                          value={owner.eik_bulstat}
                          onChange={(e) =>
                            setOwners((prev) =>
                              prev.map((o, i) =>
                                i === idx ? { ...o, eik_bulstat: e.target.value } : o,
                              ),
                            )
                          }
                        />
                      </label>
                    </>
                  ) : null}
                  {owner.entity_kind !== 'legal_entity' ? (
                    <>
                      <label className="grid gap-1 text-xs text-secondary">
                        {t('admin.bookFirstName')}
                        <input
                          className={adminFieldClass}
                          value={owner.first_name}
                          onChange={(e) =>
                            setOwners((prev) =>
                              prev.map((o, i) =>
                                i === idx ? { ...o, first_name: e.target.value } : o,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="grid gap-1 text-xs text-secondary">
                        {t('admin.bookLastName')}
                        <input
                          className={adminFieldClass}
                          value={owner.last_name}
                          onChange={(e) =>
                            setOwners((prev) =>
                              prev.map((o, i) =>
                                i === idx ? { ...o, last_name: e.target.value } : o,
                              ),
                            )
                          }
                        />
                      </label>
                    </>
                  ) : null}
                </div>
                {owners.length > 1 ? (
                  <button
                    type="button"
                    className="text-xs text-danger hover:underline"
                    onClick={() => setOwners((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    {t('common.delete')}
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          <AdminPrimaryButton type="button" disabled={busy} onClick={() => void saveCard()}>
            {busy ? t('common.saving') : t('common.save')}
          </AdminPrimaryButton>

          <div className="space-y-3 border-t border-border pt-4">
            <h4 className="text-sm font-semibold">{t('admin.bookInvite')}</h4>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="grid min-w-0 flex-1 gap-1 text-sm text-secondary">
                {t('admin.bookInviteEmail')}
                <input
                  className={adminFieldClass}
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </label>
              <AdminPrimaryButton
                type="button"
                disabled={busy || !inviteEmail.trim()}
                onClick={() => {
                  void (async () => {
                    if (!selectedId) return;
                    setBusy(true);
                    setError(null);
                    try {
                      const { data, error: rpcErr } = await supabase.rpc(
                        'admin_create_property_invite',
                        {
                          p_property_id: selectedId,
                          p_email: inviteEmail.trim(),
                        },
                      );
                      if (rpcErr) throw rpcErr;
                      const token = String((data as { token?: string })?.token ?? '');
                      const link = `${window.location.origin}/auth/invite?token=${token}`;
                      setInviteLink(link);
                      try {
                        await navigator.clipboard.writeText(link);
                        setSuccess(t('admin.bookInviteCopied'));
                      } catch {
                        setSuccess(t('admin.bookInviteLink'));
                      }
                      const { data: invData } = await supabase.rpc('admin_list_property_invites', {
                        p_property_id: selectedId,
                      });
                      setInvites(
                        ((invData as Array<Record<string, unknown>>) ?? []).map((i) => ({
                          id: String(i.id),
                          email: String(i.email ?? ''),
                          status: String(i.status ?? ''),
                          expires_at: String(i.expires_at ?? ''),
                          created_at: String(i.created_at ?? ''),
                        })),
                      );
                    } catch (e: unknown) {
                      setError(ownerVisibleError(e, t('admin.errGeneric')));
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                {t('admin.bookInviteSend')}
              </AdminPrimaryButton>
            </div>
            {inviteLink ? (
              <p className="break-all text-xs text-muted">
                {t('admin.bookInviteLink')}: {inviteLink}
              </p>
            ) : null}
            {invites.length > 0 ? (
              <ul className="space-y-2 text-sm">
                <li className="text-xs font-medium uppercase tracking-wide text-muted">
                  {t('admin.bookInvites')}
                </li>
                {invites.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <span>
                      {inv.email} ·{' '}
                      {t(`admin.bookInviteStatus_${inv.status}` as 'admin.bookInviteStatus_pending')}
                    </span>
                    {inv.status === 'pending' ? (
                      <button
                        type="button"
                        className="text-xs text-danger hover:underline"
                        disabled={busy}
                        onClick={() => {
                          void (async () => {
                            setBusy(true);
                            try {
                              const { error: rpcErr } = await supabase.rpc(
                                'admin_revoke_property_invite',
                                { p_invite_id: inv.id },
                              );
                              if (rpcErr) throw rpcErr;
                              setInvites((prev) =>
                                prev.map((x) =>
                                  x.id === inv.id ? { ...x, status: 'revoked' } : x,
                                ),
                              );
                            } catch (e: unknown) {
                              setError(ownerVisibleError(e, t('admin.errGeneric')));
                            } finally {
                              setBusy(false);
                            }
                          })();
                        }}
                      >
                        {t('admin.bookInviteRevoke')}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
