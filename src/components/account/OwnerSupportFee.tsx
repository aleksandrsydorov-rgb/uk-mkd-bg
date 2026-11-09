'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { useI18n } from '@/i18n/I18nProvider';
import { isMissingRelation } from '@/lib/polls';
import { formatOwnerDate } from '@/lib/ownerFormat';
import {
  formatEurAmount,
  netSupportFeeAllocatedCredit,
  netSupportFeeAllocatedPayments,
  sofiaCalendarYear,
  supportFeeSettledTowardFinal,
  type SupportFeeAllocation,
  type SupportFeeAssessment,
  type SupportFeeYearPreview,
} from '@/lib/supportFeeAnnual';
import { canonicalSupportOutstanding, isActiveSupportAssessmentStatus } from '@/lib/supportFeeBalance';

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

  const totalOutstanding = useMemo(
    () =>
      canonicalSupportOutstanding(
        assessments.map((a) => ({
          property_id: propertyId,
          remaining_due: a.remaining_due,
          status: a.status,
          billing_year: a.billing_year,
        })),
        propertyId,
      ),
    [assessments, propertyId],
  );

  const openingOutstanding = useMemo(
    () =>
      canonicalSupportOutstanding(
        assessments
          .filter((a) => Boolean((a as { opening_import?: boolean | null }).opening_import))
          .map((a) => ({
            property_id: propertyId,
            remaining_due: a.remaining_due,
            status: a.status,
            billing_year: a.billing_year,
          })),
        propertyId,
      ),
    [assessments, propertyId],
  );

  function statusLine(a: SupportFeeAssessment): string {
    if (a.status === 'paid' && a.pricing_rule === 'early_full_payment') {
      return `${t('account.sfPaidEarly')} · ${t('account.sfDiscountPct', { n: Number(a.discount_percent) })}`;
    }
    if (a.status === 'paid') return t('account.paid');
    if (a.pricing_rule === 'late' && Number(a.remaining_due) > 0) {
      return t('account.sfPriceAfterYearStart');
    }
    const settled = supportFeeSettledTowardFinal(Number(a.final_amount), Number(a.remaining_due));
    if (Number(a.remaining_due) > 0 && settled > 0) return t('account.sfPartial');
    if (Number(a.remaining_due) > 0) return t('account.sfDue');
    return t('account.paid');
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[14px] border border-border bg-surface px-4 py-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          {t('account.supportFee')}
        </p>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <dt className="text-muted">{t('admin.feeOpeningDebt')}</dt>
            <dd className="font-semibold tabular-nums">{formatEurAmount(openingOutstanding)}</dd>
          </div>
          <div>
            <dt className="text-muted">
              {t('admin.feeYearRemaining', {
                year: String(openYear ?? assessments[0]?.billing_year ?? sofiaCalendarYear()),
              })}
            </dt>
            <dd className="font-semibold tabular-nums">
              {formatEurAmount(
                (() => {
                  const y = Number(openYear ?? assessments[0]?.billing_year ?? sofiaCalendarYear());
                  return assessments
                    .filter(
                      (a) =>
                        a.billing_year === y && isActiveSupportAssessmentStatus(a.status),
                    )
                    .reduce((s, a) => s + Math.max(0, Number(a.remaining_due) || 0), 0);
                })(),
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted">{t('admin.feeTotalOutstanding')}</dt>
            <dd className="font-semibold tabular-nums">{formatEurAmount(totalOutstanding)}</dd>
          </div>
          <div>
            <dt className="text-muted">{t('account.sfCreditOnBalance')}</dt>
            <dd className="font-semibold tabular-nums">{formatEurAmount(overpayment)}</dd>
          </div>
        </dl>
      </div>
      {preview && preview.policy_enabled && !assessments.some((a) => a.billing_year === preview.billing_year) ? (
        <div className="rounded-[14px] border border-border bg-surface px-4 py-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {t('account.supportFee')} · {preview.billing_year}
          </p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-muted">{t('account.sfBase')}</dt>
              <dd className="font-semibold">{formatEurAmount(preview.base_amount)}</dd>
            </div>
            <div>
              <dt className="text-muted">{t('account.sfEarlyIfPaidBy', { d: formatOwnerDate(preview.early_deadline_at, dateLocale) })}</dt>
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
        <div className="rounded-[14px] border border-border bg-surface px-4 py-4">
          <p className="text-sm text-secondary">{t('account.feePaymentsEmpty')}</p>
        </div>
      ) : (
        years.map((year) => {
          const a = assessments.find((x) => x.billing_year === year);
          const open = openYear === year;
          return (
            <div key={year} className="rounded-[14px] border border-border bg-surface px-4 py-4">
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
                          d: formatOwnerDate(a.early_deadline_at, dateLocale),
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
                          +{formatEurAmount(
                            Math.max(
                              0,
                              Number(a.late_amount ?? a.final_amount) - Number(a.base_amount),
                            ),
                          )}
                        </span>
                      </div>
                      {a.penalty_waived_at ? (
                        <div className="flex justify-between gap-3 text-accent">
                          <span>
                            {t('admin.sfHistPenaltyWaive')} · {Number(a.increase_percent).toFixed(0)}%
                          </span>
                          <span className="tabular-nums">
                            −{formatEurAmount(
                              Math.max(
                                0,
                                Number(a.late_amount ?? 0) - Number(a.final_amount),
                              ) ||
                                Math.max(
                                  0,
                                  Number(a.base_amount) * Number(a.increase_percent) / 100,
                                ),
                            )}
                          </span>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <div className="flex justify-between gap-3 font-semibold">
                    <span>{t('account.sfFinal')}</span>
                    <span className="tabular-nums">{formatEurAmount(a.final_amount)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">{t('admin.feeYearRemaining', { year: String(a.billing_year) })}</span>
                    <span className="tabular-nums">{formatEurAmount(a.remaining_due)}</span>
                  </div>
                  {(() => {
                    const allocs = allocations.filter((x) => x.assessment_id === a.id);
                    const payAmt = netSupportFeeAllocatedPayments(allocs, Number(a.applied_payment_amount));
                    const credAmt = netSupportFeeAllocatedCredit(allocs, Number(a.applied_credit_amount));
                    const settled = supportFeeSettledTowardFinal(Number(a.final_amount), Number(a.remaining_due));
                    return (
                    <div className="rounded-xl border border-border px-3 py-2 space-y-1">
                      <p className="text-xs uppercase tracking-wider text-muted">{t('account.sfHowPaid')}</p>
                      <p className="flex justify-between gap-3">
                        <span className="text-muted">{t('account.sfCashReceived')}</span>
                        <span className="tabular-nums">{formatEurAmount(payAmt)}</span>
                      </p>
                      <p className="flex justify-between gap-3">
                        <span className="text-muted">{t('account.sfCreditApplied')}</span>
                        <span className="tabular-nums">{formatEurAmount(credAmt)}</span>
                      </p>
                      <p className="flex justify-between gap-3">
                        <span className="text-muted">{t('account.sfSettledTowardYear')}</span>
                        <span className="tabular-nums">{formatEurAmount(settled)}</span>
                      </p>
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
                              d: formatOwnerDate(a.early_deadline_at, dateLocale),
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
                        {t('account.sfCheckedAt')}: {formatOwnerDate(a.qualification_checked_at, dateLocale)}
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
