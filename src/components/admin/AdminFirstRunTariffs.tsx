'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import {
  adminBtnPrimaryClass,
  adminBtnSecondaryClass,
  adminFieldClass,
} from '@/components/admin/AdminUi';
import {
  isFirstRunTariffPublished,
  missingFirstRunTariffs,
  requiredFirstRunTariffKeys,
  type FirstRunTariffKey,
  type MetersSelection,
} from '@/lib/firstRun';
import { ownerVisibleError } from '@/lib/ownerError';
import {
  normalizeTariffListRow,
  sofiaCurrentYear,
  sofiaTodayIsoDate,
  type TariffListRow,
} from '@/lib/tariffs';

type UntypedRpc = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

function untyped(supabase: SupabaseClient<Database>): UntypedRpc {
  return supabase as unknown as UntypedRpc;
}

type AnnualForm = {
  rate: string;
  rate_legal: string;
  application_year: string;
  basis_mode: 'external_decision' | 'general_meeting';
  decision_id: string;
  basis_reference: string;
  basis_date: string;
  basis_note: string;
};

type UtilityForm = {
  rate: string;
  rate_legal: string;
  day: string;
  night: string;
  day_legal: string;
  night_legal: string;
  valid_from: string;
  basis_reference: string;
  basis_date: string;
  basis_note: string;
};

type DecisionOption = { id: string; decision_number: string; title: string };

function labelKey(key: FirstRunTariffKey): string {
  switch (key) {
    case 'water':
      return 'admin.firstRunTariffWater';
    case 'electricity':
      return 'admin.firstRunTariffElectricity';
    case 'support_fee':
      return 'admin.firstRunTariffSupportFee';
    case 'capital_repair':
      return 'admin.firstRunTariffCapitalRepair';
  }
}

