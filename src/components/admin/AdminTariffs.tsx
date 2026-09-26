'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
} from '@/components/admin/AdminUi';
import { StatusBadge } from '@/components/account/ownerUi';

type DecisionOption = {
  id: string;
  decision_number: string;
  title: string;
};

function unitSuffix(unit: string, t: (key: string) => string) {
  if (unit === 'm2') return `€/${t('admin.tcUnitM2')}`;
  if (unit === 'm3') return `€/${t('admin.tcUnitM3')}`;
  if (unit === 'kwh') return `€/${t('admin.tcUnitKwh')}`;
  return unit;
}

function RatesDisplay({
  rates,
  componentKeys,
  locale,
  t,
  empty = false,
}: {
  rates: Record<string, number> | null;
  componentKeys: string[];
  locale: string;
  t: (key: string) => string;
  empty?: boolean;
}) {
  if (empty || !rates) {
    return <p className="text-3xl font-semibold tabular-nums text-foreground">—</p>;
  }

  const isDual = componentKeys.includes('day') || componentKeys.includes('night');
  if (isDual) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-surface-secondary/40 px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('admin.tcCompDay')}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {formatTariffRate(rates.day, locale)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface-secondary/40 px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('admin.tcCompNight')}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {formatTariffRate(rates.night, locale)}
          </p>
        </div>
      </div>
    );
  }

  const key = componentKeys[0] ?? 'base';
  return (
    <p className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
      {formatTariffRate(rates[key], locale)}
    </p>
  );
}

function basisLabel(basis: string | null, t: (key: string) => string) {
  if (basis === 'general_meeting') return t('admin.tcBasisGm');
  if (basis === 'external_decision') return t('admin.tcBasisExternal');
  if (basis === 'supplier_notice') return t('admin.tcBasisSupplier');
  if (basis === 'legacy_import') return t('admin.tcBasisLegacy');
  return basis || '—';
}

