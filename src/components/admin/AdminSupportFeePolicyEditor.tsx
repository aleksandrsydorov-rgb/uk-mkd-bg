'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { annualSupportFee } from '@/lib/finance';
import { toUserFacingMessage } from '@/lib/userFacingError';
import {
  formatEurAmount,
  formatSofiaDate,
  formatSofiaDeadline,
  sofiaCalendarYear,
  sofiaYearStartLabel,
  type SupportFeeAnnualPolicy,
} from '@/lib/supportFeeAnnual';
import {
  defaultEarlyPaymentDeadlineDate,
  earlyPaymentDeadlineIsoFromDate,
  validateSupportFeeAnnualPolicyDraft,
} from '@/lib/supportFeePenalty';
import {
  parseSupportFeeLaunchContext,
  parseSupportFeeYearChargeContext,
} from '@/lib/supportFeeLaunch';
import {
  AdminInlineAlert,
  AdminPrimaryButton,
  AdminSecondaryButton,
  StatusBadge,
  adminCardClass,
  adminFieldClass,
} from '@/components/admin/AdminUi';

function formatPolicyPercent(raw: string | number, locale: string) {
  const v = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(v)) return '—';
  const loc = locale === 'en' ? 'en-US' : locale === 'bg' ? 'bg-BG' : 'ru-RU';
  return new Intl.NumberFormat(loc, { maximumFractionDigits: 2 }).format(v);
}

/**
 * Annual early/late payment policy (draft → publish) for one billing year.
 * Mounted inside «Тарифы» under the support_fee tariff. Charging a year is done in
 * «Такса поддержки → Начисления», so there is intentionally no finalize/charge action here.
 */
