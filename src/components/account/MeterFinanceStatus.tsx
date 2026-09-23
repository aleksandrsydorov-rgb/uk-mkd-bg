'use client';

import { useI18n } from '@/i18n/I18nProvider';
import { balanceTone, formatEur } from '@/lib/utilities';

export const meterKpiGridClass = 'mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5';
export const compactKpiAlignClass = 'flex flex-col items-center justify-center text-center';
export const meterKpiCardClass = `${compactKpiAlignClass} h-full min-h-[6.25rem] rounded-xl bg-background px-3 py-3`;

export function MeterFinanceStatus({
  balance,
  loading,
  failed,
  onOpenFinances,
}: {
  balance: number;
  loading: boolean;
  failed?: boolean;
  onOpenFinances: () => void;
}) {
  const { t } = useI18n();
  const tone = balanceTone(balance);
  const label =
    tone === 'debt'
      ? t('account.utilStatusDebt')
      : tone === 'over'
        ? t('account.utilStatusOver')
        : t('account.utilStatusSettled');
  const amountCls =
    tone === 'debt' ? 'text-danger' : tone === 'over' ? 'text-success' : 'text-foreground';

  return (
    <button
      type="button"
      onClick={onOpenFinances}
      className={`${meterKpiCardClass} transition hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`}
    >
      <p className="text-[11px] text-muted">{t('account.utilFinanceStatus')}</p>
      {loading ? (
        <p className="mt-1 text-sm text-muted">{t('common.loading')}</p>
      ) : failed ? (
        <p className="mt-1 text-sm text-secondary">{t('account.utilFinanceUnavailable')}</p>
      ) : (
        <>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${amountCls}`}>
            {formatEur(Math.abs(balance))}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">{label}</p>
        </>
      )}
      <span className="mt-1 text-xs text-accent">
        {t('account.utilFinanceMore')} →
      </span>
    </button>
  );
}