function canPublishRow(row: TariffListRow, canSupport: boolean, canUtility: boolean): boolean {
  if (row.tariff_key === 'support_fee' || row.tariff_key === 'capital_repair') return canSupport;
  if (row.tariff_key === 'water' || row.tariff_key === 'electricity') return canUtility;
  return false;
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
    basis_date: today,
    basis_note: '',
  });
  const [waterForm, setWaterForm] = useState({
    rate: '',
    valid_from: today,
    basis_reference: '',
    basis_date: today,
    basis_note: '',
  });
  const [elForm, setElForm] = useState({
    day: '',
    night: '',
    valid_from: today,
    basis_reference: '',
    basis_date: today,
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
      if (cancelled || qErr) return;
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

  async function publishAnnualRate(e: React.FormEvent, tariffKey: 'support_fee' | 'capital_repair') {
    e.preventDefault();
    const tariff = byKey.get(tariffKey);
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

  async function publishSupport(e: React.FormEvent) {
    return publishAnnualRate(e, 'support_fee');
  }

  async function publishCapital(e: React.FormEvent) {
    return publishAnnualRate(e, 'capital_repair');
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

  function openPublish(key: string) {
    setPublishKey((prev) => (prev === key ? null : key));
    setCancelId(null);
  }

  function openHistory(tariffId: string) {
    setHistoryTariffId(tariffId);
    setPublishKey(null);
    setTab('history');
  }

  function renderPublishForm(key: string): ReactNode {
    if ((key === 'support_fee' || key === 'capital_repair') && canSupport) {
      const onSubmit = key === 'capital_repair' ? publishCapital : publishSupport;
      return (
        <form onSubmit={onSubmit} className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <p className="text-sm font-semibold text-foreground sm:col-span-2">{t('admin.tcChangeRate')}</p>
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
              onChange={(e) => setSupportForm({ ...supportForm, application_year: e.target.value })}
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
                onChange={(e) => setSupportForm({ ...supportForm, decision_id: e.target.value })}
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
                onChange={(e) => setSupportForm({ ...supportForm, basis_reference: e.target.value })}
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
            <input
              className={adminFieldClass}
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
      );
    }

    if (key === 'water' && canUtility) {
      return (
        <form onSubmit={publishWater} className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <p className="text-sm font-semibold text-foreground sm:col-span-2">{t('admin.tcChangeRate')}</p>
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
              onChange={(e) => setWaterForm({ ...waterForm, basis_reference: e.target.value })}
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
            <input
              className={adminFieldClass}
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
      );
    }

    if (key === 'electricity' && canUtility) {
      return (
        <form onSubmit={publishElectricity} className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <p className="text-sm font-semibold text-foreground sm:col-span-2">{t('admin.tcChangeRate')}</p>
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
            <input
              className={adminFieldClass}
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
      );
    }

    return null;
  }

  function renderCurrentCard(row: TariffListRow) {
    const hasCurrent = row.current_version_id != null;
    const appYear = applicationYearFromValidFrom(row.current_valid_from);
    const when =
      row.application_basis === 'billing_year' && appYear != null
        ? String(appYear)
        : row.current_valid_from
          ? formatOwnerDate(row.current_valid_from, locale)
          : null;
    const publishable = canPublishRow(row, canSupport, canUtility);
    const editing = publishKey === row.tariff_key;
    const future = row.nearest_future_version_id != null;

    return (
      <AdminCard
        key={row.tariff_id}
        className={`flex flex-col gap-4 ${editing ? 'sm:col-span-2 xl:col-span-3 border-accent/30' : 'h-full'}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{row.default_name}</p>
            <p className="mt-0.5 text-xs text-muted">{unitSuffix(row.unit_code, t)}</p>
          </div>
          <StatusBadge
            label={hasCurrent ? t('admin.tcStatusCurrent') : t('admin.tcStatusMissing')}
            tone={hasCurrent ? 'success' : 'warning'}
          />
        </div>

        <RatesDisplay
          rates={row.current_rates}
          componentKeys={row.component_keys}
          locale={locale}
          t={t}
          empty={!hasCurrent}
        />

        <div className="space-y-1 text-sm text-secondary">
          {when ? (
            <p>
              <span className="text-muted">{t('admin.tcAppliesFrom')}: </span>
              {when}
              {row.application_basis === 'billing_year' ? (
                <span className="text-muted"> · {t('admin.tcYearBasis')}</span>
              ) : null}
            </p>
          ) : (
            <p className="text-muted">{t('admin.tcNoCurrentVersion')}</p>
          )}
          {future ? (
            <p className="text-xs text-accent">
              {t('admin.tcHasScheduled')}:{' '}
              {row.application_basis === 'billing_year' &&
              applicationYearFromValidFrom(row.nearest_future_valid_from) != null
                ? applicationYearFromValidFrom(row.nearest_future_valid_from)
                : row.nearest_future_valid_from
                  ? formatOwnerDate(row.nearest_future_valid_from, locale)
                  : '—'}
            </p>
          ) : null}
        </div>

        {!editing ? (
          <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
            {publishable ? (
              <AdminPrimaryButton type="button" onClick={() => openPublish(row.tariff_key)}>
                {t('admin.tcChangeRate')}
              </AdminPrimaryButton>
            ) : null}
            <AdminSecondaryButton type="button" onClick={() => openHistory(row.tariff_id)}>
              {t('admin.tcOpenHistory')}
            </AdminSecondaryButton>
          </div>
        ) : null}

        {editing ? renderPublishForm(row.tariff_key) : null}
      </AdminCard>
    );
  }

  function renderScheduledCard(row: TariffListRow) {
    const versionId = row.nearest_future_version_id;
    const validFrom = row.nearest_future_valid_from;
    const appYear = applicationYearFromValidFrom(validFrom);
    const when =
      row.application_basis === 'billing_year' && appYear != null
        ? String(appYear)
        : validFrom
          ? formatOwnerDate(validFrom, locale)
          : '—';

    return (
      <AdminCard key={`${row.tariff_id}-future`} className="flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{row.default_name}</p>
            <p className="mt-0.5 text-xs text-muted">{unitSuffix(row.unit_code, t)}</p>
          </div>
          <StatusBadge label={t('admin.tcStatusScheduled')} tone="info" />
        </div>
        <RatesDisplay
          rates={row.nearest_future_rates}
          componentKeys={row.component_keys}
          locale={locale}
          t={t}
        />
        <p className="mt-auto text-sm text-secondary">
          <span className="text-muted">{t('admin.tcAppliesFrom')}: </span>
          {when}
        </p>
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {versionId &&
          canCancelTariffVersionInUi(
            { module_key: row.module_key, status: 'published', valid_from: validFrom ?? '' },
            today,
          ) ? (
            <AdminSecondaryButton
              type="button"
              onClick={() => {
                setCancelId(versionId);
                setCancelReason('');
                setPublishKey(null);
              }}
            >
              {t('admin.tcCancel')}
            </AdminSecondaryButton>
          ) : null}
          <AdminSecondaryButton type="button" onClick={() => openHistory(row.tariff_id)}>
            {t('admin.tcOpenHistory')}
          </AdminSecondaryButton>
        </div>
      </AdminCard>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <AdminPageHeader title={t('admin.tcTitle')} secondary={t('admin.tcLead')} />
      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}

      <AdminTabBar
        tabs={[
          { id: 'current', label: t('admin.tcTabCurrent') },
          { id: 'scheduled', label: t('admin.tcTabScheduled') },
          { id: 'history', label: t('admin.tcTabHistory') },
        ]}
        active={tab}
        onChange={(id) => {
          setTab(id as TariffTab);
          setPublishKey(null);
        }}
      />

      {cancelId ? (
        <AdminCard className="space-y-3 border-accent/20">
          <h3 className="text-sm font-semibold text-foreground">{t('admin.tcCancelTitle')}</h3>
          <form onSubmit={handleCancel} className="space-y-3">
            <label className="grid gap-1 text-sm text-secondary">
              {t('admin.tcCancelReason')}
              <textarea
                className={adminFieldClass}
                rows={2}
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
        rows.length === 0 ? (
          <AdminEmptyState title={t('admin.tcEmpty')} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => renderCurrentCard(row))}
          </div>
        )
      ) : tab === 'scheduled' ? (
        scheduled.length === 0 ? (
          <AdminEmptyState title={t('admin.tcScheduledEmpty')} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {scheduled.map((row) => renderScheduledCard(row))}
          </div>
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
            <div className="space-y-2">
              {history.map((h) => {
                const tariff = rows.find((r) => r.tariff_id === h.tariff_id);
                const keys = tariff?.component_keys ?? Object.keys(h.rates ?? {});
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
                  <AdminCard key={h.version_id} className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <RatesDisplay rates={h.rates} componentKeys={keys} locale={locale} t={t} />
                        <p className="mt-2 text-sm text-secondary">
                          {formatOwnerDate(h.valid_from, locale)}
                          {' · '}
                          {basisLabel(h.basis_type, t)}
                        </p>
                      </div>
                      <StatusBadge
                        label={
                          h.status === 'cancelled'
                            ? t('admin.tcStatusCancelled')
                            : t('admin.tcStatusPublished')
                        }
                        tone={h.status === 'cancelled' ? 'danger' : 'success'}
                      />
                    </div>
                    {h.published_at ? (
                      <p className="text-xs text-muted">{formatOwnerDateTime(h.published_at, locale)}</p>
                    ) : null}
                    {h.status === 'cancelled' && h.cancellation_reason ? (
                      <p className="text-sm text-danger">{h.cancellation_reason}</p>
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
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
