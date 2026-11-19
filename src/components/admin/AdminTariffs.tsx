'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { formatOwnerDate, formatOwnerDateTime } from '@/lib/ownerFormat';
import { isMissingRelation } from '@/lib/polls';
import { ownerVisibleError } from '@/lib/ownerError';
import { useAppConfirm } from '@/components/ui/AppConfirmDialog';
import {
  applicationYearFromValidFrom,
  canCancelTariffVersionInUi,
  canPublishSupportTariff,
  canPublishUtilityTariff,
  capitalRepairAllowedApplicationYears,
  capitalRepairHasCurrentTariff,
  capitalRepairPlannedApplicationYear,
  capitalRepairPublishValidFrom,
  defaultCapitalRepairPublishIntent,
  defaultSupportFeePublishIntent,
  formatTariffRate,
  normalizeTariffHistoryRow,
  normalizeTariffListRow,
  sofiaCurrentYear,
  sofiaTodayIsoDate,
  supportFeeAllowedApplicationYears,
  supportFeeHasCurrentTariff,
  supportFeePlannedApplicationYear,
  supportFeePublishValidFrom,
  validateCapitalRepairPublishInput,
  validateSupportFeePublishInput,
  type CapitalRepairPublishIntent,
  type SupportFeePublishIntent,
  type TariffHistoryRow,
  type TariffListRow,
  parseTariffKey,
  parseTariffTab,
  type TariffTab,
} from '@/lib/tariffs';
import { tariffKeysForModules, type FirstRunTariffKey } from '@/lib/firstRun';
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
import { AdminSupportFeePolicyEditor } from '@/components/admin/AdminSupportFeePolicyEditor';

type DecisionOption = {
  id: string;
  decision_number: string;
  title: string;
};

function unitSuffix(row: Pick<TariffListRow, 'unit_code' | 'tariff_key' | 'calculation_type' | 'billing_period'>, t: (key: string) => string) {
  if (row.tariff_key === 'internet') return t('admin.tcUnitInternet');
  if (row.tariff_key === 'capital_repair' || row.unit_code === 'm2') return t('admin.perSqmYear');
  if (row.unit_code === 'item' && row.billing_period === 'year') return t('admin.tcUnitAptYear');
  if (row.unit_code === 'm3') return `€/${t('admin.tcUnitM3')}`;
  if (row.unit_code === 'kwh') return `€/${t('admin.tcUnitKwh')}`;
  return row.unit_code;
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

  if (componentKeys.includes('package_30') && componentKeys.includes('day')) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-surface-secondary/40 px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('admin.internetTariffPackage30')}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {formatTariffRate(rates.package_30, locale)}
          </p>
          <p className="mt-1 text-xs text-muted">{t('admin.internetTariffCalendarHint')}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface-secondary/40 px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('admin.internetTariffDay24')}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {formatTariffRate(rates.day, locale)}
          </p>
          <p className="mt-1 text-xs text-muted">{t('admin.internetTariffCalendarHint')}</p>
        </div>
      </div>
    );
  }

  if (componentKeys.includes('day') && componentKeys.includes('month')) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-surface-secondary/40 px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('admin.tcCompDay')}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {formatTariffRate(rates.day, locale)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface-secondary/40 px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('admin.tcCompMonth')}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {formatTariffRate(rates.month, locale)}
          </p>
        </div>
      </div>
    );
  }

  if (componentKeys.includes('month') && !componentKeys.includes('day') && !componentKeys.includes('night')) {
    return (
      <p className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
        {formatTariffRate(rates.month, locale)}
        <span className="ml-2 text-sm font-normal text-muted">/ {t('admin.tcCompMonth')}</span>
      </p>
    );
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
  if (row.tariff_key === 'water' || row.tariff_key === 'electricity' || row.tariff_key === 'internet') {
    return canUtility;
  }
  return false;
}

