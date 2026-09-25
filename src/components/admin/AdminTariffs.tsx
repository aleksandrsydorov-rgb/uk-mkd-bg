'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { formatOwnerDate, formatOwnerDateTime } from '@/lib/ownerFormat';
import { isMissingRelation } from '@/lib/polls';
import { ownerVisibleError } from '@/lib/ownerError';
import {
  applicationYearFromValidFrom,
  canCancelTariffVersionInUi,
  canPublishSupportTariff,
  canPublishUtilityTariff,
  formatTariffRate,
  normalizeTariffHistoryRow,
  normalizeTariffListRow,
  sofiaCurrentYear,
  sofiaTodayIsoDate,
  type TariffHistoryRow,
  type TariffListRow,
  type TariffTab,
} from '@/lib/tariffs';
import {
  AdminPageHeader,
  AdminCard,
  AdminEmptyState,
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
  AdminTabBar,
  adminFieldClass,
  adminFormPanelClass,
} from '@/components/admin/AdminUi';
import { StatusBadge } from '@/components/account/ownerUi';

type DecisionOption = {
  id: string;
  decision_number: string;
  title: string;
};

function ratesLabel(
  rates: Record<string, number> | null,
  componentKeys: string[],
  locale: string,
  t: (key: string) => string,
): string {
  if (!rates) return '—';
  const parts = componentKeys.map((key) => {
    const label =
      key === 'day'
        ? t('admin.tcCompDay')
        : key === 'night'
          ? t('admin.tcCompNight')
          : key === 'base'
            ? t('admin.tcCompBase')
            : key;
    return `${label}: ${formatTariffRate(rates[key], locale)}`;
  });
  return parts.join(' · ');
}

function unitLabel(unit: string, t: (key: string) => string) {
  if (unit === 'm2') return t('admin.tcUnitM2');
  if (unit === 'm3') return t('admin.tcUnitM3');
  if (unit === 'kwh') return t('admin.tcUnitKwh');
  return unit;
}

