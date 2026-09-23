'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { isMissingRelation } from '@/lib/polls';
import {
  formatEurAmount,
  sofiaCalendarYear,
  type SupportFeeAllocation,
  type SupportFeeAssessment,
  type SupportFeeYearPreview,
} from '@/lib/supportFeeAnnual';

function fmtDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function OwnerSupportFee({
  supabase,
  propertyId,
  assessments,
  allocations,
  overpayment,
}: {
  supabase: SupabaseClient<Database>;
  propertyId: number;
  assessments: SupportFeeAssessment[];
  allocations: SupportFeeAllocation[];
  overpayment: number;
}) {
  const { t, dateLocale } = useI18n();
  const [preview, setPreview] = useState<SupportFeeYearPreview | null>(null);
  const [openWhy, setOpenWhy] = useState<string | null>(null);
  const [openYear, setOpenYear] = useState<number | null>(
    assessments[0]?.billing_year ?? preview?.billing_year ?? null,
  );

  useEffect(() => {
    let cancelled = false;
    const year = sofiaCalendarYear();
    const years = [year, year + 1];
    (async () => {
      for (const billingYear of years) {
        const { data, error } = await supabase.rpc('preview_support_fee_year', {
          p_property_id: propertyId,
          p_billing_year: billingYear,
        });
        if (cancelled) return;
        if (error) {
          if (!isMissingRelation(error, 'support_fee_annual_policies')) {
            setPreview(null);
          }
          return;
        }
        const row = data as SupportFeeYearPreview | null;
        if (row?.policy_enabled) {
          setPreview(row);
          return;
        }
      }
      if (!cancelled) setPreview(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, propertyId]);

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const a of assessments) set.add(a.billing_year);
    if (preview?.billing_year) set.add(preview.billing_year);
    return [...set].sort((a, b) => b - a);
  }, [assessments, preview]);

  function statusLine(a: SupportFeeAssessment): string {
    if (a.status === 'paid' && a.pricing_rule === 'early_full_payment') {
      return `${t('account.sfPaidEarly')} · ${t('account.sfDiscountPct', { n: Number(a.discount_percent) })}`;
    }
    if (a.status === 'paid') return t('account.paid');
    if (a.pricing_rule === 'late') return t('account.sfPriceAfterYearStart');
    if (Number(a.remaining_due) > 0) return t('account.sfPartial');
    return t('account.sfDue');
  }

  return (
    <div className="space-y-4">
      {preview && preview.policy_enabled && !assessments.some((a) => a.billing_year === preview.billing_year) ? (
        <div className="rounded-[14px] border border-border bg-surface shadow-card p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {t('account.supportFee')} · {preview.billing_year}
          </p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-muted">{t('account.sfBase')}</dt>
              <dd className="font-semibold">{formatEurAmount(preview.base_amount)}</dd>
            </div>
            <div>
              <dt className="text-muted">{t('account.sfEarlyIfPaidBy', { d: fmtDate(preview.early_deadline_at, dateLocale) })}</dt>
              <dd className="font-semibold text-accent">{formatEurAmount(preview.early_amount)}</dd>
            </div>
            <div>
              <dt className="text-muted">{t('account.sfYouSave')}</dt>
              <dd className="font-semibold">{formatEurAmount(Number(preview.base_amount) - Number(preview.early_amount))}</dd>
            </div>
            <div>
              <dt className="text-muted">{t('account.sfFromYearStart')}</dt>
              <dd className="font-semibold">{formatEurAmount(preview.late_amount)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-secondary">
            {t('account.sfOnBalance')}: {formatEurAmount(preview.available_credit)}
          </p>
          {preview.credit_covers_early ? (
            <p className="mt-2 text-sm text-accent">{t('account.sfCreditEnough', { year: preview.billing_year })}</p>
          ) : (
            <p className="mt-2 text-sm text-secondary">
              {t('account.sfNeedMore', { n: formatEurAmount(preview.amount_needed_for_discount ?? 0) })}
            </p>
          )}
        </div>
      ) : null}

      {years.length === 0 ? (
        <div className="rounded-[14px] border border-border bg-surface shadow-card p-5">
          <p className="text-sm text-secondary">{t('account.feePaymentsEmpty')}</p>
        </div>
      ) : (
        years.map((year) => {
          const a = assessments.find((x) => x.billing_year === year);
          const open = openYear === year;
          return (
            <div key={year} className="rounded-[14px] border border-border bg-surface shadow-card p-5">
              <button
                type="button"
                className="flex w-full items-start justify-between gap-3 text-left"
                onClick={() => setOpenYear(open ? null : year)}
              >
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                    {t('account.supportFee')} · {year}
                  </p>
                  {a ? (
                    <p className="mt-1 text-sm font-medium text-foreground">{statusLine(a)}</p>
                  ) : (
                    <p className="mt-1 text-sm text-secondary">{t('account.sfPreview')}</p>
                  )}
                </div>
                <span className="text-muted">{open ? '−' : '+'}</span>
              </button>

              {open && a ? (
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">{t('account.sfBase')}</span>
                    <span className="tabular-nums">{formatEurAmount(a.base_amount)}</span>
                  </div>
                  {a.pricing_rule === 'early_full_payment' ? (
                    <div className="flex justify-between gap-3">
                      <span className="text-muted">
                        {t('account.sfEarlyDiscount')} · −{Number(a.discount_percent).toFixed(0)}%
                      </span>
                      <span className="tabular-nums text-accent">
                        −{formatEurAmount(Number(a.base_amount) - Number(a.final_amount))}
                      </span>
                    </div>
                  ) : null}
                  {a.pricing_rule === 'late' ? (
                    <>
                      <div className="rounded-xl bg-surface-secondary px-3 py-2 text-secondary">
                        {t('account.sfEarlyCondition', {
                          n: formatEurAmount(a.early_amount),
                          d: fmtDate(a.early_deadline_at, dateLocale),
                        })}
                      </div>
                      <p className="text-secondary">
                        {t('account.sfCoveredAtDeadline', { n: formatEurAmount(a.amount_covered_at_check) })}
                      </p>
                      <p className="text-secondary">{t('account.sfDiscountNotApplied')}</p>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted">
                          {t('account.sfIncrease')} · +{Number(a.increase_percent).toFixed(0)}%
                        </span>
                        <span className="tabular-nums">
                          +{formatEurAmount(Number(a.final_amount) - Number(a.base_amount))}
                        </span>
                      </div>
                    </>
                  ) : null}
                  <div className="flex justify-between gap-3 font-semibold">
                    <span>{t('account.sfFinal')}</span>
                    <span className="tabular-nums">{formatEurAmount(a.final_amount)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">{t('account.sfPaidLabel')}</span>
                    <span className="tabular-nums">
                      {formatEurAmount(Number(a.final_amount) - Number(a.remaining_due))}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">{t('account.sfRemainingDue')}</span>
                    <span className="tabular-nums">{formatEurAmount(a.remaining_due)}</span>
                  </div>
                  {(() => {
                    const allocs = allocations.filter((x) => x.assessment_id === a.id);
                    const pay = allocs.filter((x) => x.allocation_type === 'payment').reduce((s, x) => s + Number(x.amount), 0);
                    const cred = allocs.filter((x) => x.allocation_type === 'credit').reduce((s, x) => s + Number(x.amount), 0);
                    const payAmt = pay || Number(a.applied_payment_amount);
                    const credAmt = cred || Number(a.applied_credit_amount);
                    if (payAmt <= 0 && credAmt <= 0) return null;
                    return (
                    <div className="rounded-xl border border-border px-3 py-2">
                      <p className="text-xs uppercase tracking-wider text-muted">{t('account.sfHowPaid')}</p>
                      {payAmt > 0 ? (
                        <p className="mt-1 flex justify-between">
                          <span>{t('account.sfPayments')}</span>
                          <span className="tabular-nums">{formatEurAmount(payAmt)}</span>
                        </p>
                      ) : null}
                      {credAmt > 0 ? (
                        <p className="mt-1 flex justify-between">
                          <span>{t('account.sfFromBalance')}</span>
                          <span className="tabular-nums">{formatEurAmount(credAmt)}</span>
                        </p>
                      ) : null}
                    </div>
                    );
                  })()}
                  <button
                    type="button"
                    className="text-sm text-accent underline-offset-2 hover:underline"
                    onClick={() => setOpenWhy(openWhy === a.id ? null : a.id)}
                  >
                    {t('account.sfWhyAmount')}
                  </button>
                  {openWhy === a.id ? (
                    <div className="rounded-xl bg-surface-secondary px-3 py-3 text-secondary space-y-2">
                      <p>
                        {a.pricing_rule === 'early_full_payment'
                          ? t('account.sfWhyEarly', {
                              year: a.billing_year,
                              d: fmtDate(a.early_deadline_at, dateLocale),
                              pct: Number(a.discount_percent).toFixed(0),
                            })
                          : a.pricing_rule === 'late'
                            ? t('account.sfWhyLate', {
                                covered: formatEurAmount(a.amount_covered_at_check),
                                need: formatEurAmount(a.early_amount),
                              })
                            : t('account.sfWhyStandard')}
                      </p>
                      {Number(a.applied_credit_amount) > 0 ? (
                        <p>
                          {t('account.sfWhyCredit', {
                            used: formatEurAmount(a.applied_credit_amount),
                            year: a.billing_year,
                          })}
                        </p>
                      ) : null}
                      {a.balance_before != null && a.balance_after != null ? (
                        <p>
                          {t('account.sfBalanceFlow', {
                            before: formatEurAmount(a.balance_before),
                            used: formatEurAmount(a.applied_credit_amount),
                            after: formatEurAmount(a.balance_after),
                          })}
                        </p>
                      ) : null}
                      <p className="text-xs text-muted">
                        {t('account.sfCheckedAt')}: {fmtDate(a.qualification_checked_at, dateLocale)}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })
      )}

      <p className="text-xs text-muted">
        {t('account.sfAvailableNow')}: {formatEurAmount(overpayment)}
      </p>
    </div>
  );
}
