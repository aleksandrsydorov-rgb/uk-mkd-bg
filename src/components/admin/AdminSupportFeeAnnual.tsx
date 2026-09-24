'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { annualSupportFee } from '@/lib/finance';
import {
  formatEurAmount,
  formatSofiaDate,
  formatSofiaDeadline,
  sofiaCalendarYear,
  sofiaYearStartLabel,
  type SupportFeeAnnualPolicy,
  type SupportFeeAssessment,
} from '@/lib/supportFeeAnnual';
import {
  AdminEmptyState,
  AdminTableShell,
  adminCardClass,
  adminFieldClass,
  adminTableCellClass,
  adminTableHeadRowClass,
  adminTableRowClass,
} from '@/components/admin/AdminUi';
import { StatusBadge } from '@/components/account/ownerUi';

function formatPolicyPercent(raw: string | number, locale: string) {
  const v = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(v)) return '—';
  const loc = locale === 'en' ? 'en-US' : locale === 'bg' ? 'bg-BG' : 'ru-RU';
  return new Intl.NumberFormat(loc, { maximumFractionDigits: 2 }).format(v);
}

type PropertyLite = {
  id: number;
  apartment_number: string | number;
  owner_name?: string | null;
  area_sqm: number | null;
  debt?: number | null;
  overpayment?: number | null;
};