export function AdminTariffs({
  supabase,
  locale,
  staffRole,
  staffActive,
}: {
  supabase: SupabaseClient<Database>;
  locale: string;
  staffRole: string;
  staffActive: boolean;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<TariffTab>('current');
  const [rows, setRows] = useState<TariffListRow[]>([]);
  const [historyTariffId, setHistoryTariffId] = useState<string | null>(null);
  const [history, setHistory] = useState<TariffHistoryRow[]>([]);
  const [decisions, setDecisions] = useState<DecisionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishKey, setPublishKey] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const canSupport = canPublishSupportTariff(staffRole, staffActive);
  const canUtility = canPublishUtilityTariff(staffRole, staffActive);
  const today = sofiaTodayIsoDate();
  const nextYear = sofiaCurrentYear() + 1;

  const [supportForm, setSupportForm] = useState({
    rate: '',
    application_year: String(nextYear),
    basis_mode: 'general_meeting' as 'general_meeting' | 'external_decision',
    decision_id: '',
    basis_reference: '',
    basis_date: '',
    basis_note: '',
  });
  const [waterForm, setWaterForm] = useState({
    rate: '',
    valid_from: today,
    basis_reference: '',
    basis_date: '',
    basis_note: '',
  });
  const [elForm, setElForm] = useState({
    day: '',
    night: '',
    valid_from: today,
    basis_reference: '',
    basis_date: '',
    basis_note: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('list_tariffs', {
        p_module_key: null,
        p_active_only: true,
        p_limit: 50,
      });
      if (rpcErr) {
        if (isMissingRelation(rpcErr, 'list_tariffs') || isMissingRelation(rpcErr, 'tariff_catalog')) {
          setRows([]);
          return;
        }
        throw rpcErr;
      }
      setRows(((data as Record<string, unknown>[] | null) ?? []).map(normalizeTariffListRow));
    } catch (e: unknown) {
      setError(ownerVisibleError(e, t('admin.errGeneric')));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, t]);

  const loadHistory = useCallback(
    async (tariffId: string) => {
      setError(null);
      try {
        const { data, error: rpcErr } = await supabase.rpc('list_tariff_history', {
          p_tariff_id: tariffId,
          p_status: null,
          p_valid_from_from: null,
          p_valid_from_to: null,
          p_cursor_valid_from: null,
          p_cursor_id: null,
          p_limit: 50,
        });
        if (rpcErr) throw rpcErr;
        setHistory(((data as Record<string, unknown>[] | null) ?? []).map(normalizeTariffHistoryRow));
      } catch (e: unknown) {
        setError(ownerVisibleError(e, t('admin.errGeneric')));
        setHistory([]);
      }
    },
    [supabase, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canSupport) return;
    let cancelled = false;
    (async () => {
      const { data, error: qErr } = await supabase
        .from('general_meeting_decisions')
        .select('id, decision_number, title')
        .order('created_at', { ascending: false })
        .limit(100);
      if (cancelled) return;
      if (qErr) {
        if (!isMissingRelation(qErr, 'general_meeting_decisions')) {
          // Non-fatal for publish form; external_decision still works.
        }
        return;
      }
      setDecisions((data as DecisionOption[] | null) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [canSupport, supabase]);

  useEffect(() => {
    if (tab !== 'history' || !historyTariffId) return;
    void loadHistory(historyTariffId);
  }, [tab, historyTariffId, loadHistory]);

  const byKey = useMemo(() => {
    const m = new Map<string, TariffListRow>();
    for (const r of rows) m.set(r.tariff_key, r);
    return m;
  }, [rows]);

  const scheduled = useMemo(
    () => rows.filter((r) => r.nearest_future_version_id != null),
    [rows],
  );

  function basisLabel(basis: string | null) {
    if (basis === 'general_meeting') return t('admin.tcBasisGm');
    if (basis === 'external_decision') return t('admin.tcBasisExternal');
    if (basis === 'supplier_notice') return t('admin.tcBasisSupplier');
    if (basis === 'legacy_import') return t('admin.tcBasisLegacy');
    return basis || '—';
  }

  async function publishSupport(e: React.FormEvent) {
    e.preventDefault();
    const tariff = byKey.get('support_fee');
    if (!tariff || !canSupport) return;
    setBusy(true);
    setError(null);
    try {
      const rate = Number(supportForm.rate);
      if (!(rate > 0)) throw new Error(t('admin.tcErrRate'));
      const year = Number(supportForm.application_year);
      if (!Number.isFinite(year) || year < nextYear) throw new Error(t('admin.tcErrSupportYear'));
      if (!supportForm.basis_note.trim()) throw new Error(t('admin.tcErrBasisNote'));
      if (!supportForm.basis_date) throw new Error(t('admin.tcErrBasisDate'));
      const { error: rpcErr } = await supabase.rpc('publish_tariff_version', {
        p_tariff_id: tariff.tariff_id,
        p_rates: { base: rate },
        p_basis_type: supportForm.basis_mode,
        p_basis_note: supportForm.basis_note.trim(),
        p_idempotency_key: crypto.randomUUID(),
        p_application_year: year,
        p_valid_from: null,
        p_basis_reference:
          supportForm.basis_mode === 'external_decision'
            ? supportForm.basis_reference.trim() || null
            : null,
        p_basis_date: supportForm.basis_date,
        p_decision_id:
          supportForm.basis_mode === 'general_meeting' && supportForm.decision_id
            ? supportForm.decision_id
            : null,
      });
      if (rpcErr) throw rpcErr;
      setPublishKey(null);
      setSupportForm((f) => ({ ...f, rate: '', basis_note: '' }));
      await load();
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function publishWater(e: React.FormEvent) {
    e.preventDefault();
    const tariff = byKey.get('water');
    if (!tariff || !canUtility) return;
    setBusy(true);
    setError(null);
    try {
      const rate = Number(waterForm.rate);
      if (!(rate >= 0) || Number.isNaN(rate)) throw new Error(t('admin.tcErrRate'));
      if (!waterForm.valid_from || waterForm.valid_from < today) throw new Error(t('admin.tcErrValidFrom'));
      if (!waterForm.basis_reference.trim()) throw new Error(t('admin.tcErrSupplierRef'));
      if (!waterForm.basis_note.trim()) throw new Error(t('admin.tcErrBasisNote'));
      const { error: rpcErr } = await supabase.rpc('publish_tariff_version', {
        p_tariff_id: tariff.tariff_id,
        p_rates: { base: rate },
        p_basis_type: 'supplier_notice',
        p_basis_note: waterForm.basis_note.trim(),
        p_idempotency_key: crypto.randomUUID(),
        p_application_year: null,
        p_valid_from: waterForm.valid_from,
        p_basis_reference: waterForm.basis_reference.trim(),
        p_basis_date: waterForm.basis_date || null,
        p_decision_id: null,
      });
      if (rpcErr) throw rpcErr;
      setPublishKey(null);
      setWaterForm((f) => ({ ...f, rate: '', basis_note: '' }));
      await load();
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function publishElectricity(e: React.FormEvent) {
    e.preventDefault();
    const tariff = byKey.get('electricity');
    if (!tariff || !canUtility) return;
    setBusy(true);
    setError(null);
    try {
      const day = Number(elForm.day);
      const night = Number(elForm.night);
      if (Number.isNaN(day) || Number.isNaN(night) || day < 0 || night < 0) {
        throw new Error(t('admin.tcErrRate'));
      }
      if (!elForm.valid_from || elForm.valid_from < today) throw new Error(t('admin.tcErrValidFrom'));
      if (!elForm.basis_reference.trim()) throw new Error(t('admin.tcErrSupplierRef'));
      if (!elForm.basis_note.trim()) throw new Error(t('admin.tcErrBasisNote'));
      const { error: rpcErr } = await supabase.rpc('publish_tariff_version', {
        p_tariff_id: tariff.tariff_id,
        p_rates: { day, night },
        p_basis_type: 'supplier_notice',
        p_basis_note: elForm.basis_note.trim(),
        p_idempotency_key: crypto.randomUUID(),
        p_application_year: null,
        p_valid_from: elForm.valid_from,
        p_basis_reference: elForm.basis_reference.trim(),
        p_basis_date: elForm.basis_date || null,
        p_decision_id: null,
      });
      if (rpcErr) throw rpcErr;
      setPublishKey(null);
      setElForm((f) => ({ ...f, day: '', night: '', basis_note: '' }));
      await load();
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(e: React.FormEvent) {
    e.preventDefault();
    if (!cancelId || !cancelReason.trim()) return;
    if (!confirm(t('admin.tcCancelConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('cancel_future_tariff_version', {
        p_version_id: cancelId,
        p_reason: cancelReason.trim(),
        p_cancellation_idempotency_key: crypto.randomUUID(),
      });
      if (rpcErr) throw rpcErr;
      setCancelId(null);
      setCancelReason('');
      await load();
      if (historyTariffId) await loadHistory(historyTariffId);
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  function renderTariffCard(row: TariffListRow, mode: 'current' | 'future') {
    const versionId = mode === 'current' ? row.current_version_id : row.nearest_future_version_id;
    const validFrom = mode === 'current' ? row.current_valid_from : row.nearest_future_valid_from;
    const rates = mode === 'current' ? row.current_rates : row.nearest_future_rates;
    const basisType = mode === 'current' ? row.current_basis_type : row.nearest_future_basis_type;
    const basisNote = mode === 'current' ? row.current_basis_note : row.nearest_future_basis_note;
    const basisDate = mode === 'current' ? row.current_basis_date : row.nearest_future_basis_date;
    const publishedAt = mode === 'current' ? row.current_published_at : row.nearest_future_published_at;
    const author = mode === 'current' ? row.current_legacy_author : null;
    const appYear = applicationYearFromValidFrom(validFrom);

    return (
      <AdminCard key={`${row.tariff_id}-${mode}`} className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">{row.default_name}</p>
            <p className="text-xs text-muted">
              {unitLabel(row.unit_code, t)} · {row.currency}
            </p>
          </div>
          <StatusBadge
            label={mode === 'current' ? t('admin.tcStatusCurrent') : t('admin.tcStatusScheduled')}
            tone={mode === 'current' ? 'success' : 'info'}
          />
        </div>
        <p className="text-sm text-secondary">
          {ratesLabel(rates, row.component_keys, locale, t)}
        </p>
        <dl className="grid gap-1 text-sm text-secondary sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">
              {row.application_basis === 'billing_year'
                ? t('admin.tcApplicationYear')
                : t('admin.tcValidFrom')}
            </dt>
            <dd>
              {row.application_basis === 'billing_year' && appYear != null
                ? String(appYear)
                : validFrom
                  ? formatOwnerDate(validFrom, locale)
                  : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t('admin.tcBasis')}</dt>
            <dd>{basisLabel(basisType)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t('admin.tcBasisDate')}</dt>
            <dd>{basisDate ? formatOwnerDate(basisDate, locale) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t('admin.tcPublishedAt')}</dt>
            <dd>{publishedAt ? formatOwnerDateTime(publishedAt, locale) : '—'}</dd>
          </div>
        </dl>
        {basisNote ? <p className="whitespace-pre-wrap text-sm text-secondary">{basisNote}</p> : null}
        {author ? (
          <p className="text-xs text-muted">
            {t('admin.tcAuthor')}: {author}
          </p>
        ) : null}
        {mode === 'future' &&
        versionId &&
        canCancelTariffVersionInUi(
          { module_key: row.module_key, status: 'published', valid_from: validFrom ?? '' },
          today,
        ) ? (
          <AdminSecondaryButton
            type="button"
            onClick={() => {
              setCancelId(versionId);
              setCancelReason('');
            }}
          >
            {t('admin.tcCancel')}
          </AdminSecondaryButton>
        ) : null}
        <AdminSecondaryButton
          type="button"
          onClick={() => {
            setHistoryTariffId(row.tariff_id);
            setTab('history');
          }}
        >
          {t('admin.tcOpenHistory')}
        </AdminSecondaryButton>
      </AdminCard>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <AdminPageHeader title={t('admin.tcTitle')} secondary={t('admin.tcLead')} />
      <AdminInlineAlert tone="warning">{t('admin.tcPackage1Note')}</AdminInlineAlert>
      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}

      <AdminTabBar
        tabs={[
          { id: 'current', label: t('admin.tcTabCurrent') },
          { id: 'scheduled', label: t('admin.tcTabScheduled') },
          { id: 'history', label: t('admin.tcTabHistory') },
        ]}
        active={tab}
        onChange={(id) => setTab(id as TariffTab)}
      />

      {cancelId ? (
        <AdminCard className={adminFormPanelClass}>
          <h3 className="text-sm font-semibold text-foreground">{t('admin.tcCancelTitle')}</h3>
          <form onSubmit={handleCancel} className="mt-3 space-y-3">
            <label className="grid gap-1 text-sm text-secondary">
              {t('admin.tcCancelReason')}
              <textarea
                className={adminFieldClass}
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                required
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <AdminPrimaryButton type="submit" disabled={busy || !cancelReason.trim()}>
                {busy ? t('common.saving') : t('admin.tcCancel')}
              </AdminPrimaryButton>
              <AdminSecondaryButton
                type="button"
                onClick={() => {
                  setCancelId(null);
                  setCancelReason('');
                }}
              >
                {t('common.cancel')}
              </AdminSecondaryButton>
            </div>
          </form>
        </AdminCard>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : tab === 'current' ? (
        <div className="space-y-4">
          {rows.length === 0 ? (
            <AdminEmptyState title={t('admin.tcEmpty')} />
          ) : (
            <div className="space-y-3">
              {rows.map((row) =>
                row.current_version_id
                  ? renderTariffCard(row, 'current')
                  : (
                    <AdminCard key={row.tariff_id} className="space-y-2">
                      <p className="text-sm font-semibold text-foreground">{row.default_name}</p>
                      <p className="text-sm text-muted">{t('admin.tcNoCurrentVersion')}</p>
                      {row.tariff_key === 'support_fee' ? (
                        <p className="text-xs text-muted">{t('admin.tcSupportLegacyNote')}</p>
                      ) : null}
                    </AdminCard>
                  ),
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {canSupport ? (
              <AdminPrimaryButton type="button" onClick={() => setPublishKey('support_fee')}>
                {t('admin.tcPublishSupport')}
              </AdminPrimaryButton>
            ) : null}
            {canUtility ? (
              <>
                <AdminPrimaryButton type="button" onClick={() => setPublishKey('water')}>
                  {t('admin.tcPublishWater')}
                </AdminPrimaryButton>
                <AdminPrimaryButton type="button" onClick={() => setPublishKey('electricity')}>
                  {t('admin.tcPublishElectricity')}
                </AdminPrimaryButton>
              </>
            ) : null}
          </div>

          {publishKey === 'support_fee' && canSupport ? (
            <AdminCard className={adminFormPanelClass}>
              <h3 className="text-sm font-semibold text-foreground">{t('admin.tcPublishSupport')}</h3>
              <p className="mt-1 text-xs text-muted">{t('admin.tcSupportFormHint')}</p>
              <form onSubmit={publishSupport} className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm text-secondary">
                  {t('admin.tcNewRate')}
                  <input
                    className={adminFieldClass}
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    value={supportForm.rate}
                    onChange={(e) => setSupportForm({ ...supportForm, rate: e.target.value })}
                    required
                  />
                </label>
                <label className="grid gap-1 text-sm text-secondary">
                  {t('admin.tcApplicationYear')}
                  <input
                    className={adminFieldClass}
                    type="number"
                    min={nextYear}
                    value={supportForm.application_year}
                    onChange={(e) =>
                      setSupportForm({ ...supportForm, application_year: e.target.value })
                    }
                    required
                  />
                </label>
                <label className="grid gap-1 text-sm text-secondary sm:col-span-2">
                  {t('admin.tcBasis')}
                  <select
                    className={adminFieldClass}
                    value={supportForm.basis_mode}
                    onChange={(e) =>
                      setSupportForm({
                        ...supportForm,
                        basis_mode: e.target.value as 'general_meeting' | 'external_decision',
                      })
                    }
                  >
                    <option value="general_meeting">{t('admin.tcBasisGm')}</option>
                    <option value="external_decision">{t('admin.tcBasisExternal')}</option>
                  </select>
                </label>
                {supportForm.basis_mode === 'general_meeting' ? (
                  <label className="grid gap-1 text-sm text-secondary sm:col-span-2">
                    {t('admin.tcDecision')}
                    <select
                      className={adminFieldClass}
                      value={supportForm.decision_id}
                      onChange={(e) =>
                        setSupportForm({ ...supportForm, decision_id: e.target.value })
                      }
                      required
                    >
                      <option value="">{t('admin.tcDecisionPick')}</option>
                      {decisions.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.decision_number} · {d.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="grid gap-1 text-sm text-secondary sm:col-span-2">
                    {t('admin.tcBasisReference')}
                    <input
                      className={adminFieldClass}
                      value={supportForm.basis_reference}
                      onChange={(e) =>
                        setSupportForm({ ...supportForm, basis_reference: e.target.value })
                      }
                      required
                    />
                  </label>
                )}
                <label className="grid gap-1 text-sm text-secondary">
                  {t('admin.tcBasisDate')}
                  <input
                    className={adminFieldClass}
                    type="date"
                    value={supportForm.basis_date}
                    onChange={(e) => setSupportForm({ ...supportForm, basis_date: e.target.value })}
                    required
                  />
                </label>
                <label className="grid gap-1 text-sm text-secondary sm:col-span-2">
                  {t('admin.tcBasisNote')}
                  <textarea
                    className={adminFieldClass}
                    rows={3}
                    value={supportForm.basis_note}
                    onChange={(e) => setSupportForm({ ...supportForm, basis_note: e.target.value })}
                    required
                  />
                </label>
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <AdminPrimaryButton type="submit" disabled={busy}>
                    {busy ? t('common.saving') : t('admin.tcPublish')}
                  </AdminPrimaryButton>
                  <AdminSecondaryButton type="button" onClick={() => setPublishKey(null)}>
                    {t('common.cancel')}
                  </AdminSecondaryButton>
                </div>
              </form>
            </AdminCard>
          ) : null}

          {publishKey === 'water' && canUtility ? (
            <AdminCard className={adminFormPanelClass}>
              <h3 className="text-sm font-semibold text-foreground">{t('admin.tcPublishWater')}</h3>
              <form onSubmit={publishWater} className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm text-secondary">
                  {t('admin.tcNewRate')}
                  <input
                    className={adminFieldClass}
                    type="number"
                    step="0.0001"
                    min="0"
                    value={waterForm.rate}
                    onChange={(e) => setWaterForm({ ...waterForm, rate: e.target.value })}
                    required
                  />
                </label>
                <label className="grid gap-1 text-sm text-secondary">
                  {t('admin.tcValidFrom')}
                  <input
                    className={adminFieldClass}
                    type="date"
                    min={today}
                    value={waterForm.valid_from}
                    onChange={(e) => setWaterForm({ ...waterForm, valid_from: e.target.value })}
                    required
                  />
                </label>
                <label className="grid gap-1 text-sm text-secondary">
                  {t('admin.tcSupplierRef')}
                  <input
                    className={adminFieldClass}
                    value={waterForm.basis_reference}
                    onChange={(e) =>
                      setWaterForm({ ...waterForm, basis_reference: e.target.value })
                    }
                    required
                  />
                </label>
                <label className="grid gap-1 text-sm text-secondary">
                  {t('admin.tcBasisDate')}
                  <input
                    className={adminFieldClass}
                    type="date"
                    value={waterForm.basis_date}
                    onChange={(e) => setWaterForm({ ...waterForm, basis_date: e.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-sm text-secondary sm:col-span-2">
                  {t('admin.tcBasisNote')}
                  <textarea
                    className={adminFieldClass}
                    rows={3}
                    value={waterForm.basis_note}
                    onChange={(e) => setWaterForm({ ...waterForm, basis_note: e.target.value })}
                    required
                  />
                </label>
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <AdminPrimaryButton type="submit" disabled={busy}>
                    {busy ? t('common.saving') : t('admin.tcPublish')}
                  </AdminPrimaryButton>
                  <AdminSecondaryButton type="button" onClick={() => setPublishKey(null)}>
                    {t('common.cancel')}
                  </AdminSecondaryButton>
                </div>
              </form>
            </AdminCard>
          ) : null}

          {publishKey === 'electricity' && canUtility ? (
            <AdminCard className={adminFormPanelClass}>
              <h3 className="text-sm font-semibold text-foreground">{t('admin.tcPublishElectricity')}</h3>
              <form onSubmit={publishElectricity} className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm text-secondary">
                  {t('admin.tcCompDay')}
                  <input
                    className={adminFieldClass}
                    type="number"
                    step="0.0001"
                    min="0"
                    value={elForm.day}
                    onChange={(e) => setElForm({ ...elForm, day: e.target.value })}
                    required
                  />
                </label>
                <label className="grid gap-1 text-sm text-secondary">
                  {t('admin.tcCompNight')}
                  <input
                    className={adminFieldClass}
                    type="number"
                    step="0.0001"
                    min="0"
                    value={elForm.night}
                    onChange={(e) => setElForm({ ...elForm, night: e.target.value })}
                    required
                  />
                </label>
                <label className="grid gap-1 text-sm text-secondary">
                  {t('admin.tcValidFrom')}
                  <input
                    className={adminFieldClass}
                    type="date"
                    min={today}
                    value={elForm.valid_from}
                    onChange={(e) => setElForm({ ...elForm, valid_from: e.target.value })}
                    required
                  />
                </label>
                <label className="grid gap-1 text-sm text-secondary">
                  {t('admin.tcSupplierRef')}
                  <input
                    className={adminFieldClass}
                    value={elForm.basis_reference}
                    onChange={(e) => setElForm({ ...elForm, basis_reference: e.target.value })}
                    required
                  />
                </label>
                <label className="grid gap-1 text-sm text-secondary">
                  {t('admin.tcBasisDate')}
                  <input
                    className={adminFieldClass}
                    type="date"
                    value={elForm.basis_date}
                    onChange={(e) => setElForm({ ...elForm, basis_date: e.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-sm text-secondary sm:col-span-2">
                  {t('admin.tcBasisNote')}
                  <textarea
                    className={adminFieldClass}
                    rows={3}
                    value={elForm.basis_note}
                    onChange={(e) => setElForm({ ...elForm, basis_note: e.target.value })}
                    required
                  />
                </label>
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <AdminPrimaryButton type="submit" disabled={busy}>
                    {busy ? t('common.saving') : t('admin.tcPublish')}
                  </AdminPrimaryButton>
                  <AdminSecondaryButton type="button" onClick={() => setPublishKey(null)}>
                    {t('common.cancel')}
                  </AdminSecondaryButton>
                </div>
              </form>
            </AdminCard>
          ) : null}
        </div>
      ) : tab === 'scheduled' ? (
        scheduled.length === 0 ? (
          <AdminEmptyState title={t('admin.tcScheduledEmpty')} />
        ) : (
          <div className="space-y-3">{scheduled.map((row) => renderTariffCard(row, 'future'))}</div>
        )
      ) : (
        <div className="space-y-3">
          <label className="grid max-w-md gap-1 text-sm text-secondary">
            {t('admin.tcHistoryPick')}
            <select
              className={adminFieldClass}
              value={historyTariffId ?? ''}
              onChange={(e) => setHistoryTariffId(e.target.value || null)}
            >
              <option value="">{t('admin.tcHistoryPick')}</option>
              {rows.map((r) => (
                <option key={r.tariff_id} value={r.tariff_id}>
                  {r.default_name}
                </option>
              ))}
            </select>
          </label>
          {!historyTariffId ? (
            <AdminEmptyState title={t('admin.tcHistoryPick')} />
          ) : history.length === 0 ? (
            <AdminEmptyState title={t('admin.tcHistoryEmpty')} />
          ) : (
            history.map((h) => {
              const tariff = rows.find((r) => r.tariff_id === h.tariff_id);
              const cancellable =
                tariff != null &&
                canCancelTariffVersionInUi(
                  {
                    module_key: tariff.module_key,
                    status: h.status,
                    valid_from: h.valid_from,
                  },
                  today,
                );
              return (
                <AdminCard key={h.version_id} className="space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">
                      {formatOwnerDate(h.valid_from, locale)}
                    </p>
                    <StatusBadge
                      label={
                        h.status === 'cancelled'
                          ? t('admin.tcStatusCancelled')
                          : t('admin.tcStatusPublished')
                      }
                      tone={h.status === 'cancelled' ? 'danger' : 'success'}
                    />
                  </div>
                  <p className="text-sm text-secondary">
                    {ratesLabel(h.rates, tariff?.component_keys ?? Object.keys(h.rates ?? {}), locale, t)}
                  </p>
                  <p className="text-xs text-muted">
                    {basisLabel(h.basis_type)}
                    {h.published_at ? ` · ${formatOwnerDateTime(h.published_at, locale)}` : ''}
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-secondary">{h.basis_note}</p>
                  {h.status === 'cancelled' && h.cancellation_reason ? (
                    <p className="text-sm text-danger">
                      {t('admin.tcCancelReason')}: {h.cancellation_reason}
                    </p>
                  ) : null}
                  {cancellable ? (
                    <AdminSecondaryButton
                      type="button"
                      onClick={() => {
                        setCancelId(h.version_id);
                        setCancelReason('');
                      }}
                    >
                      {t('admin.tcCancel')}
                    </AdminSecondaryButton>
                  ) : null}
                </AdminCard>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
