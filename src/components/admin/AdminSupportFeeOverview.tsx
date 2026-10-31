'use client';

import { useMemo } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { formatEurAmount } from '@/lib/supportFeeAnnual';
import { buildSupportFeeOverviewStats } from '@/lib/supportFeeOverview';
import {
  AdminCard,
  AdminMetricCard,
  adminCardClass,
} from '@/components/admin/AdminUi';

type Props = {
  supportRate: number | null;
  annualSupportTotal: number | null;
  billingYear: number;
  outstandingTotal: number;
  overpaymentTotal: number;
  outstandingByProperty: number[];
  apartmentsCount: number;
  ledger: Array<{ kind: string; amount: number | string | null | undefined }>;
  onOpenOperations: () => void;
  onOpenPolicy: () => void;
  onOpenRegister: () => void;
};

function ShareBar({
  leftShare,
  leftTone,
  rightTone,
}: {
  leftShare: number;
  leftTone: string;
  rightTone: string;
}) {
  const left = Math.max(0, Math.min(1, leftShare));
  const right = 1 - left;
  return (
    <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-secondary">
      {left > 0 ? <div className={leftTone} style={{ width: `${left * 100}%` }} /> : null}
      {right > 0 ? <div className={rightTone} style={{ width: `${right * 100}%` }} /> : null}
    </div>
  );
}

export function AdminSupportFeeOverview({
  supportRate,
  annualSupportTotal,
  billingYear,
  outstandingTotal,
  overpaymentTotal,
  outstandingByProperty,
  apartmentsCount,
  ledger,
  onOpenOperations,
  onOpenPolicy,
  onOpenRegister,
}: Props) {
  const { t, locale } = useI18n();
  const money = (n: number) => formatEurAmount(n, locale);

  const stats = useMemo(
    () =>
      buildSupportFeeOverviewStats({
        ledger,
        outstandingTotal,
        overpaymentTotal,
        outstandingByProperty,
        apartmentsCount,
      }),
    [ledger, outstandingTotal, overpaymentTotal, outstandingByProperty, apartmentsCount],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminMetricCard
          label={t('admin.feeCurrentRate')}
          value={supportRate == null ? '—' : money(supportRate)}
          secondary={
            supportRate == null ? t('admin.feeTariffNotConfigured') : t('admin.feePerSqm')
          }
          onClick={onOpenOperations}
        />
        <AdminMetricCard
          label={t('admin.feeYear')}
          value={annualSupportTotal == null ? '—' : money(annualSupportTotal)}
          secondary={String(billingYear)}
          onClick={onOpenPolicy}
        />
        <AdminMetricCard
          label={t('admin.sfOutstandingLabel')}
          value={money(stats.outstandingTotal)}
          alert={stats.outstandingTotal > 0}
          onClick={onOpenRegister}
        />
        <AdminMetricCard
          label={t('admin.sfOverpaymentLabel')}
          value={money(stats.overpaymentTotal)}
          onClick={onOpenRegister}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <AdminCard className="lg:col-span-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {t('admin.sfOverviewActivity')}
          </p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-secondary">{t('admin.sfOverviewCharges')}</dt>
              <dd className="font-semibold tabular-nums">{money(stats.chargesTotal)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-secondary">{t('admin.sfOverviewPayments')}</dt>
              <dd className="font-semibold tabular-nums text-success">{money(stats.paymentsTotal)}</dd>
            </div>
          </dl>
          <ShareBar
            leftShare={stats.activityShareCharges}
            leftTone="bg-accent/70"
            rightTone="bg-success/70"
          />
          <p className="mt-2 text-[11px] text-muted">{t('admin.sfOverviewActivityHint')}</p>
        </AdminCard>

        <AdminCard className="lg:col-span-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {t('admin.sfOverviewBalance')}
          </p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-secondary">{t('admin.balDebt')}</dt>
              <dd
                className={`font-semibold tabular-nums ${
                  stats.outstandingTotal > 0 ? 'text-danger' : 'text-foreground'
                }`}
              >
                {money(stats.outstandingTotal)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-secondary">{t('admin.balOver')}</dt>
              <dd className="font-semibold tabular-nums text-success">{money(stats.overpaymentTotal)}</dd>
            </div>
          </dl>
          <ShareBar
            leftShare={stats.balanceShareOutstanding}
            leftTone="bg-danger/70"
            rightTone="bg-success/70"
          />
          <p className="mt-2 text-[11px] text-muted">{t('admin.sfOverviewBalanceHint')}</p>
        </AdminCard>

        <button
          type="button"
          onClick={onOpenRegister}
          className={`${adminCardClass} p-4 md:p-5 text-left hover:bg-hover/50`}
        >
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {t('admin.sfOverviewCoverage')}
          </p>
          <p className="mt-3 text-2xl font-semibold tabular-nums text-foreground">
            {stats.debtorsCount}
            <span className="ml-1 text-sm font-normal text-muted">
              / {stats.apartmentsCount}
            </span>
          </p>
          <p className="mt-1 text-sm text-secondary">{t('admin.sfOverviewDebtors')}</p>
          <p className="mt-3 text-xs text-accent">{t('admin.sfOverviewOpenRegister')}</p>
        </button>
      </div>
    </div>
  );
}