export function AdminFirstRunTariffs({
  supabase,
  t,
  selection,
  busy,
  onBusy,
  onContinue,
}: {
  supabase: SupabaseClient<Database>;
  t: (key: string) => string;
  selection: MetersSelection;
  busy: boolean;
  onBusy: (v: boolean) => void;
  onContinue: () => Promise<void>;
}) {
  const today = sofiaTodayIsoDate();
  const currentYear = sofiaCurrentYear();
  const nextYear = currentYear + 1;
  const required = useMemo(() => requiredFirstRunTariffKeys(selection), [selection]);

  const [rows, setRows] = useState<TariffListRow[]>([]);
  const [decisions, setDecisions] = useState<DecisionOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [annual, setAnnual] = useState<AnnualForm>({
    rate: '',
    rate_legal: '',
    application_year: String(nextYear),
    basis_mode: 'external_decision',
    decision_id: '',
    basis_reference: '',
    basis_date: today,
    basis_note: '',
  });
  const [utility, setUtility] = useState<UtilityForm>({
    rate: '',
    rate_legal: '',
    day: '',
    night: '',
    day_legal: '',
    night_legal: '',
    valid_from: today,
    basis_reference: '',
    basis_date: today,
    basis_note: '',
  });

  const load = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await untyped(supabase).rpc('list_tariffs', {
      p_module_key: null,
      p_active_only: true,
      p_limit: 50,
    });
    if (error) {
      setLoadError(ownerVisibleError(error, t('admin.errGeneric')));
      setRows([]);
      return;
    }
    const list = Array.isArray(data)
      ? (data as Record<string, unknown>[]).map((r) => normalizeTariffListRow(r))
      : [];
    setRows(list);

    try {
      const { data: dec } = await supabase
        .from('general_meeting_decisions')
        .select('id, decision_number, title')
        .order('decision_number', { ascending: false })
        .limit(50);
      setDecisions(
        ((dec as DecisionOption[] | null) ?? []).map((d) => ({
          id: String(d.id),
          decision_number: String(d.decision_number ?? ''),
          title: String(d.title ?? ''),
        })),
      );
    } catch {
      setDecisions([]);
    }
  }, [supabase, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const byKey = useMemo(() => {
    const m = new Map<string, TariffListRow>();
    for (const r of rows) m.set(r.tariff_key, r);
    return m;
  }, [rows]);

  const missing = useMemo(() => missingFirstRunTariffs(required, rows), [required, rows]);
  const allReady = missing.length === 0 && rows.length > 0;

  const activeKey: FirstRunTariffKey | null = useMemo(() => {
    if (allReady) return null;
    const pending = required.filter((k) => !isFirstRunTariffPublished(byKey.get(k)));
    return pending[0] ?? null;
  }, [allReady, required, byKey]);

  useEffect(() => {
    if (!activeKey) return;
    if (activeKey === 'capital_repair') {
      setAnnual((f) => ({ ...f, application_year: String(currentYear), basis_mode: 'external_decision' }));
    } else if (activeKey === 'support_fee') {
      setAnnual((f) => ({ ...f, application_year: String(nextYear), basis_mode: 'external_decision' }));
    }
  }, [activeKey, currentYear, nextYear]);

  async function publishActive(e: React.FormEvent) {
    e.preventDefault();
    if (!activeKey) return;
    const tariff = byKey.get(activeKey);
    if (!tariff) {
      setFormError(t('admin.firstRunTariffCatalogMissing'));
      return;
    }
    onBusy(true);
    setFormError(null);
    setNote(null);
    try {
      if (activeKey === 'support_fee' || activeKey === 'capital_repair') {
        const rate = Number(annual.rate);
        const rateLegal = Number(annual.rate_legal.trim() || annual.rate);
        if (!(rate > 0) || !(rateLegal > 0)) throw new Error(t('admin.tcErrRate'));
        const year = Number(annual.application_year);
        const minYear = activeKey === 'capital_repair' ? currentYear : nextYear;
        if (!Number.isFinite(year) || year < minYear) throw new Error(t('admin.tcErrSupportYear'));
        if (!annual.basis_note.trim()) throw new Error(t('admin.tcErrBasisNote'));
        if (!annual.basis_date) throw new Error(t('admin.tcErrBasisDate'));
        if (annual.basis_mode === 'external_decision' && !annual.basis_reference.trim()) {
          throw new Error(t('admin.tcErrSupplierRef'));
        }
        if (annual.basis_mode === 'general_meeting' && !annual.decision_id) {
          throw new Error(t('admin.tcDecisionPick'));
        }
        const { error } = await untyped(supabase).rpc('publish_tariff_version', {
          p_tariff_id: tariff.tariff_id,
          p_rates: { natural: { base: rate }, legal: { base: rateLegal } },
          p_basis_type: annual.basis_mode,
          p_basis_note: annual.basis_note.trim(),
          p_idempotency_key: crypto.randomUUID(),
          p_application_year: year,
          p_valid_from: null,
          p_basis_reference:
            annual.basis_mode === 'external_decision' ? annual.basis_reference.trim() : null,
          p_basis_date: annual.basis_date,
          p_decision_id:
            annual.basis_mode === 'general_meeting' && annual.decision_id
              ? annual.decision_id
              : null,
        });
        if (error) throw error;
      } else if (activeKey === 'water') {
        const rate = Number(utility.rate);
        const rateLegal = Number(utility.rate_legal.trim() || utility.rate);
        if (!(rate >= 0) || Number.isNaN(rate) || !(rateLegal >= 0) || Number.isNaN(rateLegal)) {
          throw new Error(t('admin.tcErrRate'));
        }
        if (!utility.valid_from || utility.valid_from < today) throw new Error(t('admin.tcErrValidFrom'));
        if (!utility.basis_reference.trim()) throw new Error(t('admin.tcErrSupplierRef'));
        if (!utility.basis_note.trim()) throw new Error(t('admin.tcErrBasisNote'));
        const { error } = await untyped(supabase).rpc('publish_tariff_version', {
          p_tariff_id: tariff.tariff_id,
          p_rates: { natural: { base: rate }, legal: { base: rateLegal } },
          p_basis_type: 'supplier_notice',
          p_basis_note: utility.basis_note.trim(),
          p_idempotency_key: crypto.randomUUID(),
          p_application_year: null,
          p_valid_from: utility.valid_from,
          p_basis_reference: utility.basis_reference.trim(),
          p_basis_date: utility.basis_date || null,
          p_decision_id: null,
        });
        if (error) throw error;
      } else {
        const day = Number(utility.day);
        const night = Number(utility.night);
        const dayLegal = Number(utility.day_legal.trim() || utility.day);
        const nightLegal = Number(utility.night_legal.trim() || utility.night);
        if (
          Number.isNaN(day) ||
          Number.isNaN(night) ||
          day < 0 ||
          night < 0 ||
          Number.isNaN(dayLegal) ||
          Number.isNaN(nightLegal) ||
          dayLegal < 0 ||
          nightLegal < 0
        ) {
          throw new Error(t('admin.tcErrRate'));
        }
        if (!utility.valid_from || utility.valid_from < today) throw new Error(t('admin.tcErrValidFrom'));
        if (!utility.basis_reference.trim()) throw new Error(t('admin.tcErrSupplierRef'));
        if (!utility.basis_note.trim()) throw new Error(t('admin.tcErrBasisNote'));
        const { error } = await untyped(supabase).rpc('publish_tariff_version', {
          p_tariff_id: tariff.tariff_id,
          p_rates: {
            natural: { day, night },
            legal: { day: dayLegal, night: nightLegal },
          },
          p_basis_type: 'supplier_notice',
          p_basis_note: utility.basis_note.trim(),
          p_idempotency_key: crypto.randomUUID(),
          p_application_year: null,
          p_valid_from: utility.valid_from,
          p_basis_reference: utility.basis_reference.trim(),
          p_basis_date: utility.basis_date || null,
          p_decision_id: null,
        });
        if (error) throw error;
      }
      setNote(t('admin.firstRunTariffPublished'));
      setAnnual((f) => ({ ...f, rate: '', rate_legal: '', basis_note: '', basis_reference: '' }));
      setUtility((f) => ({
        ...f,
        rate: '',
        rate_legal: '',
        day: '',
        night: '',
        day_legal: '',
        night_legal: '',
        basis_note: '',
        basis_reference: '',
      }));
      await load();
    } catch (err: unknown) {
      setFormError(ownerVisibleError(err, t('admin.errGeneric')));
    } finally {
      onBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">{t('admin.firstRunTariffsLead')}</p>
      <p className="text-xs text-muted">{t('admin.firstRunTariffsNoCharge')}</p>

      <ul className="grid gap-2 sm:grid-cols-2">
        {required.map((key) => {
          const row = byKey.get(key);
          const ok = isFirstRunTariffPublished(row);
          return (
            <li
              key={key}
              className={`rounded-lg border px-3 py-2 text-sm ${
                ok ? 'border-border bg-surface-secondary/40' : 'border-border'
              }`}
            >
              <div className="font-medium text-foreground">{t(labelKey(key))}</div>
              <div className="mt-1 text-xs text-secondary">
                {ok
                  ? t('admin.firstRunTariffStatusPublished')
                      .replace(
                        '{from}',
                        row?.current_valid_from ?? row?.nearest_future_valid_from ?? '—',
                      )
                      .replace(
                        '{basis}',
                        [
                          row?.current_basis_type ?? row?.nearest_future_basis_type,
                          row?.current_basis_date ?? row?.nearest_future_basis_date,
                          row?.current_basis_note ?? row?.nearest_future_basis_note,
                        ]
                          .filter((x) => x != null && String(x).trim().length > 0)
                          .join(' · ') || '—',
                      )
                  : t('admin.firstRunTariffStatusMissing')}
              </div>
            </li>
          );
        })}
      </ul>

      {loadError ? <p className="text-xs text-danger">{loadError}</p> : null}

      {activeKey ? (
        <form onSubmit={(e) => void publishActive(e)} className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <p className="text-sm font-semibold text-foreground sm:col-span-2">
            {t('admin.firstRunTariffConfigure').replace('{name}', t(labelKey(activeKey)))}
          </p>

          {activeKey === 'support_fee' || activeKey === 'capital_repair' ? (
            <>
              <label className="grid gap-1 text-sm text-secondary">
                {activeKey === 'capital_repair' ? t('admin.tcAnnualAmount') : t('admin.tcNewRate')}
                <span className="text-xs text-muted">{t('admin.tcSubjectNatural')}</span>
                <input
                  className={adminFieldClass}
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={annual.rate}
                  onChange={(e) => setAnnual({ ...annual, rate: e.target.value })}
                  required
                />
              </label>
              <label className="grid gap-1 text-sm text-secondary">
                {activeKey === 'capital_repair' ? t('admin.tcAnnualAmount') : t('admin.tcNewRate')}
                <span className="text-xs text-muted">{t('admin.tcSubjectLegal')}</span>
                <input
                  className={adminFieldClass}
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={annual.rate_legal}
                  onChange={(e) => setAnnual({ ...annual, rate_legal: e.target.value })}
                  placeholder={annual.rate || undefined}
                />
              </label>
              <label className="grid gap-1 text-sm text-secondary">
                {t('admin.tcApplicationYear')}
                <input
                  className={adminFieldClass}
                  type="number"
                  min={activeKey === 'capital_repair' ? currentYear : nextYear}
                  value={annual.application_year}
                  onChange={(e) => setAnnual({ ...annual, application_year: e.target.value })}
                  required
                />
              </label>
              <label className="grid gap-1 text-sm text-secondary sm:col-span-2">
                {t('admin.tcBasis')}
                <select
                  className={adminFieldClass}
                  value={annual.basis_mode}
                  onChange={(e) =>
                    setAnnual({
                      ...annual,
                      basis_mode: e.target.value as AnnualForm['basis_mode'],
                    })
                  }
                >
                  <option value="external_decision">{t('admin.tcBasisExternal')}</option>
                  {decisions.length > 0 ? (
                    <option value="general_meeting">{t('admin.tcBasisGm')}</option>
                  ) : null}
                </select>
              </label>
              {annual.basis_mode === 'general_meeting' && decisions.length > 0 ? (
                <label className="grid gap-1 text-sm text-secondary sm:col-span-2">
                  {t('admin.tcDecision')}
                  <select
                    className={adminFieldClass}
                    value={annual.decision_id}
                    onChange={(e) => setAnnual({ ...annual, decision_id: e.target.value })}
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
                    value={annual.basis_reference}
                    onChange={(e) => setAnnual({ ...annual, basis_reference: e.target.value })}
                    required
                  />
                </label>
              )}
              <label className="grid gap-1 text-sm text-secondary">
                {t('admin.tcBasisDate')}
                <input
                  className={adminFieldClass}
                  type="date"
                  value={annual.basis_date}
                  onChange={(e) => setAnnual({ ...annual, basis_date: e.target.value })}
                  required
                />
              </label>
              <label className="grid gap-1 text-sm text-secondary sm:col-span-2">
                {t('admin.tcBasisNote')}
                <input
                  className={adminFieldClass}
                  value={annual.basis_note}
                  onChange={(e) => setAnnual({ ...annual, basis_note: e.target.value })}
                  required
                />
              </label>
            </>
          ) : null}

          {activeKey === 'water' ? (
            <>
              <label className="grid gap-1 text-sm text-secondary">
                {t('admin.tcNewRate')}
                <span className="text-xs text-muted">{t('admin.tcSubjectNatural')}</span>
                <input
                  className={adminFieldClass}
                  type="number"
                  step="0.0001"
                  min="0"
                  value={utility.rate}
                  onChange={(e) => setUtility({ ...utility, rate: e.target.value })}
                  required
                />
              </label>
              <label className="grid gap-1 text-sm text-secondary">
                {t('admin.tcNewRate')}
                <span className="text-xs text-muted">{t('admin.tcSubjectLegal')}</span>
                <input
                  className={adminFieldClass}
                  type="number"
                  step="0.0001"
                  min="0"
                  value={utility.rate_legal}
                  onChange={(e) => setUtility({ ...utility, rate_legal: e.target.value })}
                  placeholder={utility.rate || undefined}
                />
              </label>
            </>
          ) : null}

          {activeKey === 'electricity' ? (
            <>
              <label className="grid gap-1 text-sm text-secondary">
                {t('admin.tcCompDay')}
                <span className="text-xs text-muted">{t('admin.tcSubjectNatural')}</span>
                <input
                  className={adminFieldClass}
                  type="number"
                  step="0.0001"
                  min="0"
                  value={utility.day}
                  onChange={(e) => setUtility({ ...utility, day: e.target.value })}
                  required
                />
              </label>
              <label className="grid gap-1 text-sm text-secondary">
                {t('admin.tcCompNight')}
                <span className="text-xs text-muted">{t('admin.tcSubjectNatural')}</span>
                <input
                  className={adminFieldClass}
                  type="number"
                  step="0.0001"
                  min="0"
                  value={utility.night}
                  onChange={(e) => setUtility({ ...utility, night: e.target.value })}
                  required
                />
              </label>
              <label className="grid gap-1 text-sm text-secondary">
                {t('admin.tcCompDay')}
                <span className="text-xs text-muted">{t('admin.tcSubjectLegal')}</span>
                <input
                  className={adminFieldClass}
                  type="number"
                  step="0.0001"
                  min="0"
                  value={utility.day_legal}
                  onChange={(e) => setUtility({ ...utility, day_legal: e.target.value })}
                  placeholder={utility.day || undefined}
                />
              </label>
              <label className="grid gap-1 text-sm text-secondary">
                {t('admin.tcCompNight')}
                <span className="text-xs text-muted">{t('admin.tcSubjectLegal')}</span>
                <input
                  className={adminFieldClass}
                  type="number"
                  step="0.0001"
                  min="0"
                  value={utility.night_legal}
                  onChange={(e) => setUtility({ ...utility, night_legal: e.target.value })}
                  placeholder={utility.night || undefined}
                />
              </label>
            </>
          ) : null}

          {activeKey === 'water' || activeKey === 'electricity' ? (
            <>
              <label className="grid gap-1 text-sm text-secondary">
                {t('admin.tcValidFrom')}
                <input
                  className={adminFieldClass}
                  type="date"
                  min={today}
                  value={utility.valid_from}
                  onChange={(e) => setUtility({ ...utility, valid_from: e.target.value })}
                  required
                />
              </label>
              <label className="grid gap-1 text-sm text-secondary">
                {t('admin.tcSupplierRef')}
                <input
                  className={adminFieldClass}
                  value={utility.basis_reference}
                  onChange={(e) => setUtility({ ...utility, basis_reference: e.target.value })}
                  required
                />
              </label>
              <label className="grid gap-1 text-sm text-secondary">
                {t('admin.tcBasisDate')}
                <input
                  className={adminFieldClass}
                  type="date"
                  value={utility.basis_date}
                  onChange={(e) => setUtility({ ...utility, basis_date: e.target.value })}
                />
              </label>
              <label className="grid gap-1 text-sm text-secondary sm:col-span-2">
                {t('admin.tcBasisNote')}
                <input
                  className={adminFieldClass}
                  value={utility.basis_note}
                  onChange={(e) => setUtility({ ...utility, basis_note: e.target.value })}
                  required
                />
              </label>
            </>
          ) : null}

          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" className={adminBtnPrimaryClass} disabled={busy}>
              {busy ? t('admin.firstRunBusy') : t('admin.tcPublish')}
            </button>
            <button
              type="button"
              className={adminBtnSecondaryClass}
              disabled={busy}
              onClick={() => void load()}
            >
              {t('admin.firstRunTariffRefresh')}
            </button>
          </div>
        </form>
      ) : null}

      {formError ? <p className="text-xs text-danger">{formError}</p> : null}
      {note ? <p className="text-xs text-secondary">{note}</p> : null}

      {allReady ? (
        <div className="border-t border-border pt-4">
          <p className="mb-3 text-sm text-secondary">{t('admin.firstRunTariffsReady')}</p>
          <button
            type="button"
            className={adminBtnPrimaryClass}
            disabled={busy}
            onClick={() => void onContinue()}
          >
            {busy ? t('admin.firstRunBusy') : t('admin.firstRunTariffsContinue')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