export function AdminSupportFeePolicyEditor({
  supabase,
  canRate,
  onError: _onError,
  onChanged,
  initialYear,
}: {
  supabase: SupabaseClient<Database>;
  /** Only the canonical administration role edits the policy. */
  canRate: boolean;
  /** @deprecated Errors stay inline in this editor to avoid a duplicated parent banner. */
  onError?: (msg: string) => void;
  /** Called after draft/publish so the host can refresh dependent data. */
  onChanged?: () => void | Promise<void>;
  /** Prefer this billing year when opened from «Начисления» for the same year. */
  initialYear?: number | null;
}) {
  void _onError;
  const { t, locale } = useI18n();
  const [localError, setLocalError] = useState<string | null>(null);
  // Keep the error in the editor only — parent onError would duplicate the same banner.
  const reportError = useCallback((msg: string) => {
    setLocalError(msg);
  }, []);

  const [minChargeYear, setMinChargeYear] = useState<number | null>(null);
  const [launchReady, setLaunchReady] = useState(false);
  const [year, setYear] = useState<number>(
    initialYear != null && Number.isFinite(initialYear) ? Math.floor(initialYear) : sofiaCalendarYear() + 1,
  );
  const [yearTouched, setYearTouched] = useState(initialYear != null && Number.isFinite(initialYear));
  const [policies, setPolicies] = useState<SupportFeeAnnualPolicy[]>([]);
  const [rate, setRate] = useState<number | null>(null);
  const [sampleArea, setSampleArea] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [discount, setDiscount] = useState('10');
  const [increase, setIncrease] = useState('10');
  const [deadlineDate, setDeadlineDate] = useState(defaultEarlyPaymentDeadlineDate(year));
  const [saving, setSaving] = useState(false);

  // Launch context → default year (first allowed charge year).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc('support_fee_launch_context');
      if (cancelled) return;
      if (!error) {
        const ctx = parseSupportFeeLaunchContext(data);
        setMinChargeYear(ctx.minChargeYear);
      }
      setLaunchReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (initialYear != null && Number.isFinite(initialYear) && initialYear >= 2000) {
      setYearTouched(true);
      setYear(Math.floor(initialYear));
    }
  }, [initialYear]);

  useEffect(() => {
    if (!launchReady || yearTouched) return;
    setYear(minChargeYear ?? sofiaCalendarYear() + 1);
  }, [launchReady, minChargeYear, yearTouched]);

  const loadPolicies = useCallback(async () => {
    const { data, error } = await supabase
      .from('support_fee_annual_policies')
      .select('*')
      .order('billing_year', { ascending: false });
    if (error) return;
    setPolicies((data as SupportFeeAnnualPolicy[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  // Rate for the picked year + one apartment area for the preview tiles.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [ctxRes, propRes] = await Promise.all([
        supabase.rpc('support_fee_year_charge_context', { p_billing_year: year }),
        supabase
          .from('properties')
          .select('area_sqm')
          .order('id', { ascending: true })
          .limit(1),
      ]);
      if (cancelled) return;
      const ctx = ctxRes.error ? null : parseSupportFeeYearChargeContext(ctxRes.data);
      setRate(ctx?.rateEurPerSqmYear ?? null);
      const area = Number((propRes.data as Array<{ area_sqm: number | null }> | null)?.[0]?.area_sqm);
      setSampleArea(Number.isFinite(area) && area > 0 ? area : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, year]);

  const current = policies.find((p) => p.billing_year === year);

  // Sync form fields to the stored policy for the picked year.
  useEffect(() => {
    setLocalError(null);
    if (current) {
      setEnabled(Boolean(current.enabled));
      setDiscount(String(current.early_discount_percent));
      setIncrease(String(current.late_increase_percent));
      const dl = String(current.early_payment_deadline ?? '');
      setDeadlineDate(/^\d{4}-\d{2}-\d{2}/.test(dl) ? dl.slice(0, 10) : defaultEarlyPaymentDeadlineDate(year));
    } else {
      setDeadlineDate(defaultEarlyPaymentDeadlineDate(year));
    }
  }, [current, year]);

  const status = String(current?.status ?? 'draft');
  const isDraft = !current || status === 'draft';
  const isPublished = status === 'published';
  const isClosed = status === 'closed';

  const yearChoices = useMemo(() => {
    const set = new Set<number>([sofiaCalendarYear(), sofiaCalendarYear() + 1, year]);
    if (minChargeYear != null) {
      set.add(minChargeYear);
      set.add(minChargeYear + 1);
    }
    for (const p of policies) set.add(p.billing_year);
    return [...set].filter((y) => y >= 2000 && y <= 2100).sort((a, b) => a - b);
  }, [policies, year, minChargeYear]);

  const disc = Number(String(discount).replace(',', '.')) || 0;
  const inc = Number(String(increase).replace(',', '.')) || 0;
  const sampleBase = useMemo(() => annualSupportFee(sampleArea, rate), [sampleArea, rate]);
  const early = sampleBase == null ? null : Math.round(sampleBase * (1 - disc / 100) * 100) / 100;
  const late = sampleBase == null ? null : Math.round(sampleBase * (1 + inc / 100) * 100) / 100;
  const earlyPct = Math.round((100 - disc) * 100) / 100;
  const latePct = Math.round((100 + inc) * 100) / 100;

  function statusLabel() {
    if (isPublished) return t('admin.sfStatusPublished');
    if (isClosed) return t('admin.sfStatusClosed');
    return t('admin.sfStatusDraft');
  }

  function mapPolicyError(e: unknown): string | null {
    const msg =
      e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message ?? '') : '';
    if (/published policy cannot be edited/i.test(msg)) return null;
    return toUserFacingMessage(e, t, { fallback: t('admin.sfSaveFailed') });
  }

  function draftValid(): boolean {
    const check = validateSupportFeeAnnualPolicyDraft({
      discountPercent: disc,
      increasePercent: inc,
      deadlineYmd: deadlineDate,
      billingYear: year,
    });
    if (!check.ok) {
      reportError(t(check.errorKey));
      return false;
    }
    return true;
  }

  async function upsertDraft() {
    const { error } = await supabase.rpc('upsert_support_fee_annual_policy', {
      p_billing_year: year,
      p_enabled: enabled,
      p_early_discount_percent: disc,
      p_late_increase_percent: inc,
      p_early_payment_deadline: earlyPaymentDeadlineIsoFromDate(deadlineDate),
    });
    if (error) throw error;
  }

  async function saveDraft() {
    if (!canRate) {
      reportError(t('admin.sfAdminOnlyPolicy'));
      return;
    }
    if (!isDraft || saving || !draftValid()) return;
    setSaving(true);
    setLocalError(null);
    try {
      await upsertDraft();
      await loadPolicies();
      await onChanged?.();
    } catch (e: unknown) {
      const mapped = mapPolicyError(e);
      if (mapped) reportError(mapped);
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!canRate || !isDraft || saving || !draftValid()) return;
    setSaving(true);
    setLocalError(null);
    try {
      await upsertDraft();
      const { error } = await supabase.rpc('publish_support_fee_annual_policy', { p_billing_year: year });
      if (error) throw error;
      await loadPolicies();
      await onChanged?.();
    } catch (e: unknown) {
      const mapped = mapPolicyError(e);
      if (mapped) reportError(mapped);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`${adminCardClass} space-y-3 p-4 md:p-5`} data-support-fee-policy-editor="1">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {t('admin.sfYearlyPolicy')} · {year}
          </p>
          <p className="mt-1 text-xs text-muted">{t('admin.feeTariffsPolicyLead')}</p>
        </div>
        <StatusBadge
          label={statusLabel()}
          tone={isPublished ? 'info' : isClosed ? 'neutral' : 'warning'}
        />
      </div>

      {localError ? <AdminInlineAlert tone="danger">{localError}</AdminInlineAlert> : null}

      <label className="block max-w-xs text-sm text-secondary">
        {t('admin.feeTariffsPolicyYear')}
        <select
          value={year}
          onChange={(e) => {
            setYearTouched(true);
            setYear(Number(e.target.value));
          }}
          className={`mt-1 block w-full ${adminFieldClass}`}
        >
          {yearChoices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </label>

      {isDraft ? (
        <label className="flex items-center gap-2 text-sm text-secondary">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canRate}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {t('admin.sfEnableEarly')}
        </label>
      ) : (
        <p className="text-sm text-secondary">
          {enabled ? t('admin.sfEnableEarly') : t('account.sfStandardFee')}
        </p>
      )}

      {isDraft ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-secondary">
            {t('admin.sfDiscountPct')}
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={discount}
              disabled={!canRate}
              onChange={(e) => setDiscount(e.target.value)}
              className={`mt-1 block w-full ${adminFieldClass}`}
            />
          </label>
          <label className="text-sm text-secondary">
            {t('admin.sfIncreasePct')}
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={increase}
              disabled={!canRate}
              onChange={(e) => setIncrease(e.target.value)}
              className={`mt-1 block w-full ${adminFieldClass}`}
            />
          </label>
        </div>
      ) : (
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <div className="text-muted">{t('admin.sfDiscountLabel')}</div>
            <div className="font-semibold">{formatPolicyPercent(discount, locale)}%</div>
          </div>
          <div>
            <div className="text-muted">{t('admin.sfIncreaseLabel')}</div>
            <div className="font-semibold">{formatPolicyPercent(increase, locale)}%</div>
          </div>
        </div>
      )}

      {isDraft ? (
        <label className="block text-sm text-secondary">
          {t('admin.sfDeadlineLabel')}
          <input
            type="date"
            value={deadlineDate}
            max={`${year - 1}-12-31`}
            disabled={!canRate}
            onChange={(e) => setDeadlineDate(e.target.value)}
            className={`mt-1 block w-full max-w-xs ${adminFieldClass}`}
          />
          <span className="mt-1 block text-xs text-muted">
            {t('admin.sfDeadlineEditableHint', { year: String(year - 1) })}
          </span>
        </label>
      ) : (
        <div className="text-sm">
          <div className="text-muted">{t('admin.sfDeadlineLabel')}</div>
          <div className="font-medium text-foreground">
            {current?.early_payment_deadline
              ? `${formatSofiaDeadline(current.early_payment_deadline)} · ${t('admin.sfSofiaTz')}`
              : `31.12.${year - 1} · 23:59 · ${t('admin.sfSofiaTz')}`}
          </div>
        </div>
      )}

      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-xl bg-surface-secondary px-3 py-2">
          <div className="text-muted">{t('admin.sfBase100', { p: formatPolicyPercent(100, locale) })}</div>
          <div className="font-semibold tabular-nums">
            {sampleBase == null ? '—' : formatEurAmount(sampleBase, locale)}
          </div>
        </div>
        <div className="rounded-xl bg-surface-secondary px-3 py-2">
          <div className="text-muted">{t('admin.sfEarlyPay', { p: formatPolicyPercent(earlyPct, locale) })}</div>
          <div className="text-xs text-muted">
            {t('admin.sfUntilDate', {
              d: current?.early_payment_deadline
                ? formatSofiaDate(current.early_payment_deadline)
                : deadlineDate
                  ? deadlineDate.split('-').reverse().join('.')
                  : `31.12.${year - 1}`,
            })}
          </div>
          <div className="font-semibold tabular-nums text-success">
            {early == null ? '—' : formatEurAmount(early, locale)}
          </div>
        </div>
        <div className="rounded-xl bg-surface-secondary px-3 py-2">
          <div className="text-muted">{t('admin.sfLatePay', { p: formatPolicyPercent(latePct, locale) })}</div>
          <div className="text-xs text-muted">{t('admin.sfFromDate', { d: sofiaYearStartLabel(year) })}</div>
          <div className="font-semibold tabular-nums">
            {late == null ? '—' : formatEurAmount(late, locale)}
          </div>
        </div>
      </div>

      {isDraft ? (
        <div className="flex flex-wrap gap-2">
          <AdminSecondaryButton type="button" disabled={saving || !canRate} onClick={() => void saveDraft()}>
            {t('admin.sfSaveDraft')}
          </AdminSecondaryButton>
          <AdminPrimaryButton type="button" disabled={saving || !canRate} onClick={() => void publish()}>
            {t('admin.sfPublish')}
          </AdminPrimaryButton>
        </div>
      ) : null}
      {!canRate ? <p className="text-xs text-muted">{t('admin.sfAdminOnlyPolicy')}</p> : null}
    </div>
  );
}