export function AdminTariffs({
  supabase,
  locale,
  staffRole,
  staffActive,
  enabledModules,
  tab: tabRaw,
  onTabChange,
  policyYear: policyYearRaw,
  focusTariffKey: focusTariffKeyRaw,
  returnSearch,
}: {
  supabase: SupabaseClient<Database>;
  locale: string;
  staffRole: string;
  staffActive: boolean;
  /** Installed building modules — tariff cards follow the same keys as first-run. */
  enabledModules?: {
    water?: boolean;
    electricity?: boolean;
    internet?: boolean;
    support_fee?: boolean;
    capital_repair?: boolean;
  };
  /** URL tab when wired from admin shell (`annual_policy` = support-fee yearly policy). */
  tab?: string | null;
  onTabChange?: (tab: TariffTab) => void;
  /** Billing year for «Годовая политика» when opened from SF charges. */
  policyYear?: number | null;
  /** Deep-link highlight / scroll target (`?tariff=water`). */
  focusTariffKey?: string | null;
  /** Encoded prior admin query (`?return=…`) for back to the caller register. */
  returnSearch?: string | null;
}) {
  const focusTariffKey = parseTariffKey(focusTariffKeyRaw);
  const { t } = useI18n();
  const { confirm, dialog } = useAppConfirm(t('common.close'));
  const supportFeeModuleOn = enabledModules?.support_fee !== false;
  const [localTab, setLocalTab] = useState<TariffTab>(() => parseTariffTab(tabRaw));
  const requestedTab = tabRaw != null ? parseTariffTab(tabRaw) : localTab;
  const tab: TariffTab =
    requestedTab === 'annual_policy' && !supportFeeModuleOn ? 'current' : requestedTab;
  function selectTab(next: TariffTab) {
    if (onTabChange) onTabChange(next);
    else setLocalTab(next);
  }
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
  const currentYear = sofiaCurrentYear();
  const nextYear = currentYear + 1;

  const [supportIntent, setSupportIntent] = useState<SupportFeePublishIntent>('activation');
  const [capitalIntent, setCapitalIntent] = useState<CapitalRepairPublishIntent>('activation');
  const [supportForm, setSupportForm] = useState({
    rate: '',
    rate_legal: '',
    application_year: String(nextYear),
    amend_valid_from: today,
    basis_mode: 'general_meeting' as 'general_meeting' | 'external_decision',
    decision_id: '',
    basis_reference: '',
    basis_date: today,
    basis_note: '',
  });
  const [waterForm, setWaterForm] = useState({
    rate: '',
    rate_legal: '',
    valid_from: today,
    basis_reference: '',
    basis_date: today,
    basis_note: '',
  });
  const [elForm, setElForm] = useState({
    day: '',
    night: '',
    day_legal: '',
    night_legal: '',
    valid_from: today,
    basis_reference: '',
    basis_date: today,
    basis_note: '',
  });
  const [internetForm, setInternetForm] = useState({
    package_30: '',
    day: '',
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

  const allowedTariffKeys = useMemo(() => {
    // Explicit map from admin page: only installed modules. Omitted prop → show all known keys.
    const flags = enabledModules
      ? {
          water: enabledModules.water === true,
          electricity: enabledModules.electricity === true,
          internet: enabledModules.internet === true,
          support_fee: enabledModules.support_fee !== false,
          capital_repair: enabledModules.capital_repair !== false,
        }
      : {
          water: true,
          electricity: true,
          internet: true,
          support_fee: true,
          capital_repair: true,
        };
    return new Set<FirstRunTariffKey>(tariffKeysForModules(flags));
  }, [enabledModules]);

  const visibleRows = useMemo(() => {
    const filtered = rows.filter((r) => allowedTariffKeys.has(r.tariff_key as FirstRunTariffKey));
    if (!focusTariffKey) return filtered;
    return [...filtered].sort((a, b) => {
      if (a.tariff_key === focusTariffKey) return -1;
      if (b.tariff_key === focusTariffKey) return 1;
      return 0;
    });
  }, [rows, allowedTariffKeys, focusTariffKey]);

  useEffect(() => {
    if (!focusTariffKey || loading || tab !== 'current') return;
    const el = document.getElementById(`tariff-card-${focusTariffKey}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
  }, [focusTariffKey, loading, tab, visibleRows]);

  const byKey = useMemo(() => {
    const m = new Map<string, TariffListRow>();
    for (const r of visibleRows) m.set(r.tariff_key, r);
    return m;
  }, [visibleRows]);

  const scheduled = useMemo(
    () => visibleRows.filter((r) => r.nearest_future_version_id != null),
    [visibleRows],
  );

  async function publishSupport(e: React.FormEvent) {
    e.preventDefault();
    const tariff = byKey.get('support_fee');
    if (!tariff || !canSupport) return;
    setBusy(true);
    setError(null);
    try {
      const rate = Number(supportForm.rate);
      const rateLegal = Number(supportForm.rate_legal.trim() || supportForm.rate);
      if (!(rate > 0) || !(rateLegal > 0)) throw new Error(t('admin.tcErrRate'));
      const year = Number(supportForm.application_year);
      const validation = validateSupportFeePublishInput({
        intent: supportIntent,
        applicationYear: year,
        validFrom: supportForm.amend_valid_from,
        hasCurrentTariff: supportFeeHasCurrentTariff(tariff),
        todayIso: today,
      });
      if (!validation.ok) throw new Error(t(validation.errorKey));
      if (!supportForm.basis_note.trim()) throw new Error(t('admin.tcErrBasisNote'));
      if (!supportForm.basis_date) throw new Error(t('admin.tcErrBasisDate'));
      const { error: rpcErr } = await supabase.rpc('publish_tariff_version', {
        p_tariff_id: tariff.tariff_id,
        p_rates: { natural: { base: rate }, legal: { base: rateLegal } },
        p_basis_type: supportForm.basis_mode,
        p_basis_note: supportForm.basis_note.trim(),
        p_idempotency_key: crypto.randomUUID(),
        p_application_year: year,
        p_valid_from: supportFeePublishValidFrom({
          intent: supportIntent,
          applicationYear: year,
          amendValidFrom: supportForm.amend_valid_from,
        }),
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
      setSupportForm((f) => ({ ...f, rate: '', rate_legal: '', basis_note: '' }));
      await load();
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function publishCapital(e: React.FormEvent) {
    e.preventDefault();
    const tariff = byKey.get('capital_repair');
    if (!tariff || !canSupport) return;
    setBusy(true);
    setError(null);
    try {
      const rate = Number(supportForm.rate);
      const rateLegal = Number(supportForm.rate_legal.trim() || supportForm.rate);
      if (!(rate > 0) || !(rateLegal > 0)) throw new Error(t('admin.tcErrRate'));
      const year = Number(supportForm.application_year);
      const validation = validateCapitalRepairPublishInput({
        intent: capitalIntent,
        applicationYear: year,
        validFrom: supportForm.amend_valid_from,
        hasCurrentTariff: capitalRepairHasCurrentTariff(tariff),
        todayIso: today,
      });
      if (!validation.ok) throw new Error(t(validation.errorKey));
      if (!supportForm.basis_note.trim()) throw new Error(t('admin.tcErrBasisNote'));
      if (!supportForm.basis_date) throw new Error(t('admin.tcErrBasisDate'));
      const { error: rpcErr } = await supabase.rpc('publish_tariff_version', {
        p_tariff_id: tariff.tariff_id,
        p_rates: { natural: { base: rate }, legal: { base: rateLegal } },
        p_basis_type: supportForm.basis_mode,
        p_basis_note: supportForm.basis_note.trim(),
        p_idempotency_key: crypto.randomUUID(),
        p_application_year: year,
        p_valid_from: capitalRepairPublishValidFrom({
          intent: capitalIntent,
          applicationYear: year,
          amendValidFrom: supportForm.amend_valid_from,
        }),
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
      setSupportForm((f) => ({ ...f, rate: '', rate_legal: '', basis_note: '' }));
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
      const rateLegal = Number(waterForm.rate_legal.trim() || waterForm.rate);
      if (!(rate >= 0) || Number.isNaN(rate) || !(rateLegal >= 0) || Number.isNaN(rateLegal)) {
        throw new Error(t('admin.tcErrRate'));
      }
      if (!waterForm.valid_from || waterForm.valid_from < today) throw new Error(t('admin.tcErrValidFrom'));
      if (!waterForm.basis_reference.trim()) throw new Error(t('admin.tcErrSupplierRef'));
      if (!waterForm.basis_note.trim()) throw new Error(t('admin.tcErrBasisNote'));
      const { error: rpcErr } = await supabase.rpc('publish_tariff_version', {
        p_tariff_id: tariff.tariff_id,
        p_rates: { natural: { base: rate }, legal: { base: rateLegal } },
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
      setWaterForm((f) => ({ ...f, rate: '', rate_legal: '', basis_note: '' }));
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
      const dayLegal = Number(elForm.day_legal.trim() || elForm.day);
      const nightLegal = Number(elForm.night_legal.trim() || elForm.night);
      if (
        Number.isNaN(day) || Number.isNaN(night) || day < 0 || night < 0
        || Number.isNaN(dayLegal) || Number.isNaN(nightLegal) || dayLegal < 0 || nightLegal < 0
      ) {
        throw new Error(t('admin.tcErrRate'));
      }
      if (!elForm.valid_from || elForm.valid_from < today) throw new Error(t('admin.tcErrValidFrom'));
      if (!elForm.basis_reference.trim()) throw new Error(t('admin.tcErrSupplierRef'));
      if (!elForm.basis_note.trim()) throw new Error(t('admin.tcErrBasisNote'));
      const { error: rpcErr } = await supabase.rpc('publish_tariff_version', {
        p_tariff_id: tariff.tariff_id,
        p_rates: {
          natural: { day, night },
          legal: { day: dayLegal, night: nightLegal },
        },
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
      setElForm((f) => ({ ...f, day: '', night: '', day_legal: '', night_legal: '', basis_note: '' }));
      await load();
    } catch (err: unknown) {
      setError(ownerVisibleError(err, t('admin.errGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function publishInternet(e: React.FormEvent) {
    e.preventDefault();
    const tariff = byKey.get('internet');
    if (!tariff || !canUtility) return;
    setBusy(true);
    setError(null);
    try {
      const package30 = Number(internetForm.package_30);
      const day = Number(internetForm.day);
      if (Number.isNaN(package30) || package30 < 0 || Number.isNaN(day) || day < 0) {
        throw new Error(t('admin.tcErrRate'));
      }
      if (!internetForm.valid_from || internetForm.valid_from < today) throw new Error(t('admin.tcErrValidFrom'));
      if (!internetForm.basis_reference.trim()) throw new Error(t('admin.tcErrSupplierRef'));
      if (!internetForm.basis_note.trim()) throw new Error(t('admin.tcErrBasisNote'));
      const rates = { package_30: package30, day };
      const { error: assertErr } = await supabase.rpc('admin_assert_internet_rates_publishable', {
        p_rates: rates,
      });
      if (assertErr) throw assertErr;
      const { error: rpcErr } = await supabase.rpc('publish_tariff_version', {
        p_tariff_id: tariff.tariff_id,
        p_rates: { natural: rates, legal: rates },
        p_basis_type: 'supplier_notice',
        p_basis_note: internetForm.basis_note.trim(),
        p_basis_reference: internetForm.basis_reference.trim(),
        p_basis_date: internetForm.basis_date || null,
        p_idempotency_key: crypto.randomUUID(),
        p_application_year: null,
        p_valid_from: internetForm.valid_from,
        p_decision_id: null,
      });
      if (rpcErr) throw rpcErr;
      setPublishKey(null);
      setInternetForm((f) => ({ ...f, package_30: '', day: '', basis_note: '' }));
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
    const ok = await confirm({
      title: t('admin.tcCancelConfirm'),
      confirmLabel: t('admin.tcCancel'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    });
    if (!ok) return;
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
    if (key === 'capital_repair') {
      const row = byKey.get('capital_repair');
      const intent = defaultCapitalRepairPublishIntent(row);
      setCapitalIntent(intent);
      const years = capitalRepairAllowedApplicationYears(intent);
      setSupportForm((f) => ({
        ...f,
        application_year: String(years[0] ?? capitalRepairPlannedApplicationYear()),
        amend_valid_from: today,
      }));
    } else if (key === 'support_fee') {
      const row = byKey.get('support_fee');
      const intent = defaultSupportFeePublishIntent(row);
      setSupportIntent(intent);
      const years = supportFeeAllowedApplicationYears(intent);
      setSupportForm((f) => ({
        ...f,
        application_year: String(years[0] ?? supportFeePlannedApplicationYear()),
        amend_valid_from: today,
      }));
    }
  }

  function applyCapitalIntent(intent: CapitalRepairPublishIntent) {
    setCapitalIntent(intent);
    const years = capitalRepairAllowedApplicationYears(intent);
    setSupportForm((f) => ({
      ...f,
      application_year: String(years[0] ?? nextYear),
      amend_valid_from: f.amend_valid_from || today,
    }));
  }

  function applySupportIntent(intent: SupportFeePublishIntent) {
    setSupportIntent(intent);
    const years = supportFeeAllowedApplicationYears(intent);
    setSupportForm((f) => ({
      ...f,
      application_year: String(years[0] ?? nextYear),
      amend_valid_from: f.amend_valid_from || today,
    }));
  }

  function openHistory(tariffId: string) {
    setHistoryTariffId(tariffId);
    setPublishKey(null);
    selectTab('history');
  }

  const policyYearFocus =
    policyYearRaw != null && Number.isFinite(policyYearRaw) && policyYearRaw >= 2000
      ? Math.floor(policyYearRaw)
      : null;

  function renderPublishForm(key: string): ReactNode {
    if (key === 'support_fee' && canSupport) {
      const supportRow = byKey.get('support_fee');
      const hasCurrent = supportFeeHasCurrentTariff(supportRow);
      const supportYears = supportFeeAllowedApplicationYears(supportIntent);
      return (
        <form onSubmit={publishSupport} className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <p className="text-sm font-semibold text-foreground sm:col-span-2">{t('admin.tcChangeRate')}</p>
          <label className="grid gap-1 text-sm text-secondary sm:col-span-2">
            {t('admin.tcSupportIntent')}
            <select
              className={adminFieldClass}
              value={supportIntent}
              onChange={(e) => applySupportIntent(e.target.value as SupportFeePublishIntent)}
            >
              {!hasCurrent ? (
                <option value="activation">{t('admin.tcSupportIntentActivation')}</option>
              ) : null}
              <option value="next_year">{t('admin.tcSupportIntentNextYear')}</option>
              {hasCurrent ? (
                <option value="amend">{t('admin.tcSupportIntentAmend')}</option>
              ) : null}
            </select>
            <span className="text-xs text-muted">
              {supportIntent === 'activation'
                ? t('admin.tcSupportIntentActivationHint')
                : supportIntent === 'amend'
                  ? t('admin.tcSupportIntentAmendHint')
                  : t('admin.tcSupportIntentNextYearHint')}
            </span>
          </label>
          <label className="grid gap-1 text-sm text-secondary">
            {t('admin.tcNewRate')}
            <span className="text-xs text-muted">{t('admin.tcSubjectNatural')}</span>
            <input
              className={adminFieldClass}
              type="number"
              step="0.01"
              min="0.01"
              value={supportForm.rate}
              onChange={(e) => setSupportForm({ ...supportForm, rate: e.target.value })}
              required
            />
          </label>
          <label className="grid gap-1 text-sm text-secondary">
            {t('admin.tcNewRate')}
            <span className="text-xs text-muted">{t('admin.tcSubjectLegal')}</span>
            <input
              className={adminFieldClass}
              type="number"
              step="0.01"
              min="0.01"
              value={supportForm.rate_legal}
              onChange={(e) => setSupportForm({ ...supportForm, rate_legal: e.target.value })}
              placeholder={supportForm.rate || undefined}
            />
          </label>
          <label className="grid gap-1 text-sm text-secondary">
            {t('admin.tcApplicationYear')}
            <select
              className={adminFieldClass}
              value={supportForm.application_year}
              onChange={(e) => setSupportForm({ ...supportForm, application_year: e.target.value })}
              required
            >
              {supportYears.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          {supportIntent === 'amend' ? (
            <label className="grid gap-1 text-sm text-secondary">
              {t('admin.tcValidFrom')}
              <input
                className={adminFieldClass}
                type="date"
                min={today}
                value={supportForm.amend_valid_from}
                onChange={(e) => setSupportForm({ ...supportForm, amend_valid_from: e.target.value })}
                required
              />
            </label>
          ) : null}
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

    if (key === 'capital_repair' && canSupport) {
      const hasCurrentCapital = capitalRepairHasCurrentTariff(byKey.get('capital_repair'));
      const capitalYears = capitalRepairAllowedApplicationYears(capitalIntent);
      return (
        <form onSubmit={publishCapital} className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <p className="text-sm font-semibold text-foreground sm:col-span-2">
            {t('admin.tcSetCapitalRate')}
          </p>
          <p className="text-xs text-muted sm:col-span-2">{t('admin.tcCapitalRateDesc')}</p>
          <label className="grid gap-1 text-sm text-secondary sm:col-span-2">
            {t('admin.tcCapitalIntent')}
            <select
              className={adminFieldClass}
              value={capitalIntent}
              onChange={(e) => applyCapitalIntent(e.target.value as CapitalRepairPublishIntent)}
            >
              {!hasCurrentCapital ? (
                <option value="activation">{t('admin.tcCapitalIntentActivation')}</option>
              ) : null}
              <option value="next_year">{t('admin.tcCapitalIntentNextYear')}</option>
              {hasCurrentCapital ? (
                <option value="amend">{t('admin.tcCapitalIntentAmend')}</option>
              ) : null}
            </select>
            <span className="text-xs text-muted">
              {capitalIntent === 'activation'
                ? t('admin.tcCapitalIntentActivationHint')
                : capitalIntent === 'amend'
                  ? t('admin.tcCapitalIntentAmendHint')
                  : t('admin.tcCapitalIntentNextYearHint')}
            </span>
          </label>
          <label className="grid gap-1 text-sm text-secondary">
            {t('admin.tcCapitalRate')}
            <span className="text-xs text-muted">{t('admin.tcSubjectNatural')}</span>
            <input
              className={adminFieldClass}
              type="number"
              step="0.01"
              min="0.01"
              value={supportForm.rate}
              onChange={(e) => setSupportForm({ ...supportForm, rate: e.target.value })}
              required
            />
          </label>
          <label className="grid gap-1 text-sm text-secondary">
            {t('admin.tcCapitalRate')}
            <span className="text-xs text-muted">{t('admin.tcSubjectLegal')}</span>
            <input
              className={adminFieldClass}
              type="number"
              step="0.01"
              min="0.01"
              value={supportForm.rate_legal}
              onChange={(e) => setSupportForm({ ...supportForm, rate_legal: e.target.value })}
              placeholder={supportForm.rate || undefined}
            />
          </label>
          <label className="grid gap-1 text-sm text-secondary">
            {t('admin.tcApplicationYear')}
            <select
              className={adminFieldClass}
              value={supportForm.application_year}
              onChange={(e) => setSupportForm({ ...supportForm, application_year: e.target.value })}
              required
            >
              {capitalYears.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          {capitalIntent === 'amend' ? (
            <label className="grid gap-1 text-sm text-secondary">
              {t('admin.tcValidFrom')}
              <input
                className={adminFieldClass}
                type="date"
                min={today}
                value={supportForm.amend_valid_from}
                onChange={(e) => setSupportForm({ ...supportForm, amend_valid_from: e.target.value })}
                required
              />
            </label>
          ) : null}
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
            <span className="text-xs text-muted">{t('admin.tcSubjectNatural')}</span>
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
            {t('admin.tcNewRate')}
            <span className="text-xs text-muted">{t('admin.tcSubjectLegal')}</span>
            <input
              className={adminFieldClass}
              type="number"
              step="0.0001"
              min="0"
              value={waterForm.rate_legal}
              onChange={(e) => setWaterForm({ ...waterForm, rate_legal: e.target.value })}
              placeholder={waterForm.rate || undefined}
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
            {t('admin.tcCompDay')} · {t('admin.tcSubjectNatural')}
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
            {t('admin.tcCompNight')} · {t('admin.tcSubjectNatural')}
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
            {t('admin.tcCompDay')} · {t('admin.tcSubjectLegal')}
            <input
              className={adminFieldClass}
              type="number"
              step="0.0001"
              min="0"
              value={elForm.day_legal}
              onChange={(e) => setElForm({ ...elForm, day_legal: e.target.value })}
              placeholder={elForm.day || undefined}
            />
          </label>
          <label className="grid gap-1 text-sm text-secondary">
            {t('admin.tcCompNight')} · {t('admin.tcSubjectLegal')}
            <input
              className={adminFieldClass}
              type="number"
              step="0.0001"
              min="0"
              value={elForm.night_legal}
              onChange={(e) => setElForm({ ...elForm, night_legal: e.target.value })}
              placeholder={elForm.night || undefined}
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

    if (key === 'internet' && canUtility) {
      return (
        <form onSubmit={publishInternet} className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <p className="text-sm font-semibold text-foreground sm:col-span-2">{t('admin.tcChangeRate')}</p>
          <label className="grid gap-1 text-sm text-secondary">
            {t('admin.internetTariffPackage30')}
            <span className="text-xs text-muted">{t('admin.internetTariffCalendarHint')}</span>
            <input
              className={adminFieldClass}
              type="number"
              step="0.01"
              min="0"
              value={internetForm.package_30}
              onChange={(e) => setInternetForm({ ...internetForm, package_30: e.target.value })}
              required
            />
          </label>
          <label className="grid gap-1 text-sm text-secondary">
            {t('admin.internetTariffDay24')}
            <span className="text-xs text-muted">{t('admin.internetTariffCalendarHint')}</span>
            <input
              className={adminFieldClass}
              type="number"
              step="0.0001"
              min="0"
              value={internetForm.day}
              onChange={(e) => setInternetForm({ ...internetForm, day: e.target.value })}
              required
            />
          </label>
          <label className="grid gap-1 text-sm text-secondary">
            {t('admin.tcValidFrom')}
            <input
              className={adminFieldClass}
              type="date"
              min={today}
              value={internetForm.valid_from}
              onChange={(e) => setInternetForm({ ...internetForm, valid_from: e.target.value })}
              required
            />
          </label>
          <label className="grid gap-1 text-sm text-secondary">
            {t('admin.tcSupplierRef')}
            <input
              className={adminFieldClass}
              value={internetForm.basis_reference}
              onChange={(e) => setInternetForm({ ...internetForm, basis_reference: e.target.value })}
              required
            />
          </label>
          <label className="grid gap-1 text-sm text-secondary">
            {t('admin.tcBasisDate')}
            <input
              className={adminFieldClass}
              type="date"
              value={internetForm.basis_date}
              onChange={(e) => setInternetForm({ ...internetForm, basis_date: e.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm text-secondary sm:col-span-2">
            {t('admin.tcBasisNote')}
            <input
              className={adminFieldClass}
              value={internetForm.basis_note}
              onChange={(e) => setInternetForm({ ...internetForm, basis_note: e.target.value })}
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

    const focused = focusTariffKey != null && row.tariff_key === focusTariffKey;
    return (
      <AdminCard
        key={row.tariff_id}
        className={`flex flex-col gap-4 ${
          editing ? 'sm:col-span-2 xl:col-span-3 border-accent/30' : 'h-full'
        } ${focused ? 'border-accent ring-2 ring-accent/35' : ''}`}
      >
        <div
          id={`tariff-card-${row.tariff_key}`}
          tabIndex={focused ? -1 : undefined}
          className={focused ? 'rounded-lg outline-none' : undefined}
        >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{row.default_name}</p>
            <p className="mt-0.5 text-xs text-muted">{unitSuffix(row, t)}</p>
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
                {row.tariff_key === 'capital_repair' ? t('admin.tcSetCapitalRate') : t('admin.tcChangeRate')}
              </AdminPrimaryButton>
            ) : null}
            <AdminSecondaryButton type="button" onClick={() => openHistory(row.tariff_id)}>
              {t('admin.tcOpenHistory')}
            </AdminSecondaryButton>
          </div>
        ) : null}

        {editing ? renderPublishForm(row.tariff_key) : null}
        </div>
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
            <p className="mt-0.5 text-xs text-muted">{unitSuffix(row, t)}</p>
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

  const returnHref = (returnSearch ?? '').replace(/^\?/, '').trim();
  const returnToWater =
    returnHref.includes('section=%D0%B2%D0%BE%D0%B4%D0%B0') ||
    returnHref.includes('section=вода') ||
    /(^|&)section=вода(&|$)/.test(returnHref);

  return (
    <div className="min-w-0 space-y-4">
      {dialog}
      <AdminPageHeader title={t('admin.tcTitle')} secondary={t('admin.tcLead')} />
      {returnHref && returnToWater ? (
        <p>
          <Link
            href={`/admin?${returnHref}`}
            className="text-sm font-medium text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ← {t('admin.utilRegBackFromTariff')}
          </Link>
        </p>
      ) : null}
      {error ? <AdminInlineAlert tone="danger">{error}</AdminInlineAlert> : null}

      <AdminTabBar
        tabs={[
          { id: 'current', label: t('admin.tcTabCurrent') },
          { id: 'scheduled', label: t('admin.tcTabScheduled') },
          { id: 'history', label: t('admin.tcTabHistory') },
          ...(supportFeeModuleOn
            ? [{ id: 'annual_policy' as const, label: t('admin.tcTabAnnualPolicy') }]
            : []),
        ]}
        active={tab}
        onChange={(id) => {
          selectTab(id as TariffTab);
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
        visibleRows.length === 0 ? (
          <AdminEmptyState title={t('admin.tcEmpty')} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleRows.map((row) => renderCurrentCard(row))}
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
      ) : tab === 'annual_policy' ? (
        <AdminSupportFeePolicyEditor
          supabase={supabase}
          canRate={canSupport}
          onError={setError}
          initialYear={policyYearFocus}
        />
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
              {visibleRows.map((r) => (
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
                const tariff = visibleRows.find((r) => r.tariff_id === h.tariff_id);
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