export function AdminSupportFeeAnnual({
  supabase,
  properties,
  supportRate,
  canPay,
  canRate,
  onReload,
  onError,
  panel = 'all',
}: {
  supabase: SupabaseClient<Database>;
  properties: PropertyLite[];
  supportRate: number;
  canPay: boolean;
  canRate: boolean;
  onReload: () => Promise<void>;
  onError: (msg: string) => void;
  panel?: 'all' | 'policy' | 'register';
}) {
  const { t, locale } = useI18n();
  const defaultYear = sofiaCalendarYear() + 1;
  const [year, setYear] = useState(String(defaultYear));
  const [enabled, setEnabled] = useState(true);
  const [discount, setDiscount] = useState('10');
  const [increase, setIncrease] = useState('10');
  const [policies, setPolicies] = useState<SupportFeeAnnualPolicy[]>([]);
  const [assessments, setAssessments] = useState<SupportFeeAssessment[]>([]);
  const [saving, setSaving] = useState(false);
  const [corrId, setCorrId] = useState('');
  const [corrAmt, setCorrAmt] = useState('');
  const [corrReason, setCorrReason] = useState('');

  const y = Number(year);
  const sampleBase = useMemo(
    () => annualSupportFee(properties[0]?.area_sqm, supportRate),
    [properties, supportRate],
  );
  const disc = Number(String(discount).replace(',', '.')) || 0;
  const inc = Number(String(increase).replace(',', '.')) || 0;
  const early = Math.round(sampleBase * (1 - disc / 100) * 100) / 100;
  const late = Math.round(sampleBase * (1 + inc / 100) * 100) / 100;
  const earlyPct = Math.round((100 - disc) * 100) / 100;
  const latePct = Math.round((100 + inc) * 100) / 100;
  const current = policies.find((p) => p.billing_year === y);
  const status = String(current?.status ?? (current ? 'draft' : 'draft'));
  const isDraft = !current || status === 'draft';
  const isPublished = status === 'published';
  const isClosed = status === 'closed';
  const yearChoices = useMemo(() => {
    const set = new Set<number>([defaultYear, sofiaCalendarYear(), sofiaCalendarYear() + 1]);
    for (const p of policies) set.add(p.billing_year);
    if (Number.isFinite(y) && y >= 2000) set.add(y);
    return [...set].sort((a, b) => a - b);
  }, [policies, defaultYear, y]);

  function statusLabel() {
    if (isPublished) return t('admin.sfStatusPublished');
    if (isClosed) return t('admin.sfStatusClosed');
    return t('admin.sfStatusDraft');
  }

  function mapPolicyError(e: unknown): string | null {
    const msg =
      e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message ?? '') : '';
    if (/published policy cannot be edited/i.test(msg)) return null;
    return msg || t('admin.sfSaveFailed');
  }

  async function load() {
    const yNum = Number.isFinite(y) ? y : defaultYear;
    const [pRes, aRes] = await Promise.all([
      supabase.from('support_fee_annual_policies').select('*').order('billing_year', { ascending: false }),
      supabase.from('support_fee_assessments').select('*').eq('billing_year', yNum),
    ]);
    if (pRes.error) return;
    if (!pRes.error) setPolicies((pRes.data as SupportFeeAnnualPolicy[]) ?? []);
    if (!aRes.error) setAssessments((aRes.data as SupportFeeAssessment[]) ?? []);
    if (pRes.data) {
      const row = (pRes.data as SupportFeeAnnualPolicy[]).find((p) => p.billing_year === y);
      if (row) {
        setEnabled(Boolean(row.enabled));
        setDiscount(String(row.early_discount_percent));
        setIncrease(String(row.late_increase_percent));
      }
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  async function saveDraft() {
    if (!canRate) {
      onError(t('admin.sfAdminOnlyPolicy'));
      return false;
    }
    if (!isDraft) return false;
    if (!/^\d{4}$/.test(year)) return false;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('upsert_support_fee_annual_policy', {
        p_billing_year: Number(year),
        p_enabled: enabled,
        p_early_discount_percent: disc,
        p_late_increase_percent: inc,
        p_early_payment_deadline: null,
      });
      if (error) throw error;
      await load();
      await onReload();
      return true;
    } catch (e: unknown) {
      const mapped = mapPolicyError(e);
      if (mapped) onError(mapped);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!canRate || !isDraft) return;
    setSaving(true);
    try {
      const { error: upsertError } = await supabase.rpc('upsert_support_fee_annual_policy', {
        p_billing_year: Number(year),
        p_enabled: enabled,
        p_early_discount_percent: disc,
        p_late_increase_percent: inc,
        p_early_payment_deadline: null,
      });
      if (upsertError) throw upsertError;
      const { error } = await supabase.rpc('publish_support_fee_annual_policy', { p_billing_year: Number(year) });
      if (error) throw error;
      await load();
      await onReload();
    } catch (e: unknown) {
      const mapped = mapPolicyError(e);
      if (mapped) onError(mapped);
    } finally {
      setSaving(false);
    }
  }

  async function finalizeYear() {
    if (!canPay) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('finalize_support_fee_year', { p_billing_year: Number(year) });
      if (error) throw error;
      await load();
      await onReload();
    } catch (e: unknown) {
      onError(e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : t('admin.sfSaveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const showPolicy = panel === 'all' || panel === 'policy';
  const showRegister = panel === 'all' || panel === 'register';

  return (
    <div className="space-y-4">
      {showPolicy && (
      <div className={`${adminCardClass} p-4 md:p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {t('admin.sfYearlyPolicy')} · {year}
          </p>
          <StatusBadge
            label={statusLabel()}
            tone={isPublished ? 'info' : isClosed ? 'neutral' : 'warning'}
          />
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {yearChoices.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => setYear(String(choice))}
              className={`shrink-0 rounded-full border px-3 py-1 text-sm ${
                choice === y ? 'border-accent/30 bg-accent-bg text-accent' : 'border-border text-secondary'
              }`}
            >
              {choice}
            </button>
          ))}
        </div>
        {isDraft ? (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm text-secondary">
              {t('admin.sfYear')}
              <input
                type="number"
                min={2020}
                max={2100}
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className={`mt-1 block w-28 ${adminFieldClass}`}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-secondary">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              {t('admin.sfEnableEarly')}
            </label>
          </div>
        ) : (
          <p className="mt-3 text-sm text-secondary">
            {enabled ? t('admin.sfEnableEarly') : t('account.sfStandardFee')}
          </p>
        )}
        {isDraft ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-secondary">
              {t('admin.sfDiscountPct')}
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={discount}
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
                onChange={(e) => setIncrease(e.target.value)}
                className={`mt-1 block w-full ${adminFieldClass}`}
              />
            </label>
          </div>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 text-sm">
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
        <div className="mt-3 text-sm">
          <div className="text-muted">{t('admin.sfDeadlineLabel')}</div>
          <div className="font-medium text-foreground">
            {current?.early_payment_deadline
              ? `${formatSofiaDeadline(current.early_payment_deadline)} · ${t('admin.sfSofiaTz')}`
              : `31.12.${Number(year) - 1} · 23:59 · ${t('admin.sfSofiaTz')}`}
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3 text-sm">
          <div className="rounded-xl bg-surface-secondary px-3 py-2">
            <div className="text-muted">{t('admin.sfBase100', { p: formatPolicyPercent(100, locale) })}</div>
            <div className="font-semibold tabular-nums">{formatEurAmount(sampleBase, locale)}</div>
          </div>
          <div className="rounded-xl bg-surface-secondary px-3 py-2">
            <div className="text-muted">{t('admin.sfEarlyPay', { p: formatPolicyPercent(earlyPct, locale) })}</div>
            <div className="text-xs text-muted">
              {t('admin.sfUntilDate', {
                d: current?.early_payment_deadline
                  ? formatSofiaDate(current.early_payment_deadline)
                  : `31.12.${Number(year) - 1}`,
              })}
            </div>
            <div className="font-semibold tabular-nums text-success">{formatEurAmount(early, locale)}</div>
          </div>
          <div className="rounded-xl bg-surface-secondary px-3 py-2">
            <div className="text-muted">{t('admin.sfLatePay', { p: formatPolicyPercent(latePct, locale) })}</div>
            <div className="text-xs text-muted">{t('admin.sfFromDate', { d: sofiaYearStartLabel(y) })}</div>
            <div className="font-semibold tabular-nums">{formatEurAmount(late, locale)}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {isDraft ? (
            <>
              <button
                type="button"
                disabled={saving || !canRate}
                onClick={() => void saveDraft()}
                className="rounded-full border border-border px-4 py-2 text-sm disabled:opacity-50"
              >
                {t('admin.sfSaveDraft')}
              </button>
              <button
                type="button"
                disabled={saving || !canRate}
                onClick={() => void publish()}
                className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {t('admin.sfPublish')}
              </button>
            </>
          ) : null}
          <button
            type="button"
            disabled={saving || !canPay}
            onClick={() => void finalizeYear()}
            className="rounded-full border border-border px-4 py-2 text-sm disabled:opacity-50"
          >
            {t('admin.sfFinalizeYear')}
          </button>
        </div>
      </div>
      )}

      {showRegister && (
      <div className="space-y-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">{t('admin.sfPropertyView')} · {year}</p>
        {properties.length === 0 ? (
          <AdminEmptyState title={t('admin.feeNoLedger')} />
        ) : (
        <AdminTableShell>
        <table className="w-full min-w-[48rem] text-sm">
          <thead>
            <tr className={adminTableHeadRowClass}>
              <th className={adminTableCellClass}>{t('form.colApt')}</th>
              <th className={adminTableCellClass}>{t('form.colOwner')}</th>
              <th className={adminTableCellClass}>{t('account.sfBase')}</th>
              <th className={adminTableCellClass}>{t('account.sfFinal')}</th>
              <th className={adminTableCellClass}>{t('account.sfFromBalance')}</th>
              <th className={adminTableCellClass}>{t('account.sfRemainingDue')}</th>
              <th className={adminTableCellClass}>{t('admin.status')}</th>
            </tr>
          </thead>
          <tbody>
            {properties.slice(0, 80).map((p) => {
              const a = assessments.find((x) => x.property_id === p.id);
              const debt = Number(p.debt ?? 0);
              const over = Number(p.overpayment ?? 0);
              return (
                <tr key={p.id} className={adminTableRowClass}>
                  <td className={adminTableCellClass}>№ {p.apartment_number}</td>
                  <td className={adminTableCellClass}>{p.owner_name ?? '—'}</td>
                  <td className={`${adminTableCellClass} tabular-nums`}>{a ? formatEurAmount(a.base_amount, locale) : formatEurAmount(annualSupportFee(p.area_sqm, supportRate), locale)}</td>
                  <td className={`${adminTableCellClass} tabular-nums`}>{a ? formatEurAmount(a.final_amount, locale) : '—'}</td>
                  <td className={`${adminTableCellClass} tabular-nums`}>{a ? formatEurAmount(a.applied_credit_amount, locale) : '—'}</td>
                  <td className={`${adminTableCellClass} tabular-nums`}>{a ? formatEurAmount(a.remaining_due, locale) : '—'}</td>
                  <td className={adminTableCellClass}>
                    {debt > 0 ? (
                      <StatusBadge label={`${t('admin.balDebt')} ${formatEurAmount(debt, locale)}`} tone="danger" />
                    ) : over > 0 ? (
                      <StatusBadge label={`${t('admin.balOver')} ${formatEurAmount(over, locale)}`} tone="success" />
                    ) : (
                      <StatusBadge label={t('admin.balSettled')} tone="neutral" />
                    )}
                    {a ? (
                      <div className="mt-1 text-xs text-muted">
                        {a.pricing_rule === 'early_full_payment'
                          ? t('account.sfPaidEarly')
                          : a.pricing_rule === 'late'
                            ? t('account.sfPriceAfterYearStart')
                            : t('account.sfStandardFee')}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </AdminTableShell>
        )}
        {canPay ? (
          <form
            className="mt-4 grid gap-2 sm:grid-cols-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!corrId || !corrReason.trim()) return;
              setSaving(true);
              try {
                const { error } = await supabase.rpc('record_support_fee_assessment_correction', {
                  p_assessment_id: corrId,
                  p_amount: Number(String(corrAmt).replace(',', '.')),
                  p_reason: corrReason.trim(),
                });
                if (error) throw error;
                setCorrAmt('');
                setCorrReason('');
                await load();
                await onReload();
              } catch (err: unknown) {
                onError(err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : t('admin.sfSaveFailed'));
              } finally {
                setSaving(false);
              }
            }}
          >
            <p className="sm:col-span-4 text-sm font-medium">{t('admin.sfCorrection')}</p>
            <p className="sm:col-span-4 text-xs text-muted">{t('admin.sfCorrectionHint')}</p>
            <select
              required
              value={corrId}
              onChange={(e) => setCorrId(e.target.value)}
              className={adminFieldClass}
            >
              <option value="">{t('form.pickApt')}</option>
              {assessments.map((a) => {
                const p = properties.find((x) => x.id === a.property_id);
                return (
                  <option key={a.id} value={a.id}>
                    № {p?.apartment_number ?? a.property_id} · {a.billing_year}
                  </option>
                );
              })}
            </select>
            <input
              required
              type="number"
              step="0.01"
              value={corrAmt}
              onChange={(e) => setCorrAmt(e.target.value)}
              placeholder={t('admin.sfCorrectionAmount')}
              className={adminFieldClass}
            />
            <input
              required
              value={corrReason}
              onChange={(e) => setCorrReason(e.target.value)}
              placeholder={t('admin.sfCorrectionReason')}
              className={adminFieldClass}
            />
            <button type="submit" disabled={saving} className="rounded-full border border-border px-4 py-2 text-sm disabled:opacity-50">
              {t('common.save')}
            </button>
          </form>
        ) : null}
      </div>
      )}
    </div>
  );
}
